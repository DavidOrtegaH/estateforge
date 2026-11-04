import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Prueba el manejador real de las señales con un servidor HTTP real. Las señales se emiten
// sobre un emisor propio: en Windows, enviar SIGTERM o SIGINT a un proceso hijo lo termina
// sin ejecutar ningún manejador, así que no se puede probar con un proceso aparte.
const mail = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('./db/prisma.js', () => ({ prisma: {} }))
vi.mock('./services/email.service.js', () => ({ emailService: { sendSecurityRecoveryEmail: mail.send } }))

import { authRoutes } from './routes/auth.routes.js'
import { countPendingRecoveryDeliveries, deliverRecoveryLinkInBackground } from './services/security-recovery.service.js'
import { registerGracefulShutdown } from './shutdown.js'

const LINK = { userId: 'cuenta-1', to: 'destino@estateforge.test', token: 'f'.repeat(64), expiresAt: new Date('2026-11-03T13:00:00.000Z') }

// Promesa que la prueba resuelve cuando quiere.
function gate() {
  let open: () => void = () => undefined
  const promise = new Promise<void>(resolve => { open = resolve })
  return { promise, open }
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 5))
  expect(condition()).toBe(true)
}

let app: FastifyInstance | undefined

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await app?.close().catch(() => undefined)
  app = undefined
})

describe('registerGracefulShutdown', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('ante %s cierra la app y no sale hasta terminar los envíos ya registrados', async signal => {
    const smtp = gate()
    mail.send.mockReturnValue(smtp.promise)
    app = Fastify()
    await app.register(authRoutes)
    await app.ready()
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit })

    deliverRecoveryLinkInBackground(app.log, LINK)
    signals.emit(signal)
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
    smtp.open()
    await until(() => exit.mock.calls.length > 0)
    expect(exit).toHaveBeenCalledWith(0)
    expect(countPendingRecoveryDeliveries()).toBe(0)
  })

  it('espera también a los envíos que registra una petición que seguía en curso durante el cierre', async () => {
    const handler = gate()
    const smtp = gate()
    mail.send.mockReturnValue(smtp.promise)
    let entered = false
    app = Fastify()
    // Petición que tarda y registra su envío al final, ya con el cierre en marcha. app.close()
    // espera a que termine y después ejecuta el hook onClose, que espera también a este envío.
    app.get('/lenta', async request => {
      entered = true
      await handler.promise
      deliverRecoveryLinkInBackground(request.log, LINK)
      return { ok: true }
    })
    await app.register(authRoutes)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit })

    // Sin keep-alive: el cliente cierra su conexión tras la respuesta, así el servidor puede cerrarse.
    const response = new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/lenta', agent: false, headers: { connection: 'close' } }, res => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      })
      req.on('error', reject)
      req.end()
    })
    await until(() => entered)
    signals.emit('SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(exit).not.toHaveBeenCalled()

    // La petición termina y registra el envío después del hook onClose.
    handler.open()
    expect(await response).toBe(200)
    await until(() => mail.send.mock.calls.length === 1)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(exit).not.toHaveBeenCalled()

    smtp.open()
    await until(() => exit.mock.calls.length > 0)
    expect(exit).toHaveBeenCalledWith(0)
    expect(countPendingRecoveryDeliveries()).toBe(0)
  })

  it.each([
    ['SIGTERM', 'SIGINT'],
    ['SIGINT', 'SIGTERM'],
    ['SIGTERM', 'SIGTERM'],
    ['SIGINT', 'SIGINT'],
  ] as const)('%s seguida de %s: la segunda señal sale al momento con 1, sin esperar al cierre ni repetirlo', async (first, second) => {
    const smtp = gate()
    mail.send.mockReturnValue(smtp.promise)
    app = Fastify()
    await app.register(authRoutes)
    await app.ready()
    const close = vi.spyOn(app, 'close')
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit })
    // Un envío pendiente mantiene el cierre ordenado en espera.
    deliverRecoveryLinkInBackground(app.log, LINK)

    signals.emit(first)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(close).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()

    signals.emit(second)

    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
    expect(close).toHaveBeenCalledTimes(1)

    // Cuando el cierre ordenado termina, no vuelve a salir.
    smtp.open()
    await until(() => countPendingRecoveryDeliveries() === 0)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('tras un cierre ordenado completo, una señal posterior no vuelve a salir', async () => {
    app = Fastify()
    await app.ready()
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit })

    signals.emit('SIGTERM')
    await until(() => exit.mock.calls.length > 0)
    signals.emit('SIGINT')

    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('si el cierre falla, sale con código 1', async () => {
    app = Fastify({ logger: false })
    await app.ready()
    vi.spyOn(app, 'close').mockRejectedValue(new Error('fallo simulado al cerrar'))
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit })

    signals.emit('SIGTERM')
    await until(() => exit.mock.calls.length > 0)

    expect(exit).toHaveBeenCalledWith(1)
    vi.mocked(app.close).mockRestore()
  })
})
