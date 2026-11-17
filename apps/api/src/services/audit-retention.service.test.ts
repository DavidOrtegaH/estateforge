import { describe, expect, it, vi } from 'vitest'

// Unitarias de la retención de AdminAuditLog con un doble de la base: umbral, lote, orden de
// bloqueos y fallo seguro. La semántica SQL real (excepción por incidente, frontera, starvation,
// concurrencia) se prueba con PostgreSQL efímero en src/integration/audit-retention.integration.test.ts.

vi.mock('../db/prisma.js', () => ({ prisma: {} }))

import {
  AUDIT_RETENTION_BATCH,
  AUDIT_RETENTION_DAYS,
  AUDIT_RETENTION_MAX_BATCH,
  AUDIT_RETENTION_MS,
  auditRetentionCutoff,
  purgeExpiredAuditLogs,
  type PurgeAuditOptions,
} from './audit-retention.service.js'

type Row = { id: string; actorUserId: string | null; targetUserId: string | null }

function fakeDb(rows: Row[], options: { deleted?: number; failDelete?: Error } = {}) {
  const calls: { kind: string; text: string; values: unknown[] }[] = []
  const text = (strings: TemplateStringsArray) => strings.join('?')
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = text(strings)
      calls.push({ kind: sql.includes('DELETE') ? 'delete' : 'lock', text: sql, values })
      if (sql.includes('DELETE')) {
        if (options.failDelete) throw options.failDelete
        return options.deleted ?? rows.length
      }
      return 1
    }),
  }
  const db = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ kind: 'select', text: text(strings), values })
      return rows
    }),
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>, _opts?: unknown) => fn(tx)),
  }
  return { db: db as unknown as NonNullable<PurgeAuditOptions['db']>, raw: db, tx, calls }
}

const NOW = new Date('2026-11-17T04:00:00.000Z')

describe('umbral de 90 días', () => {
  it('es exactamente 90 días UTC antes de la referencia, sin depender de la zona ni del entorno', () => {
    expect(AUDIT_RETENTION_DAYS).toBe(90)
    expect(AUDIT_RETENTION_MS).toBe(90 * 86_400_000)
    expect(auditRetentionCutoff(NOW).toISOString()).toBe('2026-08-19T04:00:00.000Z')
    // Cruce del cambio de hora europeo: sigue siendo un intervalo fijo de 90 × 24 h en UTC.
    expect(auditRetentionCutoff(new Date('2026-04-01T00:00:00.000Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('una fecha de referencia no válida lanza antes de consultar nada', async () => {
    const { db, raw } = fakeDb([])
    expect(() => auditRetentionCutoff(new Date(Number.NaN))).toThrow()
    await expect(purgeExpiredAuditLogs({ db, now: new Date(Number.NaN) })).rejects.toThrow()
    expect(raw.$queryRaw).not.toHaveBeenCalled()
  })

  it('la consulta y el borrado usan el mismo umbral en ISO UTC con comparación estricta', async () => {
    const { db, calls } = fakeDb([{ id: 'a1', actorUserId: 'u1', targetUserId: 'u1' }])
    await purgeExpiredAuditLogs({ db, now: NOW })

    const select = calls.find(call => call.kind === 'select')!
    const remove = calls.find(call => call.kind === 'delete')!
    for (const call of [select, remove]) {
      expect(call.text).toContain('"createdAt" < ?::timestamptz')
      expect(call.values).toContain('2026-08-19T04:00:00.000Z')
    }
  })
})

describe('lote acotado', () => {
  it('por defecto pide como mucho AUDIT_RETENTION_BATCH, de los más antiguos', async () => {
    const { db, calls } = fakeDb([])
    await purgeExpiredAuditLogs({ db, now: NOW })
    const select = calls[0]
    expect(select.values).toContain(AUDIT_RETENTION_BATCH)
    expect(select.text).toMatch(/ORDER BY a\."createdAt" ASC, a\."id" ASC\s+LIMIT \?/)
  })

  it.each([0, -1, 1.5, AUDIT_RETENTION_MAX_BATCH + 1, Number.NaN])('rechaza el lote %s sin consultar', async (batchSize) => {
    const { db, raw } = fakeDb([])
    await expect(purgeExpiredAuditLogs({ db, now: NOW, batchSize })).rejects.toThrow()
    expect(raw.$queryRaw).not.toHaveBeenCalled()
  })

  it('la selección excluye ya los registros protegidos y los que no tienen cuenta relacionada (sin starvation)', async () => {
    const { db, calls } = fakeDb([])
    await purgeExpiredAuditLogs({ db, now: NOW })
    const select = calls[0]
    expect(select.text).toContain('(a."actorUserId" IS NOT NULL OR a."targetUserId" IS NOT NULL)')
    // La excepción va como fragmento SQL dentro de NOT (…), antes del LIMIT.
    expect(select.text).toMatch(/AND NOT \?\s+ORDER BY/)
    const fragment = select.values.find(value => typeof value === 'object' && value !== null && 'strings' in value) as { strings: string[] }
    expect(fragment.strings.join('?')).toMatch(/"securityHoldAt" IS NOT NULL OR u\."passwordResetRequiredAt" IS NOT NULL/)
  })

  it('sin candidatos no abre transacción ni bloquea cuentas', async () => {
    const { db, raw } = fakeDb([])
    expect(await purgeExpiredAuditLogs({ db, now: NOW })).toEqual({ deleted: 0 })
    expect(raw.$transaction).not.toHaveBeenCalled()
  })
})

describe('bloqueos y revalidación', () => {
  it('bloquea cada cuenta implicada una vez, en orden estable, antes de borrar y revalidar', async () => {
    const rows: Row[] = [
      { id: 'a1', actorUserId: 'u-owner', targetUserId: 'u-b' },
      { id: 'a2', actorUserId: null, targetUserId: 'u-a' },
      { id: 'a3', actorUserId: 'u-owner', targetUserId: 'u-borrada' },
    ]
    const { db, calls } = fakeDb(rows, { deleted: 2 })

    expect(await purgeExpiredAuditLogs({ db, now: NOW })).toEqual({ deleted: 2 })

    const locks = calls.filter(call => call.kind === 'lock')
    expect(locks.map(call => call.values[0])).toEqual(['u-a', 'u-b', 'u-borrada', 'u-owner'])
    expect(locks.every(call => call.text.includes('UPDATE "User" SET "role" = "role"'))).toBe(true)
    expect(calls.map(call => call.kind)).toEqual(['select', 'lock', 'lock', 'lock', 'lock', 'delete'])
    // El borrado repite la excepción tras los bloqueos.
    const remove = calls.at(-1)!
    expect(remove.text).toMatch(/AND NOT \?\s*$/)
  })

  it('un fallo dentro de la transacción se propaga (se deshace) sin cambiar el umbral', async () => {
    const failure = new Error('fallo simulado')
    const { db, calls } = fakeDb([{ id: 'a1', actorUserId: 'u1', targetUserId: 'u1' }], { failDelete: failure })

    await expect(purgeExpiredAuditLogs({ db, now: NOW })).rejects.toBe(failure)
    // Un segundo intento con la misma referencia usa exactamente el mismo umbral.
    const again = fakeDb([])
    await purgeExpiredAuditLogs({ db: again.db, now: NOW })
    expect(again.calls[0].values).toContain(calls[0].values.find(value => typeof value === 'string'))
  })
})
