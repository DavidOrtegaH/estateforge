import { createHash } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Dobles: Prisma en memoria mínima, sesiones, contraseña, Turnstile y el servicio de
// recuperación. Se prueban las comprobaciones de acceso de login, getAuthenticatedUser
// y /me (E2.3) y la ruta de recuperación obligatoria (E2.5).
const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    session: { findUnique: vi.fn(), deleteMany: vi.fn() },
  },
  createSession: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  consumePasswordResetToken: vi.fn(),
  consumeSecurityRecoveryToken: vi.fn(),
  issueRequestedRecoveryLinks: vi.fn(),
  deliverRecoveryLinkInBackground: vi.fn(),
  waitForPendingRecoveryDeliveries: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../services/session.service.js', () => ({
  createSession: mocks.createSession,
  deleteSession: vi.fn(),
}))
vi.mock('../services/password.service.js', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}))
vi.mock('../services/turnstile.service.js', () => ({
  verifyTurnstileToken: mocks.verifyTurnstileToken,
}))
vi.mock('../services/security-recovery.service.js', () => ({
  issueRequestedRecoveryLinks: mocks.issueRequestedRecoveryLinks,
  deliverRecoveryLinkInBackground: mocks.deliverRecoveryLinkInBackground,
  waitForPendingRecoveryDeliveries: mocks.waitForPendingRecoveryDeliveries,
}))
vi.mock('../services/password-reset.service.js', () => ({
  issuePasswordResetToken: vi.fn(),
  consumePasswordResetToken: mocks.consumePasswordResetToken,
  consumeSecurityRecoveryToken: mocks.consumeSecurityRecoveryToken,
}))

import rateLimit from '@fastify/rate-limit'
import { authRoutes } from './auth.routes.js'

const USER_ID = 'user-1'
const EMAIL = 'titular@estateforge.test'
const SESSION_TOKEN = 'a'.repeat(64)
const SESSION_HASH = createHash('sha256').update(SESSION_TOKEN).digest('hex')
const COOKIE = `estateforge_session=${SESSION_TOKEN}`

const WRONG_CREDENTIALS = { message: 'Email o contraseña incorrectos.' }
const HOLD = { message: 'La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.' }
const SUSPENDED = { message: 'La cuenta está suspendida por el equipo de EstateForge. Contacta con soporte.' }
const RESET_REQUIRED = {
  message: 'Debes establecer una contraseña nueva antes de volver a acceder. Si no has recibido el enlace de recuperación, contacta con soporte.',
}

type AccessState = {
  securityHoldAt?: Date | null
  adminSuspendedAt?: Date | null
  passwordResetRequiredAt?: Date | null
}

const SINCE = new Date('2026-11-02T10:00:00.000Z')
const RESET_ONLY: AccessState = { passwordResetRequiredAt: SINCE }
const ALL_THREE: AccessState = { securityHoldAt: SINCE, adminSuspendedAt: SINCE, passwordResetRequiredAt: SINCE }

function user(state: AccessState = {}) {
  return {
    id: USER_ID,
    email: EMAIL,
    password: 'hash-guardado',
    role: 'USER',
    securityHoldAt: null,
    adminSuspendedAt: null,
    passwordResetRequiredAt: null,
    ...state,
  }
}

function sessionOf(state: AccessState = {}) {
  return { expiresAt: new Date(Date.now() + 60_000), user: user(state) }
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.verifyTurnstileToken.mockResolvedValue(true)
  mocks.issueRequestedRecoveryLinks.mockResolvedValue([])
  mocks.waitForPendingRecoveryDeliveries.mockResolvedValue(undefined)
  mocks.prisma.session.deleteMany.mockResolvedValue({ count: 1 })
  mocks.createSession.mockResolvedValue({ token: 'nueva-sesion', expiresAt: new Date(Date.now() + 60_000) })
  app = Fastify()
  await app.register(authRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function login(password = 'Contraseña-correcta-1') {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: EMAIL, password } })
}

function me() {
  return app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: COOKIE } })
}

// change-password pasa por getAuthenticatedUser antes de comprobar la contraseña actual.
function changePassword() {
  return app.inject({
    method: 'POST',
    url: '/api/auth/change-password',
    headers: { cookie: COOKIE },
    payload: { currentPassword: 'actual', newPassword: 'Nueva-contraseña-segura-1' },
  })
}

function expectSessionCookieCleared(response: { headers: Record<string, unknown> }) {
  expect(String(response.headers['set-cookie'])).toContain('Max-Age=0')
}

describe('POST /api/auth/login', () => {
  it('con contraseña incorrecta responde 401 sin revelar la recuperación pendiente', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(user(RESET_ONLY))
    mocks.verifyPassword.mockResolvedValue(false)

    const response = await login('incorrecta')

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual(WRONG_CREDENTIALS)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('con contraseña correcta y recuperación pendiente responde 423 sin crear sesión', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(user(RESET_ONLY))
    mocks.verifyPassword.mockResolvedValue(true)

    const response = await login()

    expect(response.statusCode).toBe(423)
    expect(response.json()).toEqual(RESET_REQUIRED)
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('sin recuperación pendiente inicia sesión con normalidad', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(user())
    mocks.verifyPassword.mockResolvedValue(true)

    const response = await login()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ user: { id: USER_ID, email: EMAIL, role: 'USER' } })
    expect(mocks.createSession).toHaveBeenCalledWith(USER_ID)
    expect(String(response.headers['set-cookie'])).toContain('estateforge_session=nueva-sesion')
  })

  it.each([
    ['la protección por incidente', { securityHoldAt: SINCE }, HOLD],
    ['la suspensión administrativa', { adminSuspendedAt: SINCE }, SUSPENDED],
    ['los tres estados a la vez (gana la protección)', ALL_THREE, HOLD],
    ['suspensión y recuperación (gana la suspensión)', { adminSuspendedAt: SINCE, passwordResetRequiredAt: SINCE }, SUSPENDED],
  ])('mantiene %s con su mensaje y sin sesión', async (_label, state, message) => {
    mocks.prisma.user.findUnique.mockResolvedValue(user(state))
    mocks.verifyPassword.mockResolvedValue(true)

    const response = await login()

    expect(response.statusCode).toBe(423)
    expect(response.json()).toEqual(message)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })
})

describe('getAuthenticatedUser (vía change-password)', () => {
  it('rechaza la cuenta con recuperación pendiente y cierra todas sus sesiones', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf(RESET_ONLY))

    const response = await changePassword()

    expect(mocks.prisma.session.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: SESSION_HASH })
    expect(response.statusCode).toBe(423)
    expect(response.json()).toEqual(RESET_REQUIRED)
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    expectSessionCookieCleared(response)
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
  })

  it('mantiene la protección por incidente, también con los tres estados activos', async () => {
    for (const state of [{ securityHoldAt: SINCE }, ALL_THREE]) {
      mocks.prisma.session.findUnique.mockResolvedValueOnce(sessionOf(state))

      const response = await changePassword()

      expect(response.statusCode).toBe(423)
      expect(response.json()).toEqual(HOLD)
    }
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
  })

  it('sin recuperación pendiente deja pasar a la comprobación de la contraseña actual', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf())
    mocks.verifyPassword.mockResolvedValue(false)

    const response = await changePassword()

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ message: 'La contraseña actual no es correcta.' })
    expect(mocks.prisma.session.deleteMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/auth/me', () => {
  it('no devuelve datos de una cuenta con recuperación pendiente y cierra sus sesiones', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf(RESET_ONLY))

    const response = await me()

    expect(response.statusCode).toBe(423)
    expect(response.json()).toEqual(RESET_REQUIRED)
    expect(response.body).not.toContain(EMAIL)
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    expectSessionCookieCleared(response)
  })

  it.each([
    ['la protección por incidente', { securityHoldAt: SINCE }, HOLD],
    ['la suspensión administrativa', { adminSuspendedAt: SINCE }, SUSPENDED],
    ['los tres estados a la vez', ALL_THREE, HOLD],
  ])('mantiene %s', async (_label, state, message) => {
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf(state))

    const response = await me()

    expect(response.statusCode).toBe(423)
    expect(response.json()).toEqual(message)
    expect(response.body).not.toContain(EMAIL)
  })

  it('sin estados activos devuelve el usuario', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue(sessionOf())

    const response = await me()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ user: { id: USER_ID, email: EMAIL, role: 'USER' } })
    expect(mocks.prisma.session.deleteMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/security-recovery/complete', () => {
  const URL_COMPLETE = '/api/auth/security-recovery/complete'
  // Valores de prueba, no reales.
  const TOKEN = 'c'.repeat(64)
  const PASSWORD = 'Nueva-Contrasena-Segura-1'
  const PASSWORD_HASH = 'hash-de-prueba'
  const DESTINATION = 'destino-recuperacion@estateforge.test'
  const INVALID = { message: 'El enlace de recuperación no es válido o ha caducado.' }
  const NO_LONGER_VALID = { message: 'Este enlace ya no permite completar la recuperación de la cuenta. Contacta con soporte si sigues sin poder acceder.' }
  const EMAIL_UNAVAILABLE = { message: 'No se ha podido completar la recuperación porque el email de recuperación no está disponible. Contacta con soporte.' }
  const POLICY_MESSAGE = 'La contraseña debe tener entre 12 y 128 caracteres e incluir al menos una mayúscula, una minúscula, un número y un carácter especial.'

  beforeEach(() => {
    mocks.hashPassword.mockResolvedValue(PASSWORD_HASH)
    mocks.consumeSecurityRecoveryToken.mockResolvedValue('completed')
  })

  // null envía la petición sin cuerpo.
  function complete(payload: unknown = { token: TOKEN, password: PASSWORD }, target: FastifyInstance = app) {
    return target.inject({ method: 'POST', url: URL_COMPLETE, ...(payload === null ? {} : { payload: payload as Record<string, unknown> }) })
  }

  // Nada de lo que conoce el servidor sobre la cuenta o el token sale en la respuesta.
  function expectNoLeaks(body: string) {
    for (const secret of [TOKEN, PASSWORD, PASSWORD_HASH, DESTINATION, USER_ID, EMAIL, 'P2002', 'prisma', 'Prisma']) {
      expect(body).not.toContain(secret)
    }
  }

  it('completed: 200 con el mensaje de recuperación completada', async () => {
    const response = await complete()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      message: 'Contraseña establecida y acceso recuperado. Ya puedes iniciar sesión con el email al que recibiste este enlace.',
    })
    expectNoLeaks(response.body)
  })

  it('llama al servicio con el token recibido y el hash, nunca con la contraseña en claro', async () => {
    await complete({ token: `  ${TOKEN}  `, password: PASSWORD })

    expect(mocks.hashPassword).toHaveBeenCalledWith(PASSWORD)
    expect(mocks.consumeSecurityRecoveryToken).toHaveBeenCalledTimes(1)
    // El token llega recortado, como en reset-password.
    expect(mocks.consumeSecurityRecoveryToken).toHaveBeenCalledWith(TOKEN, PASSWORD_HASH)
    expect(JSON.stringify(mocks.consumeSecurityRecoveryToken.mock.calls)).not.toContain(PASSWORD)
    // Nunca se usa el consumo de autoservicio.
    expect(mocks.consumePasswordResetToken).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid_token', 400, INVALID],
    ['state_mismatch', 400, NO_LONGER_VALID],
    ['email_taken', 409, EMAIL_UNAVAILABLE],
  ] as const)('%s: %i con un mensaje controlado y sin filtrar datos', async (outcome, status, body) => {
    mocks.consumeSecurityRecoveryToken.mockResolvedValue(outcome)

    const response = await complete()

    expect(response.statusCode).toBe(status)
    expect(response.json()).toEqual(body)
    expectNoLeaks(response.body)
  })

  it('un token inválido usa la misma respuesta que reset-password', async () => {
    mocks.consumeSecurityRecoveryToken.mockResolvedValue('invalid_token')
    mocks.consumePasswordResetToken.mockResolvedValue(false)

    const recovery = await complete()
    const reset = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: TOKEN, password: PASSWORD } })

    expect(recovery.statusCode).toBe(reset.statusCode)
    expect(recovery.json()).toEqual(reset.json())
  })

  it('Turnstile inválido: 400 y el servicio no se ejecuta', async () => {
    mocks.verifyTurnstileToken.mockResolvedValue(false)

    const response = await complete({ token: TOKEN, password: PASSWORD, turnstileToken: 'no-valido' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ message: 'No se ha podido completar la verificación de seguridad. Inténtalo de nuevo.' })
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith('no-valido', expect.any(String))
    expect(mocks.hashPassword).not.toHaveBeenCalled()
    expect(mocks.consumeSecurityRecoveryToken).not.toHaveBeenCalled()
  })

  it.each([
    ['sin cuerpo', null, 'El enlace de recuperación no es válido.'],
    ['sin token', { password: PASSWORD }, 'El enlace de recuperación no es válido.'],
    ['token demasiado corto', { token: 'a'.repeat(31), password: PASSWORD }, 'El enlace de recuperación no es válido.'],
    ['token demasiado largo', { token: 'a'.repeat(257), password: PASSWORD }, 'El enlace de recuperación no es válido.'],
    ['sin contraseña', { token: TOKEN }, POLICY_MESSAGE],
    ['contraseña corta', { token: TOKEN, password: 'Corta-1a' }, POLICY_MESSAGE],
    ['contraseña sin símbolo', { token: TOKEN, password: 'SinSimbolo12345' }, POLICY_MESSAGE],
  ])('cuerpo inválido (%s): 400 y el servicio no se ejecuta', async (_label, payload, message) => {
    const response = await complete(payload)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ message })
    expect(mocks.verifyTurnstileToken).not.toHaveBeenCalled()
    expect(mocks.hashPassword).not.toHaveBeenCalled()
    expect(mocks.consumeSecurityRecoveryToken).not.toHaveBeenCalled()
  })

  it('un error inesperado del servicio no se traduce en éxito ni expone detalles', async () => {
    mocks.consumeSecurityRecoveryToken.mockRejectedValue(new Error('detalle interno de la base de datos'))

    const response = await complete()

    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('Contraseña establecida')
  })

  it('conserva el rate limit: 10 peticiones cada 15 minutos y 429 a la siguiente sin ejecutar el servicio', async () => {
    const limited = Fastify()
    await limited.register(rateLimit, { global: false })
    await limited.register(authRoutes)
    await limited.ready()
    try {
      for (let i = 0; i < 10; i++) {
        expect((await complete(undefined, limited)).statusCode).toBe(200)
      }
      const blocked = await complete(undefined, limited)

      expect(blocked.statusCode).toBe(429)
      expect(blocked.headers['retry-after']).toBeDefined()
      expect(mocks.consumeSecurityRecoveryToken).toHaveBeenCalledTimes(10)
      // El contador es propio de la ruta: reset-password sigue disponible.
      mocks.consumePasswordResetToken.mockResolvedValue(true)
      const reset = await limited.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: TOKEN, password: PASSWORD } })
      expect(reset.statusCode).toBe(200)
    } finally {
      await limited.close()
    }
  })

  it('reset-password no cambia: usa el consumo de autoservicio y sus mensajes', async () => {
    mocks.consumePasswordResetToken.mockResolvedValue(true)

    const ok = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: TOKEN, password: PASSWORD } })
    mocks.consumePasswordResetToken.mockResolvedValue(false)
    const rejected = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: TOKEN, password: PASSWORD } })

    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ message: 'Contraseña restablecida correctamente. Ya puedes iniciar sesión.' })
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json()).toEqual(INVALID)
    expect(mocks.consumePasswordResetToken).toHaveBeenCalledWith(TOKEN, PASSWORD_HASH)
    expect(mocks.consumeSecurityRecoveryToken).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/security-recovery/request', () => {
  const URL_REQUEST = '/api/auth/security-recovery/request'
  const GENERIC = { message: 'Si la cuenta puede recuperar el acceso, recibirás instrucciones en el destino de recuperación registrado.' }
  // Valores de prueba, no reales.
  const LINK = { userId: 'cuenta-1', to: 'destino-recuperacion@estateforge.test', token: 'd'.repeat(64), expiresAt: new Date('2026-11-03T13:00:00.000Z') }

  // null envía la petición sin cuerpo.
  function request(payload: unknown = { email: 'Titular@EstateForge.TEST ' }, target: FastifyInstance = app) {
    return target.inject({ method: 'POST', url: URL_REQUEST, ...(payload === null ? {} : { payload: payload as Record<string, unknown> }) })
  }

  it('normaliza el email y lanza el envío de cada enlace sin esperarlo', async () => {
    mocks.issueRequestedRecoveryLinks.mockResolvedValue([LINK, { ...LINK, userId: 'cuenta-2', token: 'e'.repeat(64) }])

    const response = await request()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(GENERIC)
    expect(mocks.issueRequestedRecoveryLinks).toHaveBeenCalledWith(expect.anything(), 'titular@estateforge.test')
    expect(mocks.deliverRecoveryLinkInBackground).toHaveBeenCalledTimes(2)
    expect(mocks.deliverRecoveryLinkInBackground.mock.calls.map(call => call[1].userId)).toEqual(['cuenta-1', 'cuenta-2'])
  })

  it('responde lo mismo, byte a byte, sin enlaces, con uno, con varios y ante un error interno', async () => {
    const bodies: string[] = []
    const arrangements = [
      () => mocks.issueRequestedRecoveryLinks.mockResolvedValue([]),
      () => mocks.issueRequestedRecoveryLinks.mockResolvedValue([LINK]),
      () => mocks.issueRequestedRecoveryLinks.mockResolvedValue([LINK, LINK]),
      () => mocks.issueRequestedRecoveryLinks.mockRejectedValue(new Error('fallo interno de la base de datos')),
    ]
    for (const arrange of arrangements) {
      arrange()
      const response = await request()
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8')
      bodies.push(response.body)
    }

    expect(new Set(bodies).size).toBe(1)
    expect(JSON.parse(bodies[0])).toEqual(GENERIC)
    for (const secret of [LINK.to, LINK.token, 'recuperar-cuenta', 'cuenta-1', 'base de datos']) expect(bodies[0]).not.toContain(secret)
  })

  it('no espera al envío: responde aunque el correo siga en curso', async () => {
    mocks.issueRequestedRecoveryLinks.mockResolvedValue([LINK])
    // El doble del envío no termina nunca; la respuesta no debe depender de él.
    mocks.deliverRecoveryLinkInBackground.mockImplementation(() => {
      void new Promise(() => undefined)
    })

    const response = await request()

    expect(response.statusCode).toBe(200)
    expect(mocks.deliverRecoveryLinkInBackground).toHaveBeenCalledWith(expect.anything(), LINK)
  })

  it.each([
    ['recoveryEmail', { recoveryEmail: 'otro@estateforge.test' }],
    ['deliverTo', { deliverTo: 'otro@estateforge.test' }],
    ['destination', { destination: 'otro@estateforge.test' }],
    ['token', { token: 'a'.repeat(64) }],
    ['securityHoldVersion', { securityHoldVersion: 9 }],
  ])('rechaza el campo %s (400) sin consultar ninguna cuenta', async (_label, extra) => {
    const response = await request({ email: 'titular@estateforge.test', ...extra })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ message: 'Introduce un email válido.' })
    expect(mocks.issueRequestedRecoveryLinks).not.toHaveBeenCalled()
  })

  it.each([
    ['sin cuerpo', null],
    ['sin email', {}],
    ['con un email no válido', { email: 'no-es-un-email' }],
    ['con un email de más de 254 caracteres', { email: `${'a'.repeat(250)}@x.test` }],
  ])('%s responde 400 sin consultar ninguna cuenta', async (_label, payload) => {
    const response = await request(payload)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ message: 'Introduce un email válido.' })
    expect(mocks.issueRequestedRecoveryLinks).not.toHaveBeenCalled()
  })

  it('turnstileToken es opcional, como en las demás rutas públicas: la verificación decide si hace falta', async () => {
    const response = await request({ email: 'titular@estateforge.test' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(GENERIC)
    // Sin token se delega en verifyTurnstileToken, que solo lo exige con la clave del servidor configurada.
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith(undefined, expect.any(String))
  })

  it('con Turnstile no válido responde 400 sin consultar ninguna cuenta', async () => {
    mocks.verifyTurnstileToken.mockResolvedValue(false)

    const response = await request({ email: 'titular@estateforge.test', turnstileToken: 'no-valido' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ message: 'No se ha podido completar la verificación de seguridad. Inténtalo de nuevo.' })
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith('no-valido', expect.any(String))
    expect(mocks.issueRequestedRecoveryLinks).not.toHaveBeenCalled()
  })

  it('limita a 5 solicitudes cada 15 minutos por IP, con un contador propio de la ruta', async () => {
    const limited = Fastify()
    await limited.register(rateLimit, { global: false })
    await limited.register(authRoutes)
    await limited.ready()
    try {
      for (let i = 0; i < 5; i++) {
        expect((await request(undefined, limited)).statusCode).toBe(200)
      }
      const blocked = await request(undefined, limited)

      expect(blocked.statusCode).toBe(429)
      expect(blocked.headers['retry-after']).toBeDefined()
      expect(mocks.issueRequestedRecoveryLinks).toHaveBeenCalledTimes(5)
      // forgot-password conserva su propio límite.
      mocks.prisma.user.findUnique.mockResolvedValue(null)
      const forgot = await limited.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'titular@estateforge.test' } })
      expect(forgot.statusCode).toBe(200)
    } finally {
      await limited.close()
    }
  })

  it('al cerrar la app espera a los envíos pendientes', async () => {
    const closing = Fastify()
    await closing.register(authRoutes)
    await closing.ready()
    mocks.waitForPendingRecoveryDeliveries.mockClear()

    await closing.close()

    expect(mocks.waitForPendingRecoveryDeliveries).toHaveBeenCalledTimes(1)
  })

  it('forgot-password no usa la solicitud de recuperación obligatoria', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)

    const response = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'titular@estateforge.test' } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ message: 'Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.' })
    expect(mocks.issueRequestedRecoveryLinks).not.toHaveBeenCalled()
    expect(mocks.deliverRecoveryLinkInBackground).not.toHaveBeenCalled()
  })
})
