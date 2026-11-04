import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Doble mínimo: $transaction ejecuta el callback con un tx de vi.fn.
// Solo comprueba qué operaciones pide el servicio y en qué orden; la
// atomicidad y el rollback reales de SQLite son responsabilidad de V4.
const txMock = vi.hoisted(() => ({
  securityIncidentToken: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  user: { update: vi.fn() },
  session: { deleteMany: vi.fn() },
  passwordResetToken: { deleteMany: vi.fn() },
  emailChangeVerification: { deleteMany: vi.fn() },
}))

// Operaciones fuera de transacción, las que usa la emisión del token.
const issueMock = vi.hoisted(() => ({
  securityIncidentToken: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
}))

vi.mock('../db/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
    securityIncidentToken: issueMock.securityIncidentToken,
  },
}))

import { issueSecurityIncidentToken, reportSecurityIncident } from './security-incident.service.js'

const TOKEN = 'a'.repeat(64)
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')
const USER_ID = 'user-1'
const RECORD_ID = 'incident-1'
const NOTIFIED_EMAIL = 'anterior@estateforge.test'

function validRecord(extra: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    userId: USER_ID,
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    notifiedEmail: NOTIFIED_EMAIL,
    ...extra,
  }
}

describe('issueSecurityIncidentToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    issueMock.securityIncidentToken.deleteMany.mockResolvedValue({ count: 0 })
    issueMock.securityIncidentToken.create.mockResolvedValue({})
  })

  it('guarda el email avisado normalizado junto al hash del token', async () => {
    const { token } = await issueSecurityIncidentToken(USER_ID, '  Anterior@EstateForge.TEST ')

    expect(issueMock.securityIncidentToken.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: expect.any(Date),
        notifiedEmail: NOTIFIED_EMAIL,
      },
    })
  })

  it('mantiene el borrado de los tokens pendientes antes de crear el nuevo', async () => {
    await issueSecurityIncidentToken(USER_ID, NOTIFIED_EMAIL)

    expect(issueMock.securityIncidentToken.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID, usedAt: null } })
    expect(issueMock.securityIncidentToken.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      issueMock.securityIncidentToken.create.mock.invocationCallOrder[0],
    )
  })
})

describe('reportSecurityIncident', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    txMock.securityIncidentToken.findUnique.mockResolvedValue(validRecord())
    txMock.securityIncidentToken.updateMany.mockResolvedValue({ count: 1 })
    txMock.securityIncidentToken.deleteMany.mockResolvedValue({ count: 0 })
    txMock.user.update.mockResolvedValue({})
    txMock.session.deleteMany.mockResolvedValue({ count: 0 })
    txMock.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 })
    txMock.emailChangeVerification.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('protege la cuenta, incrementa la versión y propone el email avisado como destino', async () => {
    const before = Date.now()

    await expect(reportSecurityIncident(TOKEN)).resolves.toBe('reported')

    expect(txMock.user.update).toHaveBeenCalledTimes(1)
    const call = txMock.user.update.mock.calls[0][0]
    // toEqual exacto: no escribe User.email ni ningún otro campo.
    expect(call).toEqual({
      where: { id: USER_ID },
      data: {
        securityHoldAt: expect.any(Date),
        securityHoldVersion: { increment: 1 },
        securityRecoveryEmail: NOTIFIED_EMAIL,
      },
    })
    const holdAt: Date = call.data.securityHoldAt
    expect(Number.isNaN(holdAt.getTime())).toBe(false)
    expect(holdAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(holdAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('deja el destino a null si el token es anterior a E2 y no guarda email', async () => {
    txMock.securityIncidentToken.findUnique.mockResolvedValue(validRecord({ notifiedEmail: null }))

    await expect(reportSecurityIncident(TOKEN)).resolves.toBe('reported')

    expect(txMock.user.update.mock.calls[0][0].data.securityRecoveryEmail).toBeNull()
  })

  it('usa la misma fecha para reclamar el token y para la protección', async () => {
    await reportSecurityIncident(TOKEN)

    const claim = txMock.securityIncidentToken.updateMany.mock.calls[0][0]
    expect(claim).toEqual({
      where: { id: RECORD_ID, usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    })
    const holdAt: Date = txMock.user.update.mock.calls[0][0].data.securityHoldAt
    expect(claim.data.usedAt.getTime()).toBe(holdAt.getTime())
    expect(claim.where.expiresAt.gt.getTime()).toBe(holdAt.getTime())
  })

  it('mantiene los borrados con sus condiciones actuales', async () => {
    await reportSecurityIncident(TOKEN)

    expect(txMock.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    expect(txMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    expect(txMock.emailChangeVerification.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    expect(txMock.securityIncidentToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { not: RECORD_ID } },
    })
  })

  it('reclama el token antes de incrementar la versión y borra después', async () => {
    await reportSecurityIncident(TOKEN)

    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]
    expect(order(txMock.securityIncidentToken.findUnique)).toBeLessThan(order(txMock.securityIncidentToken.updateMany))
    expect(order(txMock.securityIncidentToken.updateMany)).toBeLessThan(order(txMock.user.update))
    expect(order(txMock.user.update)).toBeLessThan(order(txMock.session.deleteMany))
  })

  it('busca el token por su hash SHA-256, no en claro', async () => {
    await reportSecurityIncident(TOKEN)

    expect(txMock.securityIncidentToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: TOKEN_HASH },
      select: { id: true, userId: true, expiresAt: true, usedAt: true, notifiedEmail: true },
    })
  })

  it.each([
    ['no existe', null],
    ['ya se usó', validRecord({ usedAt: new Date() })],
    ['ha caducado', validRecord({ expiresAt: new Date(Date.now() - 1) })],
  ])('no incrementa la versión ni cambia el destino si el token %s', async (_label, record) => {
    txMock.securityIncidentToken.findUnique.mockResolvedValue(record)

    await expect(reportSecurityIncident(TOKEN)).resolves.toBe('invalid')

    expect(txMock.securityIncidentToken.updateMany).not.toHaveBeenCalled()
    expect(txMock.user.update).not.toHaveBeenCalled()
    expect(txMock.session.deleteMany).not.toHaveBeenCalled()
  })

  it('no incrementa la versión ni cambia el destino si otra petición reclama el token antes', async () => {
    txMock.securityIncidentToken.updateMany.mockResolvedValue({ count: 0 })

    await expect(reportSecurityIncident(TOKEN)).resolves.toBe('invalid')

    expect(txMock.user.update).not.toHaveBeenCalled()
    expect(txMock.session.deleteMany).not.toHaveBeenCalled()
    expect(txMock.securityIncidentToken.deleteMany).not.toHaveBeenCalled()
  })

  // Solo demuestra que el error sale de la transacción (lo que en Prisma provoca el
  // rollback); que el incremento se deshaga de verdad solo se comprueba en V4.
  it('propaga el error si falla una operación posterior al incremento', async () => {
    txMock.session.deleteMany.mockRejectedValue(new Error('Fallo simulado al borrar sesiones'))

    await expect(reportSecurityIncident(TOKEN)).rejects.toThrow('Fallo simulado al borrar sesiones')

    expect(txMock.user.update).toHaveBeenCalledTimes(1)
    expect(txMock.passwordResetToken.deleteMany).not.toHaveBeenCalled()
    expect(txMock.securityIncidentToken.deleteMany).not.toHaveBeenCalled()
  })
})
