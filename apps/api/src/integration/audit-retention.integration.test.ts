import { randomBytes } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Retención de AdminAuditLog (90 días) contra PostgreSQL efímero: una base ef_test_* propia que se
// crea y se destruye en esta suite (solo localhost). Nunca toca una base real ni su auditoría.

let database: TestDatabase
let admin: pg.Client
let service: typeof import('../services/audit-retention.service.js')
let closeDatabase: () => Promise<void>

const NOW = new Date('2026-11-17T04:00:00.000Z')
const CUTOFF = new Date(NOW.getTime() - 90 * 86_400_000)
const at = (offsetMs: number) => new Date(CUTOFF.getTime() + offsetMs).toISOString()
const OLD = at(-86_400_000)

const purge = (batchSize?: number) => service.purgeExpiredAuditLogs({ now: NOW, ...(batchSize !== undefined && { batchSize }) })

async function account(state: { hold?: boolean; recovery?: boolean } = {}) {
  const id = `u${randomBytes(6).toString('hex')}`
  await admin.query(
    `INSERT INTO "User" (id, email, password, "updatedAt", "securityHoldAt", "passwordResetRequiredAt")
     VALUES ($1, $2, 'hash', now(), $3, $4)`,
    [id, `${id}@example.test`, state.hold ? NOW.toISOString() : null, state.recovery ? NOW.toISOString() : null],
  )
  return id
}

async function audit(createdAt: string, actorUserId: string | null, targetUserId: string | null, action = 'ACCOUNT_SUSPENDED') {
  const id = `a${randomBytes(8).toString('hex')}`
  await admin.query(
    `INSERT INTO "AdminAuditLog" (id, "actorUserId", "targetUserId", action, metadata, "createdAt") VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
    [id, actorUserId, targetUserId, action, JSON.stringify({ targetEmail: 'titular@example.test' }), createdAt],
  )
  return id
}

const remaining = async () => new Set((await admin.query<{ id: string }>(`SELECT id FROM "AdminAuditLog"`)).rows.map(row => row.id))

beforeAll(async () => {
  database = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', database.url)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  vi.resetModules()
  closeDatabase = (await import('../db/prisma.js')).closeDatabase
  service = await import('../services/audit-retention.service.js')
})

afterAll(async () => {
  await closeDatabase?.()
  await admin?.end()
  vi.unstubAllEnvs()
  await database?.drop()
})

beforeEach(async () => {
  // Base efímera de esta suite.
  await admin.query(`DELETE FROM "AdminAuditLog"`)
  await admin.query(`DELETE FROM "User"`)
})

describe('frontera de 90 días (UTC, milisegundos)', () => {
  it('borra lo estrictamente anterior al umbral y conserva el umbral exacto y lo posterior', async () => {
    const owner = await account()
    const target = await account()
    const before = await audit(at(-1), owner, target)
    const exact = await audit(at(0), owner, target)
    const after = await audit(at(1), owner, target)
    const recent = await audit(NOW.toISOString(), owner, target)

    expect(await purge()).toEqual({ deleted: 1 })
    const left = await remaining()
    expect(left.has(before)).toBe(false)
    expect([exact, after, recent].every(id => left.has(id))).toBe(true)
  })

})

describe('excepción por incidente abierto', () => {
  it('conserva los registros cuyo actor o destinatario tiene protección activa o recuperación pendiente', async () => {
    const owner = await account()
    const held = await account({ hold: true })
    const recovering = await account({ recovery: true })
    const plain = await account()

    const kept = [
      await audit(OLD, owner, held),
      await audit(OLD, held, held, 'SECURITY_RECOVERY_COMPLETED'),
      await audit(OLD, held, plain),
      await audit(OLD, null, recovering, 'SECURITY_RECOVERY_LINK_REQUESTED'),
      await audit(OLD, owner, recovering),
    ]
    const gone = await audit(OLD, owner, plain)

    expect(await purge()).toEqual({ deleted: 1 })
    const left = await remaining()
    expect(left.has(gone)).toBe(false)
    expect(kept.every(id => left.has(id))).toBe(true)
  })

  it('después de resolver el incidente (recuperación completada) los registros vuelven a caducar', async () => {
    const owner = await account()
    const user = await account({ hold: true })
    const row = await audit(OLD, owner, user)

    expect(await purge()).toEqual({ deleted: 0 })
    // Retirada de la protección: queda la recuperación obligatoria, que sigue protegiendo.
    await admin.query(`UPDATE "User" SET "securityHoldAt" = NULL, "passwordResetRequiredAt" = now() WHERE id = $1`, [user])
    expect(await purge()).toEqual({ deleted: 0 })
    // Recuperación completada: incidente resuelto.
    await admin.query(`UPDATE "User" SET "passwordResetRequiredAt" = NULL WHERE id = $1`, [user])
    expect(await purge()).toEqual({ deleted: 1 })
    expect((await remaining()).has(row)).toBe(false)
  })

  it('una suspensión administrativa sin incidente no cambia la retención', async () => {
    const owner = await account()
    const suspended = await account()
    await admin.query(`UPDATE "User" SET "adminSuspendedAt" = now() WHERE id = $1`, [suspended])
    await audit(OLD, owner, suspended)
    expect(await purge()).toEqual({ deleted: 1 })
  })
})

describe('cuentas eliminadas y registros sin relación fiable', () => {
  it('los registros de cuentas ya eliminadas caducan con normalidad', async () => {
    const owner = await account()
    const row = await audit(OLD, owner, 'u-cuenta-eliminada')
    const both = await audit(OLD, 'u-otra-eliminada', 'u-cuenta-eliminada')
    expect(await purge()).toEqual({ deleted: 2 })
    const left = await remaining()
    expect(left.has(row) || left.has(both)).toBe(false)
  })

  it('sin actor ni cuenta afectada no se puede relacionar: se conserva', async () => {
    const orphan = await audit(OLD, null, null)
    expect(await purge()).toEqual({ deleted: 0 })
    expect((await remaining()).has(orphan)).toBe(true)
  })
})

describe('lote acotado sin starvation', () => {
  it('las filas protegidas más antiguas no ocupan el lote: las elegibles se borran en lotes sucesivos', async () => {
    const owner = await account()
    const held = await account({ hold: true })
    const plain = await account()
    const protectedRows = await Promise.all(Array.from({ length: 6 }, (_, index) => audit(at(-10 * 86_400_000 - index), owner, held)))
    const eligible = await Promise.all(Array.from({ length: 5 }, (_, index) => audit(at(-86_400_000 - index), owner, plain)))

    expect(await purge(2)).toEqual({ deleted: 2 })
    expect(await purge(2)).toEqual({ deleted: 2 })
    expect(await purge(2)).toEqual({ deleted: 1 })
    expect(await purge(2)).toEqual({ deleted: 0 })

    const left = await remaining()
    expect(eligible.some(id => left.has(id))).toBe(false)
    expect(protectedRows.every(id => left.has(id))).toBe(true)
  })

  it('borra primero los más antiguos', async () => {
    const owner = await account()
    const oldest = await audit(at(-3_000), owner, owner)
    const middle = await audit(at(-2_000), owner, owner)
    const newest = await audit(at(-1_000), owner, owner)

    expect(await purge(1)).toEqual({ deleted: 1 })
    const left = await remaining()
    expect(left.has(oldest)).toBe(false)
    expect(left.has(middle) && left.has(newest)).toBe(true)
  })
})

describe('solo AdminAuditLog', () => {
  it('no toca cuentas, sesiones ni tokens', async () => {
    const user = await account()
    await admin.query(`INSERT INTO "Session" (id, "tokenHash", "userId", "expiresAt") VALUES ('s1', 'hash-s1', $1, now() - interval '200 days')`, [user])
    await admin.query(`INSERT INTO "PasswordResetToken" (id, "tokenHash", "userId", "expiresAt", "createdAt") VALUES ('t1', 'hash-t1', $1, now() - interval '200 days', now() - interval '200 days')`, [user])
    await audit(OLD, user, user)
    const counts = async () => (await admin.query(`SELECT (SELECT count(*) FROM "User")::int AS u, (SELECT count(*) FROM "Session")::int AS s, (SELECT count(*) FROM "PasswordResetToken")::int AS t`)).rows[0]
    const before = await counts()

    expect(await purge()).toEqual({ deleted: 1 })
    expect(await counts()).toEqual(before)
  })
})

describe('concurrencia con la apertura y el cierre de un incidente', () => {
  const waitingOnLock = async () =>
    (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0].n

  it('un incidente abierto mientras la purga espera el bloqueo de la cuenta conserva sus registros', async () => {
    const owner = await account()
    const user = await account()
    const row = await audit(OLD, owner, user)

    // Transacción que abre el incidente (como reportSecurityIncident): bloquea la cuenta primero.
    const incident = new pg.Client({ connectionString: database.url })
    await incident.connect()
    try {
      await incident.query('BEGIN')
      await incident.query(`UPDATE "User" SET "role" = "role" WHERE id = $1`, [user])
      await incident.query(`UPDATE "User" SET "securityHoldAt" = now(), "securityHoldVersion" = "securityHoldVersion" + 1 WHERE id = $1`, [user])

      // La purga selecciona el registro (el incidente aún no está confirmado) y espera el bloqueo.
      const running = purge()
      await expect.poll(waitingOnLock, { timeout: 5_000, interval: 25 }).toBeGreaterThan(0)
      await incident.query('COMMIT')

      expect(await running).toEqual({ deleted: 0 })
      expect((await remaining()).has(row)).toBe(true)
    } finally {
      await incident.end()
    }
  })

  it('un incidente que se deshace (ROLLBACK) no impide la caducidad', async () => {
    const owner = await account()
    const user = await account()
    const row = await audit(OLD, owner, user)

    const incident = new pg.Client({ connectionString: database.url })
    await incident.connect()
    try {
      await incident.query('BEGIN')
      await incident.query(`UPDATE "User" SET "securityHoldAt" = now() WHERE id = $1`, [user])
      const running = purge()
      await expect.poll(waitingOnLock, { timeout: 5_000, interval: 25 }).toBeGreaterThan(0)
      await incident.query('ROLLBACK')

      expect(await running).toEqual({ deleted: 1 })
      expect((await remaining()).has(row)).toBe(false)
    } finally {
      await incident.end()
    }
  })

  it('un fallo dentro de la transacción no borra nada y un reintento posterior funciona', async () => {
    const owner = await account()
    const row = await audit(OLD, owner, owner)
    await admin.query(`
      CREATE FUNCTION fail_audit_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo simulado'; END $$;
      CREATE TRIGGER fail_audit_delete BEFORE DELETE ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION fail_audit_delete();
    `)
    try {
      await expect(purge()).rejects.toThrow()
      expect((await remaining()).has(row)).toBe(true)
    } finally {
      await admin.query(`DROP FUNCTION fail_audit_delete() CASCADE`)
    }
    expect(await purge()).toEqual({ deleted: 1 })
  })

  it('dos purgas simultáneas no se interbloquean ni borran de más', async () => {
    const owner = await account()
    const users = await Promise.all(Array.from({ length: 6 }, () => account()))
    const held = await account({ hold: true })
    const eligible = await Promise.all(users.flatMap(user => [audit(OLD, owner, user), audit(OLD, user, user)]))
    const kept = await audit(OLD, owner, held)

    const results = await Promise.all([purge(), purge()])
    expect(results.reduce((sum, result) => sum + result.deleted, 0)).toBe(eligible.length)
    const left = await remaining()
    expect(left.has(kept)).toBe(true)
    expect(eligible.some(id => left.has(id))).toBe(false)
  })
})
