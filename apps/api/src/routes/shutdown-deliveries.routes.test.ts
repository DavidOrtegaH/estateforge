import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Corrección C de la Fase 1 (F0-005): el hook onClose de authRoutes espera a los tres tipos de
// envío en segundo plano (recuperación obligatoria, verificación del email y restablecimiento de
// contraseña) con el mismo plazo máximo. Se usan los servicios reales de envío; solo se sustituyen
// la base de datos y el SMTP, y el plazo se acorta a 150 ms para medirlo.
const { TIMEOUT_MS } = vi.hoisted(() => ({ TIMEOUT_MS: 150 }))

const gates = vi.hoisted(() => {
  const make = () => {
    let release: () => void = () => undefined
    let fail: (error: unknown) => void = () => undefined
    const promise = new Promise<void>((resolve, reject) => { release = resolve; fail = reject })
    return { promise, release, fail }
  }
  return { make, open: [] as { release: () => void }[] }
})

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  sendSecurityRecoveryEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  issuePasswordResetToken: vi.fn(),
}))

vi.mock('../services/pending-deliveries.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/pending-deliveries.js')>()),
  DELIVERY_SHUTDOWN_TIMEOUT_MS: TIMEOUT_MS,
}))
vi.mock('../db/prisma.js', () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock('../services/session.service.js', () => ({ createSession: vi.fn(), deleteSession: vi.fn() }))
vi.mock('../services/password.service.js', () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }))
vi.mock('../services/turnstile.service.js', () => ({ verifyTurnstileToken: vi.fn(async () => true) }))
vi.mock('../services/email.service.js', () => ({
  emailService: { sendSecurityRecoveryEmail: mocks.sendSecurityRecoveryEmail, sendPasswordResetEmail: mocks.sendPasswordResetEmail },
}))
vi.mock('../services/password-reset.service.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/password-reset.service.js')>()),
  issuePasswordResetToken: mocks.issuePasswordResetToken,
}))

import { authRoutes } from './auth.routes.js'
import { countPendingPasswordResetDeliveries, deliverPasswordResetInBackground } from '../services/password-reset-delivery.service.js'
import { countPendingVerificationDeliveries, sendEmailVerificationInBackground } from '../services/email-verification.service.js'
import { countPendingRecoveryDeliveries, deliverRecoveryLinkInBackground } from '../services/security-recovery.service.js'

const USER_ID = 'user-1'
const EMAIL = 'titular@estateforge.test'
const TOKEN = 'b'.repeat(64)
const RESET_TOKEN = 'c'.repeat(64)

let app: FastifyInstance
let lines: string[]

function gate() {
  const created = gates.make()
  gates.open.push(created)
  return created
}

const pendingTotal = () => countPendingRecoveryDeliveries() + countPendingVerificationDeliveries() + countPendingPasswordResetDeliveries()

// Lanza un envío de cada servicio, cada uno detenido en su propia puerta.
function startAll() {
  const recovery = gate()
  const verification = gate()
  const reset = gate()
  mocks.sendSecurityRecoveryEmail.mockReturnValueOnce(recovery.promise)
  // La emisión del token de verificación queda detenida en la transacción y después falla.
  mocks.transaction.mockReturnValueOnce(verification.promise.then(() => { throw Object.assign(new Error(`fallo con ${EMAIL}`), { code: 'P1001' }) }))
  mocks.sendPasswordResetEmail.mockReturnValueOnce(reset.promise)
  deliverRecoveryLinkInBackground(app.log, { userId: USER_ID, to: EMAIL, token: TOKEN, expiresAt: new Date() })
  sendEmailVerificationInBackground(app.log, USER_ID)
  deliverPasswordResetInBackground(app.log, { id: USER_ID, email: EMAIL })
  return { recovery, verification, reset }
}

function entries() {
  return lines.map(line => JSON.parse(line) as Record<string, unknown>)
}

const WARNING = 'Cierre con envíos de correo sin terminar dentro del plazo'

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.issuePasswordResetToken.mockResolvedValue({ token: RESET_TOKEN, expiresAt: new Date() })
  lines = []
  app = Fastify({ logger: { level: 'info', stream: { write: (line: string) => { lines.push(line) } } } })
  await app.register(authRoutes)
  await app.ready()
})

afterEach(async () => {
  // Libera los envíos que hayan quedado detenidos para que no pasen a la prueba siguiente.
  for (const open of gates.open.splice(0)) open.release()
  for (let i = 0; i < 50 && pendingTotal() > 0; i++) await new Promise(resolve => setTimeout(resolve, 5))
  expect(pendingTotal()).toBe(0)
})

describe('cierre de la app con envíos en segundo plano (F0-005)', () => {
  it('sin envíos pendientes cierra al momento y sin aviso', async () => {
    const start = Date.now()

    await app.close()

    expect(Date.now() - start).toBeLessThan(TIMEOUT_MS)
    expect(entries().some(entry => entry.msg === WARNING)).toBe(false)
  })

  it('espera a los envíos de los tres servicios hasta que terminan', async () => {
    const { recovery, verification, reset } = startAll()
    expect(pendingTotal()).toBe(3)
    let closed = false

    const closing = app.close().then(() => { closed = true })
    recovery.release()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(closed).toBe(false)
    reset.release()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(closed).toBe(false)
    verification.release()

    await closing
    expect(pendingTotal()).toBe(0)
    expect(mocks.sendSecurityRecoveryEmail).toHaveBeenCalledOnce()
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledOnce()
    expect(entries().some(entry => entry.msg === WARNING)).toBe(false)
  })

  it('un envío que falla no bloquea el cierre y queda registrado sin datos sensibles', async () => {
    const failing = gate()
    mocks.sendPasswordResetEmail.mockReturnValueOnce(failing.promise)
    deliverPasswordResetInBackground(app.log, { id: USER_ID, email: EMAIL })

    const closing = app.close()
    failing.fail(Object.assign(new Error(`550 <${EMAIL}> rechazado`), { code: 'EENVELOPE', responseCode: 550, rejected: [EMAIL] }))
    await closing

    const failure = entries().find(entry => entry.msg === 'No se pudo enviar el enlace de restablecimiento de contraseña')
    expect(failure).toMatchObject({ flow: 'password_reset', targetUserId: USER_ID, errorCode: 'EENVELOPE', smtpResponseCode: 550 })
    expect(lines.join('\n')).not.toContain(EMAIL)
    expect(lines.join('\n')).not.toContain(RESET_TOKEN)
    expect(entries().some(entry => entry.msg === WARNING)).toBe(false)
  })

  it('un envío que supera el plazo no impide cerrar: termina en el plazo y avisa de cuántos quedan', async () => {
    const stuck = gate()
    mocks.sendSecurityRecoveryEmail.mockReturnValueOnce(stuck.promise)
    deliverRecoveryLinkInBackground(app.log, { userId: USER_ID, to: EMAIL, token: TOKEN, expiresAt: new Date() })
    const start = Date.now()

    await app.close()
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 10)
    expect(elapsed).toBeLessThan(TIMEOUT_MS * 3)
    const warning = entries().find(entry => entry.msg === WARNING)
    expect(warning).toMatchObject({ level: 40, pendingDeliveries: 1, timeoutMs: TIMEOUT_MS })
    expect(lines.join('\n')).not.toContain(EMAIL)
    expect(lines.join('\n')).not.toContain(TOKEN)
  })

  it('con los tres servicios detenidos, el cierre espera un único plazo (en paralelo), no la suma', async () => {
    startAll()
    const start = Date.now()

    await app.close()
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(TIMEOUT_MS * 2)
    expect(entries().find(entry => entry.msg === WARNING)).toMatchObject({ pendingDeliveries: 3, timeoutMs: TIMEOUT_MS })
  })

  it('espera también a un envío lanzado mientras ya se está cerrando', async () => {
    const first = gate()
    const late = gate()
    mocks.sendPasswordResetEmail.mockReturnValueOnce(first.promise).mockReturnValueOnce(late.promise)
    deliverPasswordResetInBackground(app.log, { id: USER_ID, email: EMAIL })
    let closed = false

    const closing = app.close().then(() => { closed = true })
    deliverPasswordResetInBackground(app.log, { id: USER_ID, email: EMAIL })
    first.release()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(closed).toBe(false)
    expect(countPendingPasswordResetDeliveries()).toBe(1)
    late.release()

    await closing
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledTimes(2)
    expect(entries().some(entry => entry.msg === WARNING)).toBe(false)
  })
})
