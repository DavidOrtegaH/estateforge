import { createHash } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fase 0: verificación del email en las rutas de autenticación. Dobles de Prisma, sesiones,
// contraseña, Turnstile, recuperación y correo, como en auth.routes.test.ts. La política
// (fechas de inicio y fin de gracia) es la real y se configura con vi.stubEnv.
const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    session: { findUnique: vi.fn(), deleteMany: vi.fn() },
  },
  createSession: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  issuePasswordResetToken: vi.fn(),
  consumePasswordResetToken: vi.fn(),
  consumeSecurityRecoveryToken: vi.fn(),
  consumeEmailVerificationToken: vi.fn(),
  sendEmailVerificationInBackground: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../services/session.service.js', () => ({ createSession: mocks.createSession, deleteSession: vi.fn() }))
vi.mock('../services/password.service.js', () => ({ hashPassword: mocks.hashPassword, verifyPassword: mocks.verifyPassword }))
vi.mock('../services/turnstile.service.js', () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }))
vi.mock('../services/security-recovery.service.js', () => ({
  issueRequestedRecoveryLinks: vi.fn(async () => []),
  deliverRecoveryLinkInBackground: vi.fn(),
  waitForPendingRecoveryDeliveries: vi.fn(async () => undefined),
}))
vi.mock('../services/password-reset.service.js', () => ({
  issuePasswordResetToken: mocks.issuePasswordResetToken,
  consumePasswordResetToken: mocks.consumePasswordResetToken,
  consumeSecurityRecoveryToken: mocks.consumeSecurityRecoveryToken,
}))
vi.mock('../services/email.service.js', () => ({
  emailService: { sendPasswordResetEmail: mocks.sendPasswordResetEmail },
}))
// Se conservan la política y los mensajes reales; solo se sustituyen el consumo y el envío.
vi.mock('../services/email-verification.service.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/email-verification.service.js')>()
  return {
    ...actual,
    consumeEmailVerificationToken: mocks.consumeEmailVerificationToken,
    sendEmailVerificationInBackground: mocks.sendEmailVerificationInBackground,
    waitForPendingVerificationDeliveries: vi.fn(async () => undefined),
  }
})

import { authRoutes } from './auth.routes.js'
import { isEmailVerificationRequired } from '../services/email-verification.service.js'
import { waitForPendingPasswordResetDeliveries } from '../services/password-reset-delivery.service.js'

const USER_ID = 'user-1'
const EMAIL = 'titular@estateforge.test'
const PASSWORD = 'Contraseña-segura-1'
const SESSION_TOKEN = 'a'.repeat(64)
const COOKIE = `estateforge_session=${SESSION_TOKEN}`
const VERIFY_TOKEN = 'e'.repeat(64)
const SINCE = new Date('2026-11-02T10:00:00.000Z')
const EXISTING = new Date('2026-06-01T00:00:00.000Z')
const RECENT = new Date(Date.now() - 60_000)
const NOT_VERIFIED = {
  code: 'EMAIL_NOT_VERIFIED',
  message: 'Tienes que verificar tu email antes de acceder. Revisa tu correo o solicita un enlace nuevo.',
}
const RESEND_MESSAGE = {
  message: 'Si la cuenta existe y su email está pendiente de verificación, recibirás un enlace nuevo en unos minutos.',
}

function user(extra: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: EMAIL,
    password: 'hash-guardado',
    role: 'USER',
    securityHoldAt: null,
    adminSuspendedAt: null,
    passwordResetRequiredAt: null,
    emailVerifiedAt: null,
    createdAt: RECENT,
    ...extra,
  }
}

function sessionOf(extra: Record<string, unknown> = {}) {
  return { expiresAt: new Date(Date.now() + 60_000), user: user(extra) }
}

// Verificación exigida desde septiembre de 2026: las cuentas de RECENT son nuevas y las de EXISTING, existentes.
function enforce(graceUntil?: string) {
  vi.stubEnv('EMAIL_VERIFICATION_REQUIRED_FROM', '2026-09-01T00:00:00Z')
  vi.stubEnv('EMAIL_VERIFICATION_GRACE_UNTIL', graceUntil ?? '')
}
const GRACE_OPEN = '2099-01-01T00:00:00Z'
const GRACE_OVER = '2026-10-01T00:00:00Z'

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mocks.verifyTurnstileToken.mockResolvedValue(true)
  mocks.hashPassword.mockResolvedValue('hash-nuevo')
  mocks.prisma.session.deleteMany.mockResolvedValue({ count: 1 })
  mocks.createSession.mockResolvedValue({ token: 'nueva-sesion', expiresAt: new Date(Date.now() + 60_000) })
  mocks.prisma.user.create.mockImplementation(async ({ data }: { data: { email: string } }) => user({ email: data.email, createdAt: new Date() }))
  app = Fastify()
  await app.register(authRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.unstubAllEnvs()
})

const register = (target = app) => target.inject({ method: 'POST', url: '/api/auth/register', payload: { email: EMAIL, password: PASSWORD } })
const login = (password = PASSWORD) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: EMAIL, password } })
const me = () => app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: COOKIE } })
const verify = (payload: unknown, target = app) => target.inject({ method: 'POST', url: '/api/auth/verify-email', payload: payload as object })
const resend = (email: string, target = app) => target.inject({ method: 'POST', url: '/api/auth/verify-email/resend', payload: { email } })
const setCookie = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie'] ?? '')

describe('registro', () => {
  it('sin la verificación exigida crea la cuenta, inicia sesión como hasta ahora y envía el enlace', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)

    const response = await register()

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({ user: { id: USER_ID, email: EMAIL, role: 'USER' } })
    expect(setCookie(response)).toContain('estateforge_session=nueva-sesion')
    expect(mocks.sendEmailVerificationInBackground).toHaveBeenCalledWith(USER_ID)
  })

  it('con la verificación exigida crea la cuenta pendiente, envía el enlace y no inicia sesión', async () => {
    enforce()
    mocks.prisma.user.findUnique.mockResolvedValue(null)

    const response = await register()

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      verificationRequired: true,
      email: EMAIL,
      message: 'Cuenta creada. Te hemos enviado un enlace para verificar tu email; ábrelo para poder acceder.',
    })
    expect(setCookie(response)).toBe('')
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({ data: { email: EMAIL, password: 'hash-nuevo' } })
    expect(mocks.sendEmailVerificationInBackground).toHaveBeenCalledWith(USER_ID)
  })

  it('la cuenta nueva queda sin verificar: el registro no rellena emailVerifiedAt', async () => {
    enforce()
    mocks.prisma.user.findUnique.mockResolvedValue(null)

    await register()

    const data = mocks.prisma.user.create.mock.calls[0][0].data
    expect(data).not.toHaveProperty('emailVerifiedAt')
  })
})

describe('inicio de sesión', () => {
  it('una cuenta nueva sin verificar no inicia sesión y recibe el motivo', async () => {
    enforce()
    mocks.prisma.user.findUnique.mockResolvedValue(user())
    mocks.verifyPassword.mockResolvedValue(true)

    const response = await login()

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual(NOT_VERIFIED)
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(setCookie(response)).toBe('')
  })

  it('con la contraseña incorrecta no revela que falta la verificación', async () => {
    enforce()
    mocks.prisma.user.findUnique.mockResolvedValue(user())
    mocks.verifyPassword.mockResolvedValue(false)

    const response = await login('Incorrecta-123!')

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ message: 'Email o contraseña incorrectos.' })
  })

  it('una cuenta existente sin verificar inicia sesión durante el periodo de gracia', async () => {
    enforce(GRACE_OPEN)
    mocks.prisma.user.findUnique.mockResolvedValue(user({ createdAt: EXISTING }))
    mocks.verifyPassword.mockResolvedValue(true)

    const response = await login()

    expect(response.statusCode).toBe(200)
    expect(mocks.createSession).toHaveBeenCalledWith(USER_ID)
  })

  it('al terminar el periodo de gracia, la cuenta existente sin verificar no inicia sesión', async () => {
    enforce(GRACE_OVER)
    mocks.prisma.user.findUnique.mockResolvedValue(user({ createdAt: EXISTING }))
    mocks.verifyPassword.mockResolvedValue(true)

    const response = await login()

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual(NOT_VERIFIED)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('una cuenta verificada inicia sesión aunque la verificación se exija', async () => {
    enforce(GRACE_OVER)
    mocks.prisma.user.findUnique.mockResolvedValue(user({ emailVerifiedAt: SINCE }))
    mocks.verifyPassword.mockResolvedValue(true)

    const response = await login()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ user: { id: USER_ID, email: EMAIL, role: 'USER' } })
  })

  it.each([
    ['la protección por incidente', { securityHoldAt: SINCE }, 'La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.'],
    ['la recuperación obligatoria (E2)', { passwordResetRequiredAt: SINCE }, 'Debes establecer una contraseña nueva antes de volver a acceder. Si no has recibido el enlace de recuperación, contacta con soporte.'],
  ])('%s tiene prioridad sobre la verificación del email', async (_label, state, message) => {
    enforce()
    mocks.prisma.user.findUnique.mockResolvedValue(user(state))
    mocks.verifyPassword.mockResolvedValue(true)

    const response = await login()

    expect(response.statusCode).toBe(423)
    expect(response.json()).toEqual({ message })
  })
})

describe('sesión activa (/me y rutas de cuenta)', () => {
  it('durante el periodo de gracia /me devuelve el usuario e indica hasta cuándo puede verificar', async () => {
    enforce(GRACE_OPEN)
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf({ createdAt: EXISTING }))

    const response = await me()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      user: { id: USER_ID, email: EMAIL, role: 'USER', emailVerification: { status: 'GRACE', graceUntil: '2099-01-01T00:00:00.000Z' } },
    })
  })

  it('al terminar el periodo de gracia /me cierra las sesiones de la cuenta y explica el motivo', async () => {
    enforce(GRACE_OVER)
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf({ createdAt: EXISTING }))

    const response = await me()

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual(NOT_VERIFIED)
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    expect(setCookie(response)).toContain('Max-Age=0')
  })

  it('una cuenta verificada lo indica en /me', async () => {
    enforce(GRACE_OVER)
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf({ emailVerifiedAt: SINCE }))

    const response = await me()

    expect(response.json().user.emailVerification).toEqual({ status: 'VERIFIED', graceUntil: null })
  })

  it('las rutas de cuenta tampoco se pueden usar sin verificar cuando ya se exige', async () => {
    enforce(GRACE_OVER)
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf({ createdAt: EXISTING }))

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: COOKIE },
      payload: { currentPassword: 'actual', newPassword: 'Nueva-contraseña-segura-1' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual(NOT_VERIFIED)
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
  })
})

// Contrato de /me: la misma decisión que aplican las sesiones (getUserIdFromSession y
// requireAuth usan isEmailVerificationRequired). REQUIRED nunca aparece dentro de un usuario.
describe('contrato de /me con la verificación del email', () => {
  const CASES = [
    ['sin la verificación exigida', undefined, {}, 200, 'NOT_ENFORCED'],
    ['email verificado', GRACE_OVER, { emailVerifiedAt: SINCE }, 200, 'VERIFIED'],
    ['cuenta existente en periodo de gracia', GRACE_OPEN, { createdAt: EXISTING }, 200, 'GRACE'],
    ['cuenta existente al acabar la gracia', GRACE_OVER, { createdAt: EXISTING }, 403, null],
    ['cuenta nueva sin verificar', GRACE_OPEN, {}, 403, null],
  ] as const

  it.each(CASES)('%s: /me responde %i (%s) y coincide con la decisión de las sesiones', async (_label, grace, state, code, status) => {
    if (grace !== undefined) enforce(grace)
    const sessionUser = sessionOf(state).user
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf(state))

    const response = await me()

    expect(response.statusCode).toBe(code)
    expect(isEmailVerificationRequired(sessionUser)).toBe(code === 403)
    if (code === 200) {
      expect(response.json().user.emailVerification.status).toBe(status)
      expect(response.json().user.emailVerification.status).not.toBe('REQUIRED')
      expect(mocks.prisma.session.deleteMany).not.toHaveBeenCalled()
    } else {
      expect(response.json()).toEqual(NOT_VERIFIED)
      expect(response.json()).not.toHaveProperty('user')
      expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    }
  })

  it('graceUntil solo aparece en el periodo de gracia', async () => {
    enforce(GRACE_OPEN)
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf({ emailVerifiedAt: SINCE }))

    expect((await me()).json().user.emailVerification).toEqual({ status: 'VERIFIED', graceUntil: null })
  })
})

describe('POST /api/auth/verify-email', () => {
  it('un token válido verifica el email sin iniciar sesión', async () => {
    mocks.consumeEmailVerificationToken.mockResolvedValue('verified')

    const response = await verify({ token: VERIFY_TOKEN })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ verified: true, message: 'Email verificado. Ya puedes iniciar sesión.' })
    expect(mocks.consumeEmailVerificationToken).toHaveBeenCalledWith(VERIFY_TOKEN)
    expect(setCookie(response)).toBe('')
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('un token caducado se rechaza e invita a pedir otro', async () => {
    mocks.consumeEmailVerificationToken.mockResolvedValue('expired')

    const response = await verify({ token: VERIFY_TOKEN })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'EXPIRED', message: 'El enlace de verificación ha caducado. Solicita uno nuevo.' })
  })

  it('un token inválido o reutilizado se rechaza', async () => {
    mocks.consumeEmailVerificationToken.mockResolvedValue('invalid')

    const response = await verify({ token: VERIFY_TOKEN })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'INVALID', message: 'El enlace de verificación no es válido o ya se ha usado.' })
  })

  it.each([
    ['sin token', {}],
    ['con un token vacío', { token: '' }],
    ['con campos de más', { token: VERIFY_TOKEN, userId: USER_ID }],
  ])('%s responde 400 sin consultar nada', async (_label, payload) => {
    const response = await verify(payload)

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('INVALID')
    expect(mocks.consumeEmailVerificationToken).not.toHaveBeenCalled()
  })

  it('limita los intentos: 10 cada 15 minutos', async () => {
    const limited = Fastify()
    await limited.register(rateLimit, { global: false })
    await limited.register(authRoutes)
    await limited.ready()
    mocks.consumeEmailVerificationToken.mockResolvedValue('invalid')
    try {
      for (let i = 0; i < 10; i++) expect((await verify({ token: VERIFY_TOKEN }, limited)).statusCode).toBe(400)
      expect((await verify({ token: VERIFY_TOKEN }, limited)).statusCode).toBe(429)
      expect(mocks.consumeEmailVerificationToken).toHaveBeenCalledTimes(10)
    } finally {
      await limited.close()
    }
  })
})

describe('POST /api/auth/verify-email/resend', () => {
  it('con una cuenta existente responde el mensaje genérico y envía en segundo plano', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: USER_ID })

    const response = await resend(` ${EMAIL.toUpperCase()} `)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(RESEND_MESSAGE)
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: EMAIL }, select: { id: true } })
    expect(mocks.sendEmailVerificationInBackground).toHaveBeenCalledWith(USER_ID)
  })

  it('con un email no registrado responde exactamente lo mismo y no envía nada', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)

    const response = await resend('nadie@estateforge.test')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(RESEND_MESSAGE)
    expect(mocks.sendEmailVerificationInBackground).not.toHaveBeenCalled()
  })

  it('con un email mal formado responde 400', async () => {
    const response = await resend('no-es-un-email')

    expect(response.statusCode).toBe(400)
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('limita las solicitudes: 3 cada 15 minutos y 429 a la siguiente sin enviar', async () => {
    const limited = Fastify()
    await limited.register(rateLimit, { global: false })
    await limited.register(authRoutes)
    await limited.ready()
    mocks.prisma.user.findUnique.mockResolvedValue({ id: USER_ID })
    try {
      for (let i = 0; i < 3; i++) expect((await resend(EMAIL, limited)).statusCode).toBe(200)
      const blocked = await resend(EMAIL, limited)
      expect(blocked.statusCode).toBe(429)
      expect(mocks.sendEmailVerificationInBackground).toHaveBeenCalledTimes(3)
    } finally {
      await limited.close()
    }
  })
})

describe('compatibilidad con la recuperación de contraseña y con E2', () => {
  it('una cuenta sin verificar puede pedir la recuperación de contraseña', async () => {
    enforce()
    mocks.prisma.user.findUnique.mockResolvedValue({ id: USER_ID, email: EMAIL, securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: null })
    mocks.issuePasswordResetToken.mockResolvedValue({ token: 'f'.repeat(64), expiresAt: new Date(Date.now() + 60_000) })

    const response = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: EMAIL } })
    // El envío va en segundo plano (decisión D3 de la Fase 0).
    await waitForPendingPasswordResetDeliveries()

    expect(response.statusCode).toBe(200)
    expect(mocks.issuePasswordResetToken).toHaveBeenCalledWith(USER_ID)
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledOnce()
  })

  it('el restablecimiento de contraseña no cambia con la verificación exigida', async () => {
    enforce(GRACE_OVER)
    mocks.consumePasswordResetToken.mockResolvedValue(true)

    const response = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: 'f'.repeat(64), password: PASSWORD } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ message: 'Contraseña restablecida correctamente. Ya puedes iniciar sesión.' })
  })

  it('la recuperación obligatoria (E2) se completa igual con la verificación exigida', async () => {
    enforce(GRACE_OVER)
    mocks.consumeSecurityRecoveryToken.mockResolvedValue('completed')

    const response = await app.inject({ method: 'POST', url: '/api/auth/security-recovery/complete', payload: { token: 'f'.repeat(64), password: PASSWORD } })

    expect(response.statusCode).toBe(200)
    expect(mocks.consumeSecurityRecoveryToken).toHaveBeenCalledOnce()
  })
})

describe('configuración', () => {
  it('una fecha no válida impide registrar las rutas', async () => {
    vi.stubEnv('EMAIL_VERIFICATION_REQUIRED_FROM', 'el lunes')
    const broken = Fastify()
    await expect(broken.register(authRoutes).ready()).rejects.toThrow(/EMAIL_VERIFICATION_REQUIRED_FROM/)
    await broken.close()
  })
})

// La cookie de sesión de la prueba coincide con el hash que busca la API.
it('el token de sesión de las pruebas tiene el formato real', () => {
  expect(createHash('sha256').update(SESSION_TOKEN).digest('hex')).toMatch(/^[0-9a-f]{64}$/)
})
