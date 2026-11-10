import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// PostgreSQL real en una base temporal, flujo real de reset-password y TCP real en localhost. La señal
// se emite sobre un emisor propio y el código de salida es un doble: NO son señales reales.
const gate = vi.hoisted(() => ({
  entered: 0,
  release: (() => undefined) as () => void,
  promise: Promise.resolve() as Promise<void>,
  reset() {
    this.entered = 0
    this.promise = new Promise<void>(resolve => { this.release = resolve })
  },
}))

vi.mock('../services/password.service.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/password.service.js')>()
  return {
    ...actual,
    hashPassword: async (password: string) => {
      gate.entered += 1
      await gate.promise
      return actual.hashPassword(password)
    },
  }
})
vi.mock('../services/turnstile.service.js', () => ({ verifyTurnstileToken: vi.fn(async () => true) }))
vi.mock('../services/email.service.js', () => ({ emailService: {} }))

const PASSWORD = 'Primera-Contrasena-Segura-1'

let testDatabase: TestDatabase
let mods: {
  prisma: typeof import('../db/prisma.js')['prisma']
  closeDatabase: typeof import('../db/prisma.js')['closeDatabase']
  resets: typeof import('../services/password-reset.service.js')
  passwords: typeof import('../services/password.service.js')
  authRoutes: typeof import('../routes/auth.routes.js')['authRoutes']
  shutdown: typeof import('../shutdown.js')
  work: typeof import('../request-work.js')
}
let app: FastifyInstance | undefined

async function until(condition: () => boolean | Promise<boolean>, ms = 4_000) {
  const start = Date.now()
  while (!(await condition())) {
    if (Date.now() - start > ms) throw new Error('condición no cumplida a tiempo')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

beforeAll(async () => {
  testDatabase = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', testDatabase.url)
  mods = {
    prisma: (await import('../db/prisma.js')).prisma,
    closeDatabase: (await import('../db/prisma.js')).closeDatabase,
    resets: await import('../services/password-reset.service.js'),
    passwords: await import('../services/password.service.js'),
    authRoutes: (await import('../routes/auth.routes.js')).authRoutes,
    shutdown: await import('../shutdown.js'),
    work: await import('../request-work.js'),
  }
})

afterEach(async () => {
  gate.release()
  await app?.close().catch(() => undefined)
  app = undefined
})

afterAll(async () => {
  await mods.closeDatabase()
  vi.unstubAllEnvs()
  await testDatabase.drop()
})

describe('trabajo de una petición cuyo cliente se ha desconectado', () => {
  it('no sale del proceso hasta que la operación de base de datos ha terminado', async () => {
    gate.reset()
    const user = await mods.prisma.user.create({ data: { email: 'cierre@estateforge.test', password: 'hash-original' }, select: { id: true } })
    const { token } = await mods.resets.issuePasswordResetToken(user.id)
    const server = Fastify({ logger: false })
    app = server
    const work = mods.work.trackRequestWork(server)
    server.decorateRequest('userId', null)
    await server.register(rateLimit, { global: false })
    await server.register(mods.authRoutes)
    const signals = new EventEmitter()
    const exit = vi.fn()
    const tracking = mods.shutdown.registerGracefulShutdown(server, { target: signals, exit, timeoutMs: 3_000, drainMs: 1_500 })
    await server.listen({ port: 0, host: '127.0.0.1' })
    const { port } = server.server.address() as AddressInfo

    const body = JSON.stringify({ token, password: PASSWORD })
    const client = httpRequest({ port, host: '127.0.0.1', path: '/api/auth/reset-password', method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } })
    client.on('error', () => undefined)
    client.end(body)
    await until(() => gate.entered === 1)
    client.destroy()
    await until(() => tracking.activeRequests() === 0)
    expect(work.running()).toBe(1)

    signals.emit('SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(exit).not.toHaveBeenCalled()
    expect(await mods.prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: { not: null } } })).toBe(0)

    gate.release()
    await until(() => exit.mock.calls.length > 0)

    // Al salir, la operación ya está confirmada.
    expect(exit).toHaveBeenCalledWith(0)
    expect(await mods.prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: { not: null } } })).toBe(1)
    const stored = await mods.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } })
    expect(await mods.passwords.verifyPassword(PASSWORD, stored.password)).toBe(true)
    expect(tracking.activeWork()).toBe(0)
  })
})
