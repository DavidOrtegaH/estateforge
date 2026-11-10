import { createHash } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Doble mínimo de Prisma y del correo. Solo comprueba qué pide el servicio; la atomicidad, el
// rollback y las carreras reales se prueban con SQLite (bloque 12 de la integración).
const db = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  passwordResetToken: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  adminAuditLog: { create: vi.fn() },
  // Si se indica, falla la transacción de esa cuenta (por su id).
  failTransactionFor: null as string | null,
  currentUserId: null as string | null,
}))

const mail = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('../db/prisma.js', () => ({
  prisma: {
    user: db.user,
    $transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => {
      const result = await callback(db)
      if (db.failTransactionFor !== null && db.currentUserId === db.failTransactionFor) throw new Error('Fallo simulado de la transacción')
      return result
    }),
  },
}))

vi.mock('./email.service.js', () => ({ emailService: { sendSecurityRecoveryEmail: mail.send } }))

import {
  countPendingRecoveryDeliveries,
  deliverRecoveryLinkInBackground,
  issueRequestedRecoveryLinks,
  newRecoveryToken,
  REQUEST_CANDIDATES_PAGE_SIZE,
  SECURITY_RECOVERY_REQUEST_COOLDOWN_MS,
  waitForPendingRecoveryDeliveries,
} from './security-recovery.service.js'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const INPUT = 'titular@estateforge.test'

function logger() {
  return { error: vi.fn() } as unknown as FastifyBaseLogger & { error: ReturnType<typeof vi.fn> }
}

function candidate(id: string, extra: Record<string, unknown> = {}) {
  return { id, securityHoldVersion: 2, securityRecoveryEmail: INPUT, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.failTransactionFor = null
  db.currentUserId = null
  db.user.findMany.mockResolvedValue([candidate('cuenta-1')])
  db.user.findUnique.mockResolvedValue(null)
  db.user.updateMany.mockImplementation(async (args: { where: { id: string } }) => {
    db.currentUserId = args.where.id
    return { count: 1 }
  })
  db.passwordResetToken.findFirst.mockResolvedValue(null)
  db.passwordResetToken.deleteMany.mockResolvedValue({ count: 1 })
  db.passwordResetToken.create.mockResolvedValue({})
  db.adminAuditLog.create.mockResolvedValue({})
  mail.send.mockResolvedValue(undefined)
})

describe('newRecoveryToken', () => {
  it('crea un token SECURITY_RECOVERY de 1 hora ligado al destino y la versión', () => {
    const before = Date.now()
    const { token, expiresAt, data } = newRecoveryToken('cuenta-1', INPUT, 2)

    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(60 * 60_000 - 1_000)
    expect(data).toEqual({
      userId: 'cuenta-1', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt,
      purpose: 'SECURITY_RECOVERY', deliverTo: INPUT, securityHoldVersion: 2,
    })
  })
})

describe('issueRequestedRecoveryLinks', () => {
  it('busca por User.email o por destino guardado solo cuentas que pueden recibir un enlace', async () => {
    await issueRequestedRecoveryLinks(logger(), INPUT, NOW)

    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ email: INPUT }, { securityRecoveryEmail: INPUT }],
        passwordResetRequiredAt: { not: null },
        securityHoldAt: null,
        adminSuspendedAt: null,
        securityRecoveryEmail: { not: null },
      },
      select: { id: true, securityHoldVersion: true, securityRecoveryEmail: true },
      orderBy: { id: 'asc' },
      take: REQUEST_CANDIDATES_PAGE_SIZE,
    })
  })

  it('procesa todas las candidatas por páginas, con cursor estable y sin omitir ni repetir ninguna', async () => {
    const ids = Array.from({ length: REQUEST_CANDIDATES_PAGE_SIZE + 3 }, (_, i) => `cuenta-${String(i).padStart(3, '0')}`)
    db.user.findMany.mockImplementation(async (args: { where: { id?: { gt: string } }; take: number }) => {
      const after = args.where.id?.gt
      return ids.filter(id => after === undefined || id > after).slice(0, args.take).map(id => candidate(id))
    })
    // Algunas no pueden recibir enlace (enlace reciente); el resto sí.
    const cooling = new Set(['cuenta-003', 'cuenta-049', 'cuenta-051'])
    db.passwordResetToken.findFirst.mockImplementation(async (args: { where: { userId: string } }) =>
      cooling.has(args.where.userId) ? { id: 'reciente' } : null)

    const links = await issueRequestedRecoveryLinks(logger(), INPUT, NOW)

    expect(db.user.findMany).toHaveBeenCalledTimes(2)
    expect(db.user.findMany.mock.calls[0][0].where.id).toBeUndefined()
    expect(db.user.findMany.mock.calls[1][0].where.id).toEqual({ gt: ids[REQUEST_CANDIDATES_PAGE_SIZE - 1] })
    // Cada candidata se evalúa exactamente una vez.
    expect(db.passwordResetToken.findFirst.mock.calls.map(call => call[0].where.userId)).toEqual(ids)
    expect(links.map(link => link.userId)).toEqual(ids.filter(id => !cooling.has(id)))
  })

  it('con una página exacta hace una consulta más, vacía, y termina', async () => {
    const ids = Array.from({ length: REQUEST_CANDIDATES_PAGE_SIZE }, (_, i) => `cuenta-${String(i).padStart(3, '0')}`)
    db.user.findMany.mockImplementation(async (args: { where: { id?: { gt: string } }; take: number }) => {
      const after = args.where.id?.gt
      return ids.filter(id => after === undefined || id > after).slice(0, args.take).map(id => candidate(id))
    })

    const links = await issueRequestedRecoveryLinks(logger(), INPUT, NOW)

    expect(db.user.findMany).toHaveBeenCalledTimes(2)
    expect(links).toHaveLength(REQUEST_CANDIDATES_PAGE_SIZE)
  })

  it('emite el enlace al destino guardado con la versión actual, sustituye los obligatorios no usados y audita sin metadatos', async () => {
    db.user.findMany.mockResolvedValue([candidate('cuenta-1', { securityRecoveryEmail: 'destino@estateforge.test' })])

    const links = await issueRequestedRecoveryLinks(logger(), 'actual-del-atacante@estateforge.test', NOW)

    expect(links).toEqual([{ userId: 'cuenta-1', to: 'destino@estateforge.test', token: expect.stringMatching(/^[a-f0-9]{64}$/), expiresAt: expect.any(Date) }])
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'destino@estateforge.test' }, select: { id: true } })
    expect(db.passwordResetToken.findFirst).toHaveBeenCalledWith({
      where: { userId: 'cuenta-1', purpose: 'SECURITY_RECOVERY', createdAt: { gt: new Date(NOW.getTime() - SECURITY_RECOVERY_REQUEST_COOLDOWN_MS) } },
      select: { id: true },
    })
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cuenta-1', passwordResetRequiredAt: { not: null }, securityHoldAt: null, adminSuspendedAt: null,
        securityHoldVersion: 2, securityRecoveryEmail: 'destino@estateforge.test',
      },
      // Mismo valor: solo confirma el estado; nunca cambia el destino, la versión ni nada más.
      data: { securityRecoveryEmail: 'destino@estateforge.test' },
    })
    expect(db.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'cuenta-1', usedAt: null, purpose: 'SECURITY_RECOVERY' } })
    expect(db.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'cuenta-1', purpose: 'SECURITY_RECOVERY', deliverTo: 'destino@estateforge.test', securityHoldVersion: 2 }),
    })
    expect(db.adminAuditLog.create).toHaveBeenCalledWith({
      data: { actorUserId: null, targetUserId: 'cuenta-1', action: 'SECURITY_RECOVERY_LINK_REQUESTED' },
    })
  })

  it('el enfriamiento es de 15 minutos', () => {
    expect(SECURITY_RECOVERY_REQUEST_COOLDOWN_MS).toBe(15 * 60_000)
  })

  it.each([
    ['el destino es el email de otra cuenta', () => db.user.findUnique.mockResolvedValue({ id: 'otra-cuenta' })],
    ['la cuenta tiene un enlace de hace menos de 15 minutos', () => db.passwordResetToken.findFirst.mockResolvedValue({ id: 'reciente' })],
    ['la cuenta cambió de estado antes de escribir', () => db.user.updateMany.mockResolvedValue({ count: 0 })],
  ])('no emite nada si %s', async (_label, arrange) => {
    arrange()

    await expect(issueRequestedRecoveryLinks(logger(), INPUT, NOW)).resolves.toEqual([])

    expect(db.passwordResetToken.deleteMany).not.toHaveBeenCalled()
    expect(db.passwordResetToken.create).not.toHaveBeenCalled()
    expect(db.adminAuditLog.create).not.toHaveBeenCalled()
  })

  it('el destino puede ser el propio email de la cuenta', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'cuenta-1' })

    await expect(issueRequestedRecoveryLinks(logger(), INPUT, NOW)).resolves.toHaveLength(1)
  })

  it('evalúa cada cuenta por separado: una que no puede recibir enlace no impide las demás', async () => {
    db.user.findMany.mockResolvedValue([candidate('cuenta-1'), candidate('cuenta-2'), candidate('cuenta-3')])
    // cuenta-2 tiene un enlace reciente.
    db.passwordResetToken.findFirst.mockImplementation(async (args: { where: { userId: string } }) =>
      args.where.userId === 'cuenta-2' ? { id: 'reciente' } : null)

    const links = await issueRequestedRecoveryLinks(logger(), INPUT, NOW)

    expect(links.map(link => link.userId)).toEqual(['cuenta-1', 'cuenta-3'])
    expect(db.passwordResetToken.create).toHaveBeenCalledTimes(2)
  })

  it('si falla la transacción de una cuenta, sigue con las demás y el log no incluye emails', async () => {
    db.user.findMany.mockResolvedValue([candidate('cuenta-1'), candidate('cuenta-2')])
    db.failTransactionFor = 'cuenta-1'
    const log = logger()

    const links = await issueRequestedRecoveryLinks(log, INPUT, NOW)

    expect(links.map(link => link.userId)).toEqual(['cuenta-2'])
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0]).toEqual([{ targetUserId: 'cuenta-1', errorName: 'Error' }, 'No se pudo emitir un enlace de recuperación solicitado'])
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('@')
  })

  it('sin candidatas no abre ninguna transacción', async () => {
    db.user.findMany.mockResolvedValue([])

    await expect(issueRequestedRecoveryLinks(logger(), INPUT, NOW)).resolves.toEqual([])

    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
})

describe('envío en segundo plano', () => {
  const link = { userId: 'cuenta-1', to: 'destino@estateforge.test', token: 'a'.repeat(64), expiresAt: NOW }

  it('no espera al envío y waitForPendingRecoveryDeliveries espera a que termine', async () => {
    let finish: () => void = () => undefined
    mail.send.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    let waited = false

    deliverRecoveryLinkInBackground(logger(), link)
    const waiting = waitForPendingRecoveryDeliveries().then(() => { waited = true })
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(waited).toBe(false)
    finish()
    await waiting
    expect(waited).toBe(true)
  })

  it('envía al destino con el enlace de /recuperar-cuenta', async () => {
    deliverRecoveryLinkInBackground(logger(), link)
    await waitForPendingRecoveryDeliveries()

    const args = mail.send.mock.calls[0][0]
    expect(args.to).toBe('destino@estateforge.test')
    expect(new URL(args.recoveryUrl).pathname).toBe('/recuperar-cuenta')
    expect(new URL(args.recoveryUrl).searchParams.get('token')).toBe(link.token)
  })

  it('un fallo del envío se registra sin destino, token ni enlace y no deja el envío pendiente', async () => {
    mail.send.mockRejectedValue(new Error('SMTP caído para destino@estateforge.test'))
    const log = logger()

    deliverRecoveryLinkInBackground(log, link)
    await waitForPendingRecoveryDeliveries()

    expect(log.error).toHaveBeenCalledWith({ flow: 'security_recovery', targetUserId: 'cuenta-1', errorName: 'Error' }, 'No se pudo enviar el enlace de recuperación obligatoria')
    const output = JSON.stringify(log.error.mock.calls)
    for (const secret of ['destino@estateforge.test', link.token, 'recuperar-cuenta']) expect(output).not.toContain(secret)
    await expect(waitForPendingRecoveryDeliveries()).resolves.toEqual({ timedOut: false, pending: 0 })
    expect(countPendingRecoveryDeliveries()).toBe(0)
  })

  it('un error antes del SMTP (enlace imposible de construir) se gestiona: sin unhandledRejection y sin pendientes', async () => {
    // Módulo nuevo con un WEB_APP_URL no válido: new URL() falla antes de llamar al correo.
    vi.resetModules()
    vi.stubEnv('WEB_APP_URL', 'no es una url')
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const fresh = await import('./security-recovery.service.js')
      const log = logger()

      fresh.deliverRecoveryLinkInBackground(log, link)
      expect(fresh.countPendingRecoveryDeliveries()).toBe(1)
      await fresh.waitForPendingRecoveryDeliveries()
      // Da tiempo a que Node notifique un rechazo sin gestionar, si lo hubiera.
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(unhandled).toEqual([])
      expect(fresh.countPendingRecoveryDeliveries()).toBe(0)
      expect(mail.send).not.toHaveBeenCalled()
      // El código de Node (ERR_INVALID_URL) es un campo cerrado; el mensaje, que cita la URL, no se registra.
      expect(log.error).toHaveBeenCalledWith({ flow: 'security_recovery', targetUserId: 'cuenta-1', errorName: 'TypeError', errorCode: 'ERR_INVALID_URL' }, 'No se pudo enviar el enlace de recuperación obligatoria')
      const output = JSON.stringify(log.error.mock.calls)
      for (const secret of [link.to, link.token, 'recuperar-cuenta', 'no es una url']) expect(output).not.toContain(secret)
    } finally {
      process.off('unhandledRejection', onUnhandled)
      vi.unstubAllEnvs()
    }
  })
})
