import { randomBytes } from 'node:crypto'

import type { FastifyBaseLogger } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// PG-20 y PG-21 con concurrencia real: dos instancias de los servicios, cada una con su cliente
// Prisma y su pool, y muchas operaciones a la vez en distintos órdenes.

const ROUNDS = 4
const CONCURRENCY = 16

let database: TestDatabase
let admin: pg.Client

type Services = {
  recovery: typeof import('../services/security-recovery.service.js')
  resets: typeof import('../services/password-reset.service.js')
  disconnect: () => Promise<void>
}

const instances: Services[] = []

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as FastifyBaseLogger

async function load(): Promise<Services> {
  vi.resetModules()

  const { closeDatabase } = await import('../db/prisma.js')

  return {
    recovery: await import('../services/security-recovery.service.js'),
    resets: await import('../services/password-reset.service.js'),
    disconnect: () => closeDatabase(),
  }
}

const instance = (index: number) => instances[index % instances.length]

const shuffled = <T>(items: T[]) =>
  items.map((item) => [Math.random(), item] as const).sort((a, b) => a[0] - b[0]).map(([, item]) => item)

const one = async <T>(text: string, values: unknown[] = []) => (await admin.query(text, values)).rows[0] as T

async function pendingAccount() {
  const id = `u${randomBytes(6).toString('hex')}`

  await admin.query(
    `INSERT INTO "User" (id, email, password, "updatedAt", "passwordResetRequiredAt", "securityRecoveryEmail", "securityHoldVersion")
     VALUES ($1, $2, 'hash-original', now(), now(), $3, 1)`,
    [id, `${id}@example.test`, `destino-${id}@example.test`],
  )

  return { id, email: `${id}@example.test`, destination: `destino-${id}@example.test` }
}

async function plainAccount() {
  const id = `u${randomBytes(6).toString('hex')}`

  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt") VALUES ($1, $2, 'hash-original', now())`, [id, `${id}@example.test`])
  await admin.query(`INSERT INTO "Session" (id, "tokenHash", "userId", "expiresAt") VALUES ($1, $2, $1, now() + interval '1 day')`, [id, `s-${id}`]).catch(async () => {
    await admin.query(`INSERT INTO "Session" (id, "tokenHash", "userId", "expiresAt", "createdAt") VALUES ($1, $2, $1, now() + interval '1 day', now())`, [id, `s-${id}`])
  })

  return id
}

const activeTokens = (userId: string, purpose: string) =>
  one<{ n: number }>(`SELECT count(*)::int AS n FROM "PasswordResetToken" WHERE "userId" = $1 AND purpose = $2 AND "usedAt" IS NULL`, [userId, purpose]).then((row) => row.n)

const audits = (userId: string, action: string) =>
  one<{ n: number }>(`SELECT count(*)::int AS n FROM "AdminAuditLog" WHERE "targetUserId" = $1 AND action = $2`, [userId, action]).then((row) => row.n)

beforeAll(async () => {
  database = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', database.url)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  instances.push(await load(), await load())
})

afterAll(async () => {
  await Promise.all(instances.map((services) => services.disconnect()))
  await admin.end()
  vi.unstubAllEnvs()
  await database.drop()
})

beforeEach(async () => {
  await admin.query(`DROP FUNCTION IF EXISTS fail_recovery() CASCADE`)
})

describe('PG-20: emisión del enlace de recuperación obligatoria', () => {
  it.each(Array.from({ length: ROUNDS }, (_, round) => round))('ronda %i: muchas solicitudes simultáneas desde dos instancias emiten un solo enlace', async (round) => {
    const account = await pendingAccount()
    const calls = shuffled(Array.from({ length: CONCURRENCY }, (_, index) => () => instance(index + round).recovery.issueRequestedRecoveryLinks(log, account.email)))
    const results = await Promise.all(calls.map((call) => call()))

    expect(results.flat()).toHaveLength(1)
    expect(results.flat()[0]).toMatchObject({ userId: account.id, to: account.destination })
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(1)
    expect(await audits(account.id, 'SECURITY_RECOVERY_LINK_REQUESTED')).toBe(1)
  })

  it('una solicitud posterior dentro del intervalo no emite otro enlace', async () => {
    const account = await pendingAccount()

    expect(await instance(0).recovery.issueRequestedRecoveryLinks(log, account.email)).toHaveLength(1)
    expect(await instance(1).recovery.issueRequestedRecoveryLinks(log, account.email)).toHaveLength(0)
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(1)
  })

  it('pasado el intervalo, el enlace nuevo sustituye al anterior: sigue habiendo uno activo', async () => {
    const account = await pendingAccount()
    const [first] = await instance(0).recovery.issueRequestedRecoveryLinks(log, account.email)

    await admin.query(`UPDATE "PasswordResetToken" SET "createdAt" = now() - interval '1 hour' WHERE "userId" = $1`, [account.id])

    const [second] = await instance(1).recovery.issueRequestedRecoveryLinks(log, account.email)

    expect(second.token).not.toBe(first.token)
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(1)
    expect(await instance(0).resets.consumeSecurityRecoveryToken(first.token, 'h')).toBe('invalid_token')
  })

  it('cuentas distintas a la vez reciben un enlace cada una', async () => {
    const accounts = await Promise.all(Array.from({ length: 8 }, pendingAccount))
    const results = await Promise.all(shuffled(accounts.flatMap((account, index) => [0, 1].map((copy) => () => instance(index + copy).recovery.issueRequestedRecoveryLinks(log, account.email)))).map((call) => call()))

    expect(results.flat()).toHaveLength(8)

    for (const account of accounts) {
      expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(1)
    }
  })

  it('si falla la transacción no queda enlace ni auditoría, y un reintento posterior funciona', async () => {
    const account = await pendingAccount()

    await admin.query(`CREATE FUNCTION fail_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo simulado'; END $$`)
    await admin.query(`CREATE TRIGGER fail_recovery BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION fail_recovery()`)

    expect(await instance(0).recovery.issueRequestedRecoveryLinks(log, account.email)).toHaveLength(0)
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(0)
    expect(await audits(account.id, 'SECURITY_RECOVERY_LINK_REQUESTED')).toBe(0)

    await admin.query(`DROP FUNCTION fail_recovery() CASCADE`)

    expect(await instance(1).recovery.issueRequestedRecoveryLinks(log, account.email)).toHaveLength(1)
  })

  it('el enlace de autoservicio también queda único con solicitudes simultáneas', async () => {
    const userId = await plainAccount()

    await Promise.all(shuffled(Array.from({ length: CONCURRENCY }, (_, index) => () => instance(index).resets.issuePasswordResetToken(userId))).map((call) => call()))

    expect(await activeTokens(userId, 'SELF_SERVICE')).toBe(1)
  })
})

describe('PG-21: consumo del enlace de recuperación obligatoria', () => {
  async function issued() {
    const account = await pendingAccount()
    const [link] = await instance(0).recovery.issueRequestedRecoveryLinks(log, account.email)

    return { ...account, token: link.token }
  }

  it.each(Array.from({ length: ROUNDS }, (_, round) => round))('ronda %i: muchos consumos simultáneos del mismo enlace: solo uno completa', async (round) => {
    const account = await issued()
    const hashes = Array.from({ length: CONCURRENCY }, (_, index) => `hash-${round}-${index}`)
    const order = shuffled(hashes.map((hash, index) => ({ hash, index })))
    const results = await Promise.all(order.map(({ hash, index }) => instance(index + round).resets.consumeSecurityRecoveryToken(account.token, hash)))

    expect(results.filter((result) => result === 'completed')).toHaveLength(1)
    expect([...new Set(results.filter((result) => result !== 'completed'))]).toEqual(['invalid_token'])

    const winner = order[results.indexOf('completed')].hash
    const state = await one<{ password: string; pending: boolean; email: string }>(`SELECT password, "passwordResetRequiredAt" IS NOT NULL AS pending, email FROM "User" WHERE id = $1`, [account.id])

    expect(state).toEqual({ password: winner, pending: false, email: account.destination })
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(0)
    expect(await audits(account.id, 'SECURITY_RECOVERY_COMPLETED')).toBe(1)
  })

  it('un segundo consumo posterior responde invalid_token y no cambia nada', async () => {
    const account = await issued()

    expect(await instance(0).resets.consumeSecurityRecoveryToken(account.token, 'primera')).toBe('completed')
    expect(await instance(1).resets.consumeSecurityRecoveryToken(account.token, 'segunda')).toBe('invalid_token')
    expect((await one<{ password: string }>(`SELECT password FROM "User" WHERE id = $1`, [account.id])).password).toBe('primera')
  })

  it('enlaces distintos de cuentas distintas se completan a la vez', async () => {
    const accounts = await Promise.all(Array.from({ length: 6 }, issued))
    const results = await Promise.all(accounts.map((account, index) => instance(index).resets.consumeSecurityRecoveryToken(account.token, `h-${index}`)))

    expect(results).toEqual(accounts.map(() => 'completed'))
  })

  it('caducado, inexistente o de otro tipo: invalid_token sin cambios', async () => {
    const account = await issued()

    await admin.query(`UPDATE "PasswordResetToken" SET "expiresAt" = now() - interval '1 second' WHERE "userId" = $1`, [account.id])

    expect(await instance(0).resets.consumeSecurityRecoveryToken(account.token, 'x')).toBe('invalid_token')
    expect(await instance(1).resets.consumeSecurityRecoveryToken(randomBytes(32).toString('hex'), 'x')).toBe('invalid_token')

    const userId = await plainAccount()
    const { token } = await instance(0).resets.issuePasswordResetToken(userId)

    expect(await instance(1).resets.consumeSecurityRecoveryToken(token, 'x')).toBe('invalid_token')
    expect((await one<{ password: string }>(`SELECT password FROM "User" WHERE id = $1`, [account.id])).password).toBe('hash-original')
  })

  it('si falla el cambio de contraseña, nada se guarda y el enlace sigue sirviendo', async () => {
    const account = await issued()

    await admin.query(`CREATE FUNCTION fail_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo simulado'; END $$`)
    await admin.query(`CREATE TRIGGER fail_recovery BEFORE UPDATE OF password ON "User" FOR EACH ROW EXECUTE FUNCTION fail_recovery()`)

    await expect(instance(0).resets.consumeSecurityRecoveryToken(account.token, 'nueva')).rejects.toThrow()
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(1)
    expect((await one<{ password: string }>(`SELECT password FROM "User" WHERE id = $1`, [account.id])).password).toBe('hash-original')

    await admin.query(`DROP FUNCTION fail_recovery() CASCADE`)

    expect(await instance(1).resets.consumeSecurityRecoveryToken(account.token, 'nueva')).toBe('completed')
  })
})

describe('consumo del enlace de autoservicio', () => {
  it.each(Array.from({ length: ROUNDS }, (_, round) => round))('ronda %i: muchos consumos simultáneos: solo uno cambia la contraseña', async (round) => {
    const userId = await plainAccount()
    const { token } = await instance(round).resets.issuePasswordResetToken(userId)
    const results = await Promise.all(shuffled(Array.from({ length: CONCURRENCY }, (_, index) => () => instance(index).resets.consumePasswordResetToken(token, `nueva-${index}`))).map((call) => call()))

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await activeTokens(userId, 'SELF_SERVICE')).toBe(0)
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM "Session" WHERE "userId" = $1`, [userId])).n).toBe(0)
  })
})
