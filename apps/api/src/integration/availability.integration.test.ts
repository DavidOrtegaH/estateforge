import { randomBytes } from 'node:crypto'
import net from 'node:net'

import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Disponibilidad con PostgreSQL real (DA-37, DA-38): la app real de buildApp y su Prisma real contra
// un rol con un límite de conexiones menor que el pool, un pool con un tiempo de espera corto y un
// servidor inaccesible. La sesión de GET /api/auth/me se consulta en la base en cada petición.

let database: TestDatabase
let admin: pg.Client
const ROLE = `ef_lim_${randomBytes(4).toString('hex')}`
const ROLE_PASSWORD = randomBytes(18).toString('hex')
const ROLE_LIMIT = 2
const ROUNDS = 3

type Loaded = { app: FastifyInstance; closeDatabase: () => Promise<void>; prisma: typeof import('../db/prisma.js')['prisma'] }
const opened: Loaded[] = []

function urlFor(user: string, password: string, port?: number) {
  const parsed = new URL(database.url)
  parsed.username = user
  parsed.password = password
  if (port !== undefined) parsed.port = String(port)
  return parsed.toString()
}

async function load(env: Record<string, string>): Promise<Loaded> {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  const { buildApp } = await import('../app.js')
  const { readinessRoutes } = await import('../routes/readiness.routes.js')
  const { closeDatabase, prisma } = await import('../db/prisma.js')
  const app = await buildApp()
  await app.register(readinessRoutes)
  await app.ready()
  const loaded = { app, closeDatabase, prisma }
  opened.push(loaded)
  return loaded
}

async function release(loaded: Loaded) {
  await loaded.app.close()
  await loaded.closeDatabase()
}

let cookie = ''

async function sessionCookie() {
  const id = `u${randomBytes(6).toString('hex')}`
  const token = randomBytes(32).toString('hex')
  const { createHash } = await import('node:crypto')
  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt") VALUES ($1, $2, 'x', now())`, [id, `${id}@example.test`])
  await admin.query(`INSERT INTO "Session" (id, "tokenHash", "userId", "expiresAt") VALUES ($1, $2, $1, now() + interval '1 day')`, [id, createHash('sha256').update(token).digest('hex')])
  return `estateforge_session=${token}`
}

const me = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })

async function closedPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  await new Promise(resolve => server.close(resolve))
  return port
}

const roleConnections = async () =>
  (await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1`, [ROLE])).rows[0].n as number

function expectNoLeak(body: string) {
  for (const secret of [ROLE, ROLE_PASSWORD, database.name, '127.0.0.1', 'Session', 'SELECT', '53300', 'P2037', 'P1001', 'postgres']) {
    expect(body).not.toContain(secret)
  }
}

beforeAll(async () => {
  database = await createTestDatabase()
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  await admin.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASSWORD}' CONNECTION LIMIT ${ROLE_LIMIT}`)
  await admin.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${ROLE}`)
  cookie = await sessionCookie()
})

afterEach(async () => {
  await Promise.all(opened.splice(0).map(release))
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await admin.end()
  await database.drop()
  const cleanup = new pg.Client({ connectionString: process.env.TEST_POSTGRES_ADMIN_URL })
  await cleanup.connect()
  await cleanup.query(`DROP ROLE IF EXISTS ${ROLE}`)
  await cleanup.end()
})

describe('saturación real: rol con límite de conexiones menor que el pool', () => {
  it.each(Array.from({ length: ROUNDS }, (_, round) => round))('ronda %i: las peticiones sin conexión responden 503 con Retry-After, las demás 200, y nunca 500', async () => {
    const { app } = await load({ DATABASE_URL: urlFor(ROLE, ROLE_PASSWORD), DATABASE_POOL_MAX: '8', DATABASE_CONNECT_TIMEOUT_MS: '2000' })

    // Mantiene ocupadas las conexiones del rol mientras llegan las peticiones.
    const holders = await Promise.all(Array.from({ length: ROLE_LIMIT }, async () => {
      const client = new pg.Client({ connectionString: urlFor(ROLE, ROLE_PASSWORD) })
      await client.connect()
      return client
    }))
    const responses = await Promise.all(Array.from({ length: 12 }, () => me(app)))
    await Promise.all(holders.map(client => client.end()))

    const statuses = responses.map(response => response.statusCode)
    expect(statuses.filter(status => status === 503).length).toBe(12)
    for (const response of responses) {
      expect(response.headers['retry-after']).toBe('5')
      expect(response.json()).toEqual({ code: 'SERVICE_UNAVAILABLE', message: expect.any(String) })
      expectNoLeak(response.body)
    }

    // Recuperación: con las conexiones libres, la misma app responde con normalidad.
    const after = await Promise.all(Array.from({ length: 6 }, () => me(app)))
    expect(after.map(response => response.statusCode)).toEqual(Array(6).fill(200))
  })

  it('con carga concurrente mayor que el límite, cada petición es 200 o 503, nunca 500', async () => {
    const { app } = await load({ DATABASE_URL: urlFor(ROLE, ROLE_PASSWORD), DATABASE_POOL_MAX: '8', DATABASE_CONNECT_TIMEOUT_MS: '2000' })

    const statuses: number[] = []
    for (let wave = 0; wave < 4; wave++) {
      const responses = await Promise.all(Array.from({ length: 30 }, () => me(app)))
      statuses.push(...responses.map(response => response.statusCode))
      for (const response of responses) if (response.statusCode === 503) expectNoLeak(response.body)
    }

    expect(statuses.every(status => status === 200 || status === 503)).toBe(true)
    expect(statuses).toContain(200)
    expect(await roleConnections()).toBeLessThanOrEqual(ROLE_LIMIT)
  })

  it('/health responde 200 y /health/ready 503 mientras el rol no tiene conexiones', async () => {
    const { app } = await load({ DATABASE_URL: urlFor(ROLE, ROLE_PASSWORD), DATABASE_POOL_MAX: '4', DATABASE_CONNECT_TIMEOUT_MS: '1000' })
    const holders = await Promise.all(Array.from({ length: ROLE_LIMIT }, async () => {
      const client = new pg.Client({ connectionString: urlFor(ROLE, ROLE_PASSWORD) })
      await client.connect()
      return client
    }))
    try {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
      const ready = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(ready.statusCode).toBe(503)
      expect(ready.json()).toEqual({ status: 'unavailable', database: 'unavailable' })
    } finally {
      await Promise.all(holders.map(client => client.end()))
    }
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200)
  })
})

describe('tiempo agotado del pool', () => {
  it('una petición que no obtiene conexión a tiempo responde 503 y la siguiente, ya libre, 200', async () => {
    const { app, prisma } = await load({ DATABASE_URL: database.url, DATABASE_POOL_MAX: '1', DATABASE_CONNECT_TIMEOUT_MS: '300' })

    // Una PrismaPromise no se ejecuta hasta llamar a then: se arranca para ocupar la única conexión.
    const busy = prisma.$queryRaw`SELECT pg_sleep(1.5)::text`.then(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 100))
    const waiting = await me(app)
    await busy

    expect(waiting.statusCode).toBe(503)
    expect(waiting.headers['retry-after']).toBe('5')
    expectNoLeak(waiting.body)
    expect((await me(app)).statusCode).toBe(200)
  })
})

describe('servidor inaccesible', () => {
  it('503 sin datos de conexión, /health 200 y /health/ready 503 en menos de 3 s', async () => {
    const port = await closedPort()
    const { app } = await load({ DATABASE_URL: urlFor('nadie', 'nada', port), DATABASE_CONNECT_TIMEOUT_MS: '1000' })

    const response = await me(app)
    expect(response.statusCode).toBe(503)
    expectNoLeak(response.body)
    expect(response.body).not.toContain(String(port))

    // Recuperación de contraseña: 503 igual exista o no la cuenta, sin enumeración (DA-37).
    const bodies = new Set<string>()
    for (const url of ['/api/auth/forgot-password', '/api/auth/security-recovery/request']) {
      for (const email of ['existe@example.test', 'nadie@example.test']) {
        const recovery = await app.inject({ method: 'POST', url, payload: { email } })
        expect(recovery.statusCode).toBe(503)
        expect(recovery.headers['retry-after']).toBe('5')
        bodies.add(recovery.body)
      }
    }
    expect(bodies.size).toBe(1)

    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
    const started = Date.now()
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503)
    expect(Date.now() - started).toBeLessThan(3_000)
  })
})

describe('errores que no son de disponibilidad', () => {
  afterEach(async () => {
    await admin.query(`DROP TRIGGER IF EXISTS fail_session ON "Session"`)
    await admin.query(`DROP FUNCTION IF EXISTS fail_session()`)
  })

  async function failSessionInsert(sqlstate: string) {
    await admin.query(`CREATE FUNCTION fail_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo inyectado en "Session"' USING ERRCODE = '${sqlstate}'; END $$`)
    await admin.query(`CREATE TRIGGER fail_session BEFORE INSERT ON "Session" FOR EACH ROW EXECUTE FUNCTION fail_session()`)
  }

  async function login(app: FastifyInstance) {
    const email = `l${randomBytes(5).toString('hex')}@example.test`
    const { hashPassword } = await import('../services/password.service.js')
    await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt", "emailVerifiedAt") VALUES ($1, $2, $3, now(), now())`, [`u${randomBytes(6).toString('hex')}`, email, await hashPassword('Contrasena-Muy-Segura-1')])
    return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Contrasena-Muy-Segura-1' } })
  }

  it.each([
    ['violación de CHECK (23514)', '23514'],
    ['violación de unicidad (23505)', '23505'],
    ['error interno del servidor (XX000)', 'XX000'],
  ])('%s al escribir la sesión: 500 genérico, no 503', async (_label, sqlstate) => {
    const { app } = await load({ DATABASE_URL: database.url })
    await failSessionInsert(sqlstate)

    const response = await login(app)

    expect(response.statusCode).toBe(500)
    expect(response.headers['retry-after']).toBeUndefined()
    expect(response.json()).toEqual({ message: 'Error interno del servidor' })
    expect(response.body).not.toMatch(/Session|inyectado|23514|23505|XX000/)
  })
})
