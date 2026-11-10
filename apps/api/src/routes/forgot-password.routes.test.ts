import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Decisión D3 de la Fase 0: forgot-password emite el token y envía el correo en segundo plano.
// La respuesta pública es la misma para cualquier cuenta y un fallo del SMTP no la cambia.
// Dobles de Prisma, sesiones, contraseña, Turnstile, recuperación y correo; el módulo de envío
// en segundo plano (password-reset-delivery.service) es el real.
const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    session: { findUnique: vi.fn(), deleteMany: vi.fn() },
  },
  verifyTurnstileToken: vi.fn(),
  issuePasswordResetToken: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../services/session.service.js', () => ({ createSession: vi.fn(), deleteSession: vi.fn() }))
vi.mock('../services/password.service.js', () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }))
vi.mock('../services/turnstile.service.js', () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }))
vi.mock('../services/security-recovery.service.js', () => ({
  issueRequestedRecoveryLinks: vi.fn(async () => []),
  deliverRecoveryLinkInBackground: vi.fn(),
  waitForPendingRecoveryDeliveries: vi.fn(async () => ({ timedOut: false, pending: 0 })),
}))
vi.mock('../services/password-reset.service.js', () => ({
  issuePasswordResetToken: mocks.issuePasswordResetToken,
  consumePasswordResetToken: vi.fn(),
  consumeSecurityRecoveryToken: vi.fn(),
}))
vi.mock('../services/email.service.js', () => ({
  emailService: { sendPasswordResetEmail: mocks.sendPasswordResetEmail },
}))

import { authRoutes } from './auth.routes.js'
import { countPendingPasswordResetDeliveries, waitForPendingPasswordResetDeliveries } from '../services/password-reset-delivery.service.js'

const EMAIL = 'titular@estateforge.test'
const RESET_TOKEN = 'f'.repeat(64)
const GENERIC = 'Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.'
const USABLE = { securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: null }
const SINCE = new Date('2026-11-02T10:00:00.000Z')

function account(extra: Record<string, unknown> = {}) {
  return { id: 'user-1', email: EMAIL, ...USABLE, ...extra }
}

function deferred() {
  let release!: () => void
  let fail!: (error: Error) => void
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { promise, release, fail }
}

let app: FastifyInstance
let logs: string[]

async function build(options: { limited?: boolean } = {}) {
  logs = []
  const instance = Fastify({ logger: { level: 'error', stream: { write: (line: string) => { logs.push(line) } } } })
  if (options.limited) await instance.register(rateLimit, { global: false })
  await instance.register(authRoutes)
  await instance.ready()
  return instance
}

const forgot = (target = app, payload: Record<string, unknown> = { email: EMAIL }) =>
  target.inject({ method: 'POST', url: '/api/auth/forgot-password', payload })

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.verifyTurnstileToken.mockResolvedValue(true)
  mocks.issuePasswordResetToken.mockResolvedValue({ token: RESET_TOKEN, expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
  mocks.sendPasswordResetEmail.mockResolvedValue(undefined)
  app = await build()
})

afterEach(async () => {
  await app.close()
})

describe('forgot-password: respuesta genérica y envío en segundo plano (D3)', () => {
  it('cuenta elegible: responde sin esperar al SMTP y el envío termina después', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(account())
    const smtp = deferred()
    mocks.sendPasswordResetEmail.mockReturnValue(smtp.promise)

    const response = await forgot()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ message: GENERIC })
    // El envío sigue pendiente cuando ya se ha respondido.
    expect(countPendingPasswordResetDeliveries()).toBe(1)
    smtp.release()
    await waitForPendingPasswordResetDeliveries()
    expect(mocks.issuePasswordResetToken).toHaveBeenCalledWith('user-1')
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith({
      to: EMAIL,
      resetUrl: `http://localhost:5173/restablecer-contrasena?token=${RESET_TOKEN}`,
      expiresAt: expect.any(Date),
    })
    expect(countPendingPasswordResetDeliveries()).toBe(0)
  })

  it('la respuesta es idéntica byte a byte: elegible, inexistente, no elegible y con el SMTP fallando', async () => {
    const cases: [string, unknown, () => void][] = [
      ['elegible', account(), () => undefined],
      ['inexistente', null, () => undefined],
      ['protegida', account({ securityHoldAt: SINCE }), () => undefined],
      ['suspendida', account({ adminSuspendedAt: SINCE }), () => undefined],
      ['en recuperación obligatoria (E2)', account({ passwordResetRequiredAt: SINCE }), () => undefined],
      ['elegible con el SMTP fallando', account(), () => mocks.sendPasswordResetEmail.mockRejectedValueOnce(new Error(`SMTP rechazó ${EMAIL}`))],
    ]
    const responses: { label: string; status: number; body: string; type: unknown }[] = []
    for (const [label, user, prepare] of cases) {
      mocks.prisma.user.findUnique.mockResolvedValueOnce(user)
      prepare()
      const response = await forgot()
      await waitForPendingPasswordResetDeliveries()
      responses.push({ label, status: response.statusCode, body: response.payload, type: response.headers['content-type'] })
    }

    for (const response of responses) {
      expect(response, response.label).toMatchObject({ status: 200, body: JSON.stringify({ message: GENERIC }), type: responses[0].type })
    }
  })

  it('solo las cuentas elegibles emiten token y envían', async () => {
    for (const user of [null, account({ securityHoldAt: SINCE }), account({ adminSuspendedAt: SINCE }), account({ passwordResetRequiredAt: SINCE })]) {
      mocks.prisma.user.findUnique.mockResolvedValueOnce(user)
      await forgot()
    }
    await waitForPendingPasswordResetDeliveries()

    expect(mocks.issuePasswordResetToken).not.toHaveBeenCalled()
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('un fallo del SMTP se registra sin el email, el token ni el enlace, y no se reintenta', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(account())
    mocks.sendPasswordResetEmail.mockRejectedValue(new Error(`Recipient rejected: ${EMAIL} ${RESET_TOKEN}`))

    const response = await forgot()
    await waitForPendingPasswordResetDeliveries()

    expect(response.json()).toEqual({ message: GENERIC })
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledOnce()
    const logged = logs.join('\n')
    expect(logged).toContain('No se pudo enviar el enlace de restablecimiento de contraseña')
    expect(logged).toContain('user-1')
    expect(logged).not.toContain(EMAIL)
    expect(logged).not.toContain(RESET_TOKEN)
    expect(logged).not.toContain('restablecer-contrasena')
  })

  it('un fallo al emitir el token tampoco cambia la respuesta y no envía nada', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(account())
    mocks.issuePasswordResetToken.mockRejectedValue(new Error('fallo de la base de datos'))

    const response = await forgot()
    await waitForPendingPasswordResetDeliveries()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ message: GENERIC })
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(logs.join('\n')).not.toContain(EMAIL)
  })

  it('al cerrar la app espera a que termine el envío pendiente', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(account())
    const smtp = deferred()
    mocks.sendPasswordResetEmail.mockReturnValue(smtp.promise)
    const closing = await build()
    await forgot(closing)

    let closed = false
    const closePromise = closing.close().then(() => { closed = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(closed).toBe(false)
    smtp.release()
    await closePromise
    expect(closed).toBe(true)
    expect(countPendingPasswordResetDeliveries()).toBe(0)
  })

  it('Turnstile no válido: 400 sin consultar ninguna cuenta ni emitir nada', async () => {
    mocks.verifyTurnstileToken.mockResolvedValue(false)

    const response = await forgot(app, { email: EMAIL, turnstileToken: 'no-valido' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ message: 'No se ha podido completar la verificación de seguridad. Inténtalo de nuevo.' })
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
    expect(mocks.issuePasswordResetToken).not.toHaveBeenCalled()
  })

  it('mantiene el límite de 5 solicitudes cada 15 minutos por IP', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(account())
    const limited = await build({ limited: true })
    try {
      for (let i = 0; i < 5; i++) expect((await forgot(limited)).statusCode).toBe(200)
      expect((await forgot(limited)).statusCode).toBe(429)
      await waitForPendingPasswordResetDeliveries()
      expect(mocks.issuePasswordResetToken).toHaveBeenCalledTimes(5)
    } finally {
      await limited.close()
    }
  })
})
