import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Concurrencia real: conexiones PostgreSQL independientes y dos instancias de la API, cada una
// con su propio cliente Prisma y su propio pool.

vi.mock('../middleware/auth.middleware.js', () => ({
  requireAuth: async (request: { userId?: string }) => {
    request.userId = 'user-a'
  },
}))

const GEN = { a: 'cmj7b5q8r0001v6y7g5q4m3n2', b: 'cmj7b5q8r0002v6y7g5q4m3n2' }
const WAIT_MS = 300

let database: TestDatabase
let admin: pg.Client
const clients: pg.Client[] = []

const insertRow = (generationId: string, instanceKey: string, position: number) => ({
  text: `INSERT INTO "ListingPublication" (id, "generationId", platform, "instanceKey", position, "updatedAt") VALUES ($1, $2, 'other', $3, $4, now())`,
  values: [`${generationId}-${instanceKey}`, generationId, instanceKey, position],
})

const count = async (generationId: string) =>
  (await admin.query(`SELECT count(*)::int AS n FROM "ListingPublication" WHERE "generationId" = $1 AND platform = 'other'`, [generationId])).rows[0].n as number

async function connection() {
  const client = new pg.Client({ connectionString: database.url })

  await client.connect()
  clients.push(client)

  return client
}

// Indica si la promesa sigue pendiente tras el tiempo dado.
async function stillPending(promise: Promise<unknown>) {
  const pending = Symbol('pending')

  return (await Promise.race([promise.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, WAIT_MS, pending))])) === pending
}

beforeAll(async () => {
  database = await createTestDatabase()
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt") VALUES ('user-a', 'a@example.test', 'x', now())`)
  await admin.query(`INSERT INTO "Property" (id, title, operation, type, price, address, city, neighborhood, area, bedrooms, bathrooms, condition, "additionalInformation", "userId", "updatedAt") VALUES ('prop', 't', 'sale', 'house', 1, 'a', 'c', '', 1, 1, 1, 'good', '', 'user-a', now())`)

  for (const id of Object.values(GEN)) {
    await admin.query(`INSERT INTO "Generation" (id, title, description, highlights, provider, tone, language, "propertyId", "updatedAt") VALUES ($1, 't', 'd', '[]', 'mock', 'casual', 'es', 'prop', now())`, [id])
  }
})

beforeEach(async () => {
  await admin.query(`DELETE FROM "ListingPublication"`)
})

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end().catch(() => undefined)))
})

afterAll(async () => {
  await admin.end()
  await database.drop()
})

describe('conexiones independientes', () => {
  const lock = (id: string) => `UPDATE "Generation" SET "title" = "title" WHERE "id" = '${id}'`

  it('el bloqueo del anuncio hace esperar a otra conexión hasta el COMMIT', async () => {
    const [first, second] = [await connection(), await connection()]

    await first.query('BEGIN')
    await first.query(lock(GEN.a))

    const blocked = second.query(lock(GEN.a))

    expect(await stillPending(blocked)).toBe(true)

    await first.query('COMMIT')

    expect((await blocked).rowCount).toBe(1)
  })

  it('el bloqueo de un anuncio no afecta a otro', async () => {
    const [first, second] = [await connection(), await connection()]

    await first.query('BEGIN')
    await first.query(lock(GEN.a))

    expect((await second.query(lock(GEN.b))).rowCount).toBe(1)

    await first.query('ROLLBACK')
  })

  it('una colisión de posición espera y falla al confirmarse la primera', async () => {
    const [first, second] = [await connection(), await connection()]

    await first.query('BEGIN')
    await first.query(insertRow(GEN.a, 'uno', 0))

    const colliding = second.query(insertRow(GEN.a, 'dos', 0))

    expect(await stillPending(colliding)).toBe(true)

    await first.query('COMMIT')

    await expect(colliding).rejects.toMatchObject({ code: '23505', constraint: 'ListingPublication_other_position_key' })
    expect(await count(GEN.a)).toBe(1)
  })

  it('si la primera hace ROLLBACK, la colisión desaparece', async () => {
    const [first, second] = [await connection(), await connection()]

    await first.query('BEGIN')
    await first.query(insertRow(GEN.a, 'uno', 0))

    const waiting = second.query(insertRow(GEN.a, 'dos', 0))

    expect(await stillPending(waiting)).toBe(true)

    await first.query('ROLLBACK')

    expect((await waiting).rowCount).toBe(1)
    expect(await count(GEN.a)).toBe(1)
  })

  it('seis conexiones simultáneas no crean una sexta fila', async () => {
    const connections = await Promise.all(Array.from({ length: 6 }, connection))
    const results = await Promise.allSettled(connections.map((client, position) => client.query(insertRow(GEN.a, `k${position}`, position))))

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5)
    expect(await count(GEN.a)).toBe(5)
  })

  it('diez conexiones por la misma posición: solo entra una', async () => {
    const connections = await Promise.all(Array.from({ length: 10 }, connection))
    const results = await Promise.allSettled(connections.map((client, index) => client.query(insertRow(GEN.a, `k${index}`, 4))))

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await count(GEN.a)).toBe(1)
  })

  it('una transacción con una fila no válida no deja nada', async () => {
    const client = await connection()

    await client.query('BEGIN')
    await client.query(insertRow(GEN.a, 'uno', 0))
    await expect(client.query(insertRow(GEN.a, 'dos', 5))).rejects.toMatchObject({ code: '23514' })
    await client.query('ROLLBACK')

    expect(await count(GEN.a)).toBe(0)
  })
})

describe('dos instancias de la API con pools distintos', () => {
  const apps: FastifyInstance[] = []
  const disconnect: Array<() => Promise<void>> = []

  async function instance() {
    vi.resetModules()

    const { generationRoutes } = await import('../routes/generation.routes.js')
    const { closeDatabase } = await import('../db/prisma.js')
    const app = Fastify()

    await app.register(generationRoutes)
    await app.ready()
    apps.push(app)
    disconnect.push(() => closeDatabase())

    return app
  }

  const row = (key: string) => ({ instanceKey: key, isPublished: true, url: `https://${key}.example/a` })
  const set = (prefix: string, size: number) => Array.from({ length: size }, (_, index) => row(`${prefix}x${index}`))

  const put = (app: FastifyInstance, id: string, others: unknown[], items: unknown[] = []) =>
    app.inject({ method: 'PUT', url: `/api/generations/${id}/publications`, payload: { items, others } })

  let one: FastifyInstance
  let two: FastifyInstance

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', database.url)
    one = await instance()
    two = await instance()
  })

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()))
    await Promise.all(disconnect.map((close) => close()))
    vi.unstubAllEnvs()
  })

  it('guardados cruzados del mismo anuncio dejan un único estado válido', async () => {
    const responses = await Promise.all(
      Array.from({ length: 40 }, (_, index) => put(index % 2 ? one : two, GEN.a, set(`p${index}`, (index % 5) + 1))),
    )

    expect(responses.filter((response) => ![200, 409].includes(response.statusCode)).map((response) => response.statusCode)).toEqual([])
    expect(responses.filter((response) => response.statusCode === 200).length).toBeGreaterThan(0)

    const { rows } = await admin.query(`SELECT "instanceKey", position FROM "ListingPublication" WHERE "generationId" = $1 AND platform = 'other' ORDER BY position`, [GEN.a])

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(5)
    expect(new Set(rows.map((item) => item.instanceKey.split('x')[0])).size).toBe(1)
    expect(rows.map((item) => item.position)).toEqual(rows.map((_, index) => index))
  })

  it('anuncios distintos no se interfieren', async () => {
    const responses = await Promise.all([
      ...Array.from({ length: 10 }, () => put(one, GEN.a, set('a', 5))),
      ...Array.from({ length: 10 }, () => put(two, GEN.b, set('b', 3))),
    ])

    expect(responses.every((response) => response.statusCode === 200)).toBe(true)
    expect(await count(GEN.a)).toBe(5)
    expect(await count(GEN.b)).toBe(3)
  })

  it('una sexta fila simultánea se rechaza sin alterar lo guardado', async () => {
    await put(one, GEN.a, set('base', 5))

    const responses = await Promise.all([
      put(one, GEN.a, set('seis', 6)),
      put(two, GEN.a, set('siete', 6)),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400])
    expect(await count(GEN.a)).toBe(5)
  })

  it('nunca queda una fila marcada sin enlace', async () => {
    const item = (url: string | null, isPublished: boolean) => [{ platform: 'idealista', isPublished, url }]

    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        put(index % 2 ? one : two, GEN.a, set('m', 2), index % 3 === 0 ? item(null, false) : item('https://www.idealista.com/a', true)),
      ),
    )

    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM "ListingPublication" WHERE "isPublished" AND (url IS NULL OR trim(url) = '')`)

    expect(rows[0].n).toBe(0)
  })
})
