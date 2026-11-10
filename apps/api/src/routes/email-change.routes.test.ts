import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Decisión D4 de la Fase 0: si el cambio de email se confirma pero falla el aviso a la
// dirección anterior, el cambio se mantiene y la respuesta lo indica, sin detalles internos.
// La transacción del cambio (D1) se prueba con SQLite real en la integración; aquí se sustituye
// consumeEmailChangeCode para probar la respuesta de la ruta.
const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    session: { findUnique: vi.fn(), deleteMany: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
  consumeEmailChangeCode: vi.fn(),
  issueSecurityIncidentToken: vi.fn(),
  sendEmailChangeNoticeEmail: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../services/session.service.js', () => ({ createSession: vi.fn(), deleteSession: vi.fn() }))
vi.mock('../services/password.service.js', () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }))
vi.mock('../services/turnstile.service.js', () => ({ verifyTurnstileToken: vi.fn(async () => true) }))
vi.mock('../services/security-recovery.service.js', () => ({
  issueRequestedRecoveryLinks: vi.fn(async () => []),
  deliverRecoveryLinkInBackground: vi.fn(),
  waitForPendingRecoveryDeliveries: vi.fn(async () => undefined),
}))
vi.mock('../services/password-reset.service.js', () => ({
  issuePasswordResetToken: vi.fn(),
  consumePasswordResetToken: vi.fn(),
  consumeSecurityRecoveryToken: vi.fn(),
}))
vi.mock('../services/security-incident.service.js', () => ({
  issueSecurityIncidentToken: mocks.issueSecurityIncidentToken,
  reportSecurityIncident: vi.fn(),
}))
vi.mock('../services/email.service.js', () => ({
  emailService: { sendEmailChangeNoticeEmail: mocks.sendEmailChangeNoticeEmail },
}))
vi.mock('../services/email-change.service.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/email-change.service.js')>()
  return { ...actual, consumeEmailChangeCode: mocks.consumeEmailChangeCode }
})

import { authRoutes } from './auth.routes.js'

const USER_ID = 'user-1'
const OLD_EMAIL = 'anterior@estateforge.test'
const NEW_EMAIL = 'nueva@estateforge.test'
const INCIDENT_TOKEN = 'i'.repeat(64)
const COOKIE = `estateforge_session=${'a'.repeat(64)}`
const NOTICE_FAILED_MESSAGE =
  'Email actualizado correctamente, pero no hemos podido enviar el aviso de seguridad a tu dirección anterior. No hace falta repetir el cambio.'

let app: FastifyInstance
let logs: string[]

const verify = (code = '123456') =>
  app.inject({ method: 'POST', url: '/api/auth/change-email/verify', headers: { cookie: COOKIE }, payload: { code } })

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.prisma.session.findUnique.mockResolvedValue({
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: USER_ID, email: OLD_EMAIL, password: 'hash', securityHoldAt: null, passwordResetRequiredAt: null,
      emailVerifiedAt: null, createdAt: new Date('2026-06-01T00:00:00.000Z'),
    },
  })
  mocks.consumeEmailChangeCode.mockResolvedValue({ success: true, email: NEW_EMAIL, oldEmail: OLD_EMAIL })
  mocks.issueSecurityIncidentToken.mockResolvedValue({ token: INCIDENT_TOKEN })
  mocks.sendEmailChangeNoticeEmail.mockResolvedValue(undefined)
  mocks.prisma.adminAuditLog.create.mockResolvedValue({})
  logs = []
  app = Fastify({ logger: { level: 'error', stream: { write: (line: string) => { logs.push(line) } } } })
  await app.register(authRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('POST /api/auth/change-email/verify y el aviso a la dirección anterior (D4)', () => {
  it('cambio completado y aviso enviado: la respuesta de siempre, con securityNoticeSent: true', async () => {
    const response = await verify()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      user: { id: USER_ID, email: NEW_EMAIL },
      securityNoticeSent: true,
      message: 'Email actualizado correctamente.',
    })
    expect(mocks.issueSecurityIncidentToken).toHaveBeenCalledWith(USER_ID, OLD_EMAIL)
    expect(mocks.sendEmailChangeNoticeEmail).toHaveBeenCalledWith({
      to: OLD_EMAIL,
      newEmail: NEW_EMAIL,
      stage: 'completed',
      incidentReportUrl: `http://localhost:3000/api/auth/security-incident/${INCIDENT_TOKEN}`,
    })
    // Sin fallo no hay nada que auditar (F0-002).
    expect(mocks.prisma.adminAuditLog.create).not.toHaveBeenCalled()
  })

  it.each([
    ['falla el SMTP', 'DELIVERY', () => mocks.sendEmailChangeNoticeEmail.mockRejectedValue(new Error(`550 mailbox ${OLD_EMAIL} unavailable`))],
    ['falla la emisión del enlace de incidente', 'INCIDENT_LINK', () => mocks.issueSecurityIncidentToken.mockRejectedValue(new Error('fallo de la base de datos'))],
  ])('cambio completado y aviso fallido (%s): 200, el cambio se mantiene y se indica sin detalles internos', async (_label, kind, prepare) => {
    prepare()

    const response = await verify()

    // No es un error: el cambio está hecho y no hay que repetirlo.
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      user: { id: USER_ID, email: NEW_EMAIL },
      securityNoticeSent: false,
      message: NOTICE_FAILED_MESSAGE,
    })
    expect(mocks.consumeEmailChangeCode).toHaveBeenCalledOnce()
    expect(response.payload).not.toContain('550')
    expect(response.payload).not.toContain('base de datos')
    // El fallo queda registrado, sin la dirección anterior ni el enlace de incidente.
    const logged = logs.join('\n')
    expect(logged).toContain('No se pudo enviar el aviso de cambio de email completado')
    expect(logged).not.toContain(OLD_EMAIL)
    expect(logged).not.toContain(INCIDENT_TOKEN)
    // Queda constancia para un OWNER: la propia cuenta como actor y objetivo, y solo la fase.
    expect(mocks.prisma.adminAuditLog.create).toHaveBeenCalledOnce()
    expect(mocks.prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: USER_ID,
        targetUserId: USER_ID,
        action: 'EMAIL_CHANGE_NOTICE_FAILED',
        metadata: JSON.stringify({ noticeFailure: kind }),
      },
    })
    const audited = JSON.stringify(mocks.prisma.adminAuditLog.create.mock.calls)
    for (const secret of [OLD_EMAIL, NEW_EMAIL, INCIDENT_TOKEN, 'security-incident', '550', 'base de datos']) {
      expect(audited).not.toContain(secret)
    }
  })

  it('si además falla la auditoría, el cambio sigue completado: 200 y el mismo mensaje, sin invitar a repetirlo', async () => {
    mocks.sendEmailChangeNoticeEmail.mockRejectedValue(new Error('SMTP caído'))
    mocks.prisma.adminAuditLog.create.mockRejectedValue(new Error('fallo de la base de datos al auditar'))

    const response = await verify()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      user: { id: USER_ID, email: NEW_EMAIL },
      securityNoticeSent: false,
      message: NOTICE_FAILED_MESSAGE,
    })
    const logged = logs.join('\n')
    expect(logged).toContain('No se pudo auditar el aviso de cambio de email no enviado')
    expect(logged).not.toContain('fallo de la base de datos al auditar')
  })

  it('un código no válido sigue respondiendo 400 y no intenta avisar', async () => {
    mocks.consumeEmailChangeCode.mockResolvedValue({ success: false, reason: 'invalid' })

    const response = await verify()

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ message: 'El código de verificación no es válido o ha caducado.' })
    expect(mocks.issueSecurityIncidentToken).not.toHaveBeenCalled()
    expect(mocks.sendEmailChangeNoticeEmail).not.toHaveBeenCalled()
  })
})
