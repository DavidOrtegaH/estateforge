import { EventEmitter } from 'node:events'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Cierre del pool de PostgreSQL al final del cierre ordenado (DA-38): después de esperar a las
// peticiones, a su trabajo y a los envíos, y antes de salir. Nunca antes: ese trabajo aún usa la base.

const mail = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('./db/prisma.js', () => ({ prisma: {} }))
vi.mock('./services/email.service.js', () => ({ emailService: { sendSecurityRecoveryEmail: mail.send } }))

import { authRoutes } from './routes/auth.routes.js'
import { deliverRecoveryLinkInBackground } from './services/security-recovery.service.js'
import { registerGracefulShutdown } from './shutdown.js'

const LINK = { userId: 'cuenta-1', to: 'destino@estateforge.test', token: 'f'.repeat(64), expiresAt: new Date('2026-11-03T13:00:00.000Z') }

function gate() {
  let open: () => void = () => undefined
  const promise = new Promise<void>(resolve => { open = resolve })
  return { promise, open }
}

async function until(condition: () => boolean, ms = 2_000) {
  for (let i = 0; i < ms / 5 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 5))
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

async function readyApp() {
  app = Fastify()
  await app.register(authRoutes)
  await app.ready()
  return app
}

describe('cierre de los recursos al final del cierre ordenado (DA-38)', () => {
  it('cierra el pool después del último envío y antes de salir, una sola vez', async () => {
    const smtp = gate()
    const order: string[] = []
    mail.send.mockImplementation(async () => {
      await smtp.promise
      order.push('envío terminado')
    })
    const instance = await readyApp()
    const signals = new EventEmitter()
    const exit = vi.fn((code: number) => order.push(`salida ${code}`))
    const closeResources = vi.fn(async () => {
      order.push('pool cerrado')
    })
    registerGracefulShutdown(instance, { target: signals, exit, closeResources })

    deliverRecoveryLinkInBackground(instance.log, LINK)
    signals.emit('SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 50))

    // El envío sigue en curso: el pool sigue abierto.
    expect(closeResources).not.toHaveBeenCalled()
    smtp.open()
    await until(() => exit.mock.calls.length > 0)

    expect(order).toEqual(['envío terminado', 'pool cerrado', 'salida 0'])
    expect(closeResources).toHaveBeenCalledTimes(1)
  })

  it('si no se pueden cerrar los recursos, sale con 1', async () => {
    const instance = await readyApp()
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(instance, { target: signals, exit, closeResources: async () => { throw new Error('postgresql://u:p@h/db') } })

    signals.emit('SIGINT')
    await until(() => exit.mock.calls.length > 0)

    expect(exit).toHaveBeenCalledWith(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('un cierre de recursos que no termina no prolonga el plazo total', async () => {
    const instance = await readyApp()
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(instance, { target: signals, exit, timeoutMs: 300, drainMs: 100, closeResources: () => new Promise<void>(() => {}) })

    signals.emit('SIGTERM')
    await until(() => exit.mock.calls.length > 0, 2_000)

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('una segunda señal sale al momento sin esperar al cierre de los recursos', async () => {
    const smtp = gate()
    mail.send.mockReturnValue(smtp.promise)
    const instance = await readyApp()
    const signals = new EventEmitter()
    const exit = vi.fn()
    const closeResources = vi.fn(async () => {})
    registerGracefulShutdown(instance, { target: signals, exit, closeResources })

    deliverRecoveryLinkInBackground(instance.log, LINK)
    signals.emit('SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 30))
    signals.emit('SIGTERM')

    expect(exit).toHaveBeenCalledWith(1)
    expect(closeResources).not.toHaveBeenCalled()
    smtp.open()
  })
})
