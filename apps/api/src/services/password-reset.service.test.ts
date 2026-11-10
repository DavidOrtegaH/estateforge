import { beforeEach, describe, expect, it, vi } from 'vitest'

// Doble mínimo de Prisma: $transaction ejecuta el callback con tx o resuelve el array.
// Solo comprueba qué operaciones pide el servicio; la atomicidad y el rollback reales
// de SQLite se prueban en la integración (bloque 10).
const db = vi.hoisted(() => ({
  // Bloqueo de la fila de la cuenta (F0-001): devuelve las filas afectadas.
  $executeRaw: vi.fn(async () => 1),
  passwordResetToken: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  session: { deleteMany: vi.fn() },
  emailChangeVerification: { deleteMany: vi.fn() },
  emailVerificationToken: { updateMany: vi.fn() },
  adminAuditLog: { create: vi.fn() },
}))

vi.mock('../db/prisma.js', () => ({
  prisma: {
    ...db,
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof db) => Promise<unknown>)(db)),
  },
}))

import {
  consumePasswordResetToken,
  consumeSecurityRecoveryToken,
  createPasswordResetToken,
  getPasswordResetExpiry,
  hashPasswordResetToken,
  issuePasswordResetToken,
  PASSWORD_RESET_TOKEN_DURATION_MS,
} from './password-reset.service.js'

const TOKEN = 'a'.repeat(64)
const USER_ID = 'user-1'
const DESTINATION = 'titular@estateforge.test'
const SINCE = new Date('2026-11-02T10:00:00.000Z')

// El bloqueo de la cuenta (F0-001) es la primera escritura de la transacción: va antes de leer la
// cuenta y de cualquier escritura de tokens o sesiones.
function expectUserLockedFirst(laterCalls: { mock: { invocationCallOrder: number[] } }[]) {
  expect(db.$executeRaw).toHaveBeenCalledOnce()
  const [sql, ...values] = db.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
  expect(sql.join('?')).toBe('UPDATE "User" SET "role" = "role" WHERE "id" = ?')
  expect(values).toEqual([USER_ID])
  for (const later of laterCalls) {
    for (const order of later.mock.invocationCallOrder) expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(order)
  }
}

function future() {
  return new Date(Date.now() + 60_000)
}

describe('password-reset.service', () => {
  it('genera tokens de recuperación con suficiente entropía', () => {
    const first = createPasswordResetToken()
    const second = createPasswordResetToken()

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toMatch(/^[a-f0-9]{64}$/)
    expect(second).not.toBe(first)
  })

  it('almacena un hash determinista del token', () => {
    expect(
      hashPasswordResetToken('token-de-prueba'),
    ).toBe(
      hashPasswordResetToken('token-de-prueba'),
    )
    expect(
      hashPasswordResetToken('token-de-prueba'),
    ).not.toBe(
      hashPasswordResetToken('otro-token'),
    )
  })

  it('establece una caducidad de una hora', () => {
    const now = 1_700_000_000_000
    const expiresAt = getPasswordResetExpiry(now)

    expect(expiresAt.getTime()).toBe(
      now + PASSWORD_RESET_TOKEN_DURATION_MS,
    )
  })
})

describe('issuePasswordResetToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 })
    db.passwordResetToken.create.mockResolvedValue({})
  })

  it('solo sustituye tokens de autoservicio pendientes, nunca uno obligatorio', async () => {
    const { token } = await issuePasswordResetToken(USER_ID)

    expect(db.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, usedAt: null, purpose: 'SELF_SERVICE' },
    })
    expect(db.passwordResetToken.create).toHaveBeenCalledWith({
      data: { tokenHash: hashPasswordResetToken(token), userId: USER_ID, expiresAt: expect.any(Date), purpose: 'SELF_SERVICE' },
    })
    expectUserLockedFirst([db.passwordResetToken.deleteMany, db.passwordResetToken.create])
  })
})

describe('consumePasswordResetToken (autoservicio)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.passwordResetToken.findUnique.mockResolvedValue({ id: 't-1', userId: USER_ID, expiresAt: future(), usedAt: null, purpose: 'SELF_SERVICE' })
    db.user.findUnique.mockResolvedValue({ securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: null })
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 })
    db.user.update.mockResolvedValue({})
    db.session.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('una cuenta normal sigue igual: reclama, cambia la contraseña y cierra sesiones', async () => {
    await expect(consumePasswordResetToken(TOKEN, 'hash-nuevo')).resolves.toBe(true)

    expect(db.passwordResetToken.findUnique.mock.calls[0][0].select).toMatchObject({ purpose: true })
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', usedAt: null, expiresAt: { gt: expect.any(Date) }, purpose: 'SELF_SERVICE' },
      data: { usedAt: expect.any(Date) },
    })
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { password: 'hash-nuevo' } })
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    expectUserLockedFirst([db.user.findUnique, db.passwordResetToken.updateMany, db.user.update, db.session.deleteMany])
  })

  it('si la cuenta ya no existe al bloquearla, no reclama el token ni escribe', async () => {
    db.$executeRaw.mockResolvedValueOnce(0)

    await expect(consumePasswordResetToken(TOKEN, 'hash-nuevo')).resolves.toBe(false)

    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(db.passwordResetToken.updateMany).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
    expect(db.session.deleteMany).not.toHaveBeenCalled()
  })

  it('rechaza un token SECURITY_RECOVERY sin reclamarlo', async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({ id: 't-1', userId: USER_ID, expiresAt: future(), usedAt: null, purpose: 'SECURITY_RECOVERY' })

    await expect(consumePasswordResetToken(TOKEN, 'hash-nuevo')).resolves.toBe(false)

    expect(db.passwordResetToken.updateMany).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it.each([
    ['recuperación obligatoria pendiente', { passwordResetRequiredAt: SINCE }],
    ['protección por incidente', { securityHoldAt: SINCE }],
    ['suspensión administrativa', { adminSuspendedAt: SINCE }],
  ])('rechaza la cuenta con %s sin reclamar el token', async (_label, state) => {
    db.user.findUnique.mockResolvedValue({ securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: null, ...state })

    await expect(consumePasswordResetToken(TOKEN, 'hash-nuevo')).resolves.toBe(false)

    expect(db.user.findUnique.mock.calls[0][0].select).toEqual({ securityHoldAt: true, adminSuspendedAt: true, passwordResetRequiredAt: true })
    expect(db.passwordResetToken.updateMany).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })
})

describe('consumeSecurityRecoveryToken', () => {
  function recoveryToken(extra: Record<string, unknown> = {}) {
    return {
      id: 'rec-1', userId: USER_ID, expiresAt: future(), usedAt: null,
      purpose: 'SECURITY_RECOVERY', deliverTo: DESTINATION, securityHoldVersion: 2, ...extra,
    }
  }

  // Caso típico de un incidente: el email actual de la cuenta no es el destino.
  const CURRENT_EMAIL = 'atacante@estateforge.test'

  function account(extra: Record<string, unknown> = {}) {
    return {
      email: CURRENT_EMAIL, passwordResetRequiredAt: SINCE, securityHoldAt: null, adminSuspendedAt: null,
      securityHoldVersion: 2, securityRecoveryEmail: DESTINATION, ...extra,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    db.passwordResetToken.findUnique.mockResolvedValue(recoveryToken())
    // Primera lectura: la cuenta del token; segunda: quién tiene el email de destino.
    db.user.findUnique.mockImplementation(async (args: { where: { id?: string; email?: string } }) =>
      args.where.id ? account() : null)
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 })
    db.user.updateMany.mockResolvedValue({ count: 1 })
    db.session.deleteMany.mockResolvedValue({ count: 0 })
    db.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 })
    db.emailChangeVerification.deleteMany.mockResolvedValue({ count: 0 })
    db.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 })
    db.adminAuditLog.create.mockResolvedValue({})
  })

  function writes() {
    return [
      db.passwordResetToken.updateMany, db.user.updateMany, db.session.deleteMany,
      db.passwordResetToken.deleteMany, db.emailChangeVerification.deleteMany,
      db.emailVerificationToken.updateMany, db.adminAuditLog.create,
    ]
  }

  it('completa: reclama, restaura el email, cambia la contraseña, limpia y audita', async () => {
    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('completed')

    expect(db.passwordResetToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashPasswordResetToken(TOKEN) } }))
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', usedAt: null, expiresAt: { gt: expect.any(Date) }, purpose: 'SECURITY_RECOVERY' },
      data: { usedAt: expect.any(Date) },
    })
    // La escritura repite también el email leído; la dirección cambia, así que la cuenta queda
    // sin verificar (decisión D2).
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: USER_ID, email: CURRENT_EMAIL, passwordResetRequiredAt: { not: null }, securityHoldAt: null, adminSuspendedAt: null,
        securityHoldVersion: 2, securityRecoveryEmail: DESTINATION,
      },
      data: { password: 'hash-nuevo', email: DESTINATION, passwordResetRequiredAt: null, securityRecoveryEmail: null, emailVerifiedAt: null },
    })
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    expect(db.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID, usedAt: null } })
    expect(db.emailChangeVerification.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID, usedAt: null } })
    expect(db.emailVerificationToken.updateMany).toHaveBeenCalledWith({ where: { userId: USER_ID, usedAt: null }, data: { usedAt: expect.any(Date) } })
    // Exacto: sin metadatos, motivo, emails, token ni enlace.
    expect(db.adminAuditLog.create).toHaveBeenCalledWith({
      data: { actorUserId: USER_ID, targetUserId: USER_ID, action: 'SECURITY_RECOVERY_COMPLETED' },
    })
    expectUserLockedFirst([db.user.findUnique, ...writes()])
  })

  it('state_mismatch sin escrituras si la cuenta ya no existe al bloquearla', async () => {
    db.$executeRaw.mockResolvedValueOnce(0)

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('state_mismatch')

    expect(db.user.findUnique).not.toHaveBeenCalled()
    for (const write of writes()) expect(write).not.toHaveBeenCalled()
  })

  it.each([
    ['no existe', null],
    ['ya se usó', recoveryToken({ usedAt: new Date() })],
    ['ha caducado', recoveryToken({ expiresAt: new Date(Date.now() - 1) })],
    ['es de autoservicio', recoveryToken({ purpose: 'SELF_SERVICE' })],
    ['no tiene destino', recoveryToken({ deliverTo: null })],
    ['no tiene versión', recoveryToken({ securityHoldVersion: null })],
  ])('invalid_token sin escrituras si el token %s', async (_label, record) => {
    db.passwordResetToken.findUnique.mockResolvedValue(record)

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('invalid_token')

    for (const write of writes()) expect(write).not.toHaveBeenCalled()
  })

  it.each([
    ['la cuenta no existe', null],
    ['ya no requiere recuperación', account({ passwordResetRequiredAt: null })],
    ['tiene una protección activa', account({ securityHoldAt: SINCE })],
    ['está suspendida', account({ adminSuspendedAt: SINCE })],
    ['tiene otra versión', account({ securityHoldVersion: 3 })],
    ['tiene otro destino', account({ securityRecoveryEmail: 'otro@estateforge.test' })],
  ])('state_mismatch sin escrituras si %s', async (_label, state) => {
    db.user.findUnique.mockImplementation(async (args: { where: { id?: string } }) => (args.where.id ? state : null))

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('state_mismatch')

    for (const write of writes()) expect(write).not.toHaveBeenCalled()
  })

  it('invalid_token si otra petición reclama el token antes', async () => {
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 })

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('invalid_token')

    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  // Con el doble solo se ve que la transacción termina en excepción (lo que provoca el
  // ROLLBACK en Prisma); que el token quede sin reclamar se comprueba con SQLite real.
  it('email_taken si el destino pertenece a otra cuenta, sin tocar la cuenta', async () => {
    db.user.findUnique.mockImplementation(async (args: { where: { id?: string } }) =>
      args.where.id ? account() : { id: 'otra-cuenta' })

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('email_taken')

    expect(db.user.findUnique).toHaveBeenLastCalledWith({ where: { email: DESTINATION }, select: { id: true } })
    expect(db.user.updateMany).not.toHaveBeenCalled()
    expect(db.adminAuditLog.create).not.toHaveBeenCalled()
  })

  it('si el destino ya es el email de la propia cuenta, completa', async () => {
    db.user.findUnique.mockImplementation(async (args: { where: { id?: string } }) =>
      args.where.id ? account() : { id: USER_ID })

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('completed')
  })

  it('si la dirección no cambia, conserva emailVerifiedAt (no lo escribe) e invalida los enlaces pendientes', async () => {
    db.user.findUnique.mockImplementation(async (args: { where: { id?: string } }) =>
      args.where.id ? account({ email: DESTINATION }) : { id: USER_ID })

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('completed')

    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: USER_ID, email: DESTINATION, passwordResetRequiredAt: { not: null }, securityHoldAt: null, adminSuspendedAt: null,
        securityHoldVersion: 2, securityRecoveryEmail: DESTINATION,
      },
      data: { password: 'hash-nuevo', email: DESTINATION, passwordResetRequiredAt: null, securityRecoveryEmail: null },
    })
    expect(db.emailVerificationToken.updateMany).toHaveBeenCalledWith({ where: { userId: USER_ID, usedAt: null }, data: { usedAt: expect.any(Date) } })
  })

  it('traduce un P2002 a email_taken', async () => {
    db.user.updateMany.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('email_taken')

    expect(db.session.deleteMany).not.toHaveBeenCalled()
  })

  it('state_mismatch si la escritura condicional no encuentra la cuenta en el estado leído', async () => {
    db.user.updateMany.mockResolvedValue({ count: 0 })

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).resolves.toBe('state_mismatch')

    expect(db.session.deleteMany).not.toHaveBeenCalled()
  })

  it('propaga cualquier otro error', async () => {
    db.session.deleteMany.mockRejectedValue(new Error('Fallo simulado al borrar sesiones'))

    await expect(consumeSecurityRecoveryToken(TOKEN, 'hash-nuevo')).rejects.toThrow('Fallo simulado al borrar sesiones')
  })
})
