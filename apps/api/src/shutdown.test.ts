import { EventEmitter } from 'node:events'
import { Agent, request as httpRequest } from 'node:http'
import { connect, type AddressInfo, type Socket } from 'node:net'
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Prueba el manejador real de las señales con un servidor HTTP real. Las señales se emiten
// sobre un emisor propio: en Windows, enviar SIGTERM o SIGINT a un proceso hijo lo termina
// sin ejecutar ningún manejador, así que no se puede probar con un proceso aparte.
const mail = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('./db/prisma.js', () => ({ prisma: {} }))
vi.mock('./services/email.service.js', () => ({ emailService: { sendSecurityRecoveryEmail: mail.send } }))

import { authRoutes } from './routes/auth.routes.js'
import { countPendingRecoveryDeliveries, deliverRecoveryLinkInBackground } from './services/security-recovery.service.js'
import { createDeliveryTracker, DELIVERY_SHUTDOWN_TIMEOUT_MS, deliveryWaitBudgetMs } from './services/pending-deliveries.js'
import { trackRequestWork } from './request-work.js'
import { REPORT_RESERVE_MS, registerGracefulShutdown, SHUTDOWN_DRAIN_MS, SHUTDOWN_TIMEOUT_MS } from './shutdown.js'

const LINK = { userId: 'cuenta-1', to: 'destino@estateforge.test', token: 'f'.repeat(64), expiresAt: new Date('2026-11-03T13:00:00.000Z') }

// Promesa que la prueba resuelve cuando quiere.
function gate() {
  let open: () => void = () => undefined
  const promise = new Promise<void>(resolve => { open = resolve })
  return { promise, open }
}

async function until(condition: () => boolean, ms = 1_000) {
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

  // Fase 1 v3 (C-2). Servidor HTTP y conexiones reales en localhost; la señal se emite sobre un
  // emisor propio: estas pruebas NO validan señales reales del sistema operativo.
  describe('cierre con peticiones activas (C-2)', () => {
    function get(port: number, path: string, agent?: Agent) {
      return new Promise<number | undefined>((resolve, reject) => {
        const client = httpRequest({ port, host: '127.0.0.1', path, agent }, response => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        })
        client.on('error', reject)
        client.end()
      })
    }

    function capture() {
      const lines: string[] = []
      return {
        lines,
        logger: { level: 'warn', stream: { write: (line: string) => { lines.push(line) } } },
        entries: () => lines.map(line => JSON.parse(line) as Record<string, unknown>),
      }
    }

    it('petición activa en keep-alive: termina, se ejecuta onClose y sale con 0 sin esperar al keep-alive', async () => {
      const agent = new Agent({ keepAlive: true, maxSockets: 1 })
      const slow = gate()
      let entered = false
      let closed = false
      app = Fastify({ logger: false })
      app.addHook('onClose', async () => { closed = true })
      app.get('/lenta', async () => { entered = true; await slow.promise; return { ok: true } })
      const signals = new EventEmitter()
      const exit = vi.fn()
      const tracking = registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 3_000, drainMs: 2_000 })
      await app.listen({ port: 0, host: '127.0.0.1' })
      const { port } = app.server.address() as AddressInfo
      const response = get(port, '/lenta', agent)
      await until(() => entered)
      expect(tracking.activeRequests()).toBe(1)
      const start = Date.now()

      signals.emit('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(exit).not.toHaveBeenCalled()
      slow.open()

      expect(await response).toBe(200)
      await until(() => exit.mock.calls.length > 0)
      expect(Date.now() - start).toBeLessThan(1_500)
      expect(closed).toBe(true)
      expect(exit).toHaveBeenCalledTimes(1)
      expect(exit).toHaveBeenCalledWith(0)
      await until(() => tracking.openConnections() === 0)
      expect(tracking.activeRequests()).toBe(0)
      agent.destroy()
    })

    it('varias peticiones en curso, con y sin keep-alive, terminan todas antes de salir con 0', async () => {
      const agent = new Agent({ keepAlive: true })
      const slow = gate()
      let entered = 0
      let closed = false
      app = Fastify({ logger: false })
      app.addHook('onClose', async () => { closed = true })
      app.get('/lenta', async () => { entered += 1; await slow.promise; return { ok: true } })
      const signals = new EventEmitter()
      const exit = vi.fn()
      const tracking = registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 3_000, drainMs: 2_000 })
      await app.listen({ port: 0, host: '127.0.0.1' })
      const { port } = app.server.address() as AddressInfo
      const responses = [get(port, '/lenta', agent), get(port, '/lenta', agent), get(port, '/lenta'), get(port, '/lenta')]
      await until(() => entered === 4)
      expect(tracking.activeRequests()).toBe(4)

      signals.emit('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(exit).not.toHaveBeenCalled()
      slow.open()

      expect(await Promise.all(responses)).toEqual([200, 200, 200, 200])
      await until(() => exit.mock.calls.length > 0)
      expect(closed).toBe(true)
      expect(exit).toHaveBeenCalledWith(0)
      agent.destroy()
    })

    it('una petición que no termina se corta al acabar el drenaje, se ejecuta onClose y sale con 1', async () => {
      const log = capture()
      const stuck = gate()
      let entered = false
      let closed = false
      app = Fastify({ logger: log.logger })
      app.addHook('onClose', async () => { closed = true })
      app.get('/colgada', async () => { entered = true; await stuck.promise; return { ok: true } })
      const signals = new EventEmitter()
      const exit = vi.fn()
      registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 800, drainMs: 100 })
      await app.listen({ port: 0, host: '127.0.0.1' })
      const { port } = app.server.address() as AddressInfo
      const response = get(port, '/colgada').catch(() => 'cortada')
      await until(() => entered)

      signals.emit('SIGTERM')
      await until(() => exit.mock.calls.length > 0)

      expect(await response).toBe('cortada')
      expect(closed).toBe(true)
      expect(exit).toHaveBeenCalledTimes(1)
      expect(exit).toHaveBeenCalledWith(1)
      expect(log.entries().find(entry => entry.msg === 'Se cortan las peticiones que seguían en curso durante el cierre')).toMatchObject({ level: 40, activeRequests: 1, drainMs: 100 })
      expect(log.entries().find(entry => entry.msg === 'Cierre incompleto')).toMatchObject({ level: 50, reason: 'incomplete', requestsCut: true, pendingDeliveries: 0 })
      stuck.open()
    })

    // V-1: conexiones abiertas frente a peticiones activas.
    describe('conexiones frente a peticiones (V-1)', () => {
      const CUT = 'Se cortan las peticiones que seguían en curso durante el cierre'

      function rawConnection(port: number) {
        return new Promise<Socket>((resolve, reject) => {
          const socket = connect(port, '127.0.0.1', () => resolve(socket))
          socket.on('error', () => undefined)
          socket.once('error', reject)
        })
      }

      async function setup(routes: (server: FastifyInstance) => void = () => undefined) {
        const log = capture()
        const server = Fastify({ logger: log.logger })
        app = server
        trackRequestWork(server)
        let closed = false
        server.addHook('onClose', async () => { closed = true })
        routes(server)
        const signals = new EventEmitter()
        const exit = vi.fn()
        const tracking = registerGracefulShutdown(server, { target: signals, exit, timeoutMs: 2_000, drainMs: 800 })
        await server.listen({ port: 0, host: '127.0.0.1' })
        return { server, log, signals, exit, tracking, port: (server.server.address() as AddressInfo).port, isClosed: () => closed }
      }

      function expectCleanExit(env: Awaited<ReturnType<typeof setup>>, start: number) {
        expect(Date.now() - start).toBeLessThan(600)
        expect(env.exit).toHaveBeenCalledTimes(1)
        expect(env.exit).toHaveBeenCalledWith(0)
        expect(env.isClosed()).toBe(true)
        expect(env.log.entries().some(entry => entry.msg === CUT || entry.reason === 'incomplete')).toBe(false)
      }

      it('una conexión abierta sin ninguna petición no se cuenta como cortada: sale con 0 sin esperar al drenaje', async () => {
        const env = await setup()
        const socket = await rawConnection(env.port)
        await until(() => env.tracking.openConnections() === 1)
        expect(env.tracking.activeRequests()).toBe(0)
        const start = Date.now()

        env.signals.emit('SIGTERM')
        await until(() => env.exit.mock.calls.length > 0)

        expectCleanExit(env, start)
        await until(() => env.tracking.openConnections() === 0)
        socket.destroy()
      })

      it('una conexión keep-alive ociosa, ya usada, no se cuenta como cortada', async () => {
        const agent = new Agent({ keepAlive: true, maxSockets: 1 })
        const env = await setup(server => server.get('/rapida', async () => ({ ok: true })))
        expect(await get(env.port, '/rapida', agent)).toBe(200)
        await until(() => env.tracking.activeRequests() === 0)
        expect(env.tracking.openConnections()).toBe(1)
        const start = Date.now()

        env.signals.emit('SIGTERM')
        await until(() => env.exit.mock.calls.length > 0)

        expectCleanExit(env, start)
        agent.destroy()
      })

      it('varias conexiones ociosas: sale con 0, sin registrar cortes y con los recuentos a cero', async () => {
        const env = await setup()
        const sockets = await Promise.all([rawConnection(env.port), rawConnection(env.port), rawConnection(env.port)])
        await until(() => env.tracking.openConnections() === 3)
        const start = Date.now()

        env.signals.emit('SIGTERM')
        await until(() => env.exit.mock.calls.length > 0)

        expectCleanExit(env, start)
        await until(() => env.tracking.openConnections() === 0)
        expect(env.tracking.activeRequests()).toBe(0)
        for (const socket of sockets) socket.destroy()
      })

      it('una conexión con una petición a medio recibir no cuenta como petición activa', async () => {
        const env = await setup()
        const socket = await rawConnection(env.port)
        socket.write('GET /parcial HTTP/1.1\r\nHost: x\r\n')
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(env.tracking.activeRequests()).toBe(0)
        const start = Date.now()

        env.signals.emit('SIGTERM')
        await until(() => env.exit.mock.calls.length > 0)

        expectCleanExit(env, start)
        socket.destroy()
      })

      it('solo registra como cortadas las peticiones realmente activas, no las conexiones ociosas', async () => {
        const stuck = gate()
        let entered = 0
        const env = await setup(server => server.get('/colgada', async () => { entered += 1; await stuck.promise; return { ok: true } }))
        const idle = await Promise.all([rawConnection(env.port), rawConnection(env.port)])
        const responses = [get(env.port, '/colgada').catch(() => 'cortada'), get(env.port, '/colgada').catch(() => 'cortada')]
        await until(() => entered === 2)
        expect(env.tracking.activeRequests()).toBe(2)
        expect(env.tracking.openConnections()).toBe(4)

        env.signals.emit('SIGTERM')
        await until(() => env.tracking.openConnections() === 2)
        expect(env.tracking.activeRequests()).toBe(2)
        await until(() => env.exit.mock.calls.length > 0)

        expect(await Promise.all(responses)).toEqual(['cortada', 'cortada'])
        expect(env.exit).toHaveBeenCalledWith(1)
        expect(env.isClosed()).toBe(true)
        expect(env.log.entries().find(entry => entry.msg === CUT)).toMatchObject({ activeRequests: 2 })
        expect(env.log.entries().find(entry => entry.reason === 'incomplete')).toMatchObject({ requestsCut: true })
        stuck.open()
        for (const socket of idle) socket.destroy()
      })

      it('una petición que termina durante el drenaje no se registra como cortada', async () => {
        const slow = gate()
        let entered = false
        const env = await setup(server => server.get('/lenta', async () => { entered = true; await slow.promise; return { ok: true } }))
        const response = get(env.port, '/lenta')
        await until(() => entered)

        env.signals.emit('SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 150))
        expect(env.exit).not.toHaveBeenCalled()
        slow.open()

        expect(await response).toBe(200)
        await until(() => env.exit.mock.calls.length > 0)
        expect(env.exit).toHaveBeenCalledWith(0)
        expect(env.log.entries().some(entry => entry.msg === CUT)).toBe(false)
      })

      async function disconnectDuring(env: Awaited<ReturnType<typeof setup>>, path: string, isRunning: () => boolean) {
        const client = httpRequest({ port: env.port, host: '127.0.0.1', path, agent: false })
        client.on('error', () => undefined)
        client.end()
        await until(isRunning)
        client.destroy()
        await until(() => env.tracking.activeRequests() === 0)
      }

      it('si el cliente cierra su conexión, la petición sale del recuento y no se registra como cortada', async () => {
        const slow = gate()
        let entered = false
        let finished = false
        const env = await setup(server => server.get('/lenta', async () => { entered = true; await slow.promise; finished = true; return { ok: true } }))
        const client = httpRequest({ port: env.port, host: '127.0.0.1', path: '/lenta', agent: false })
        client.on('error', () => undefined)
        client.end()
        await until(() => entered)
        expect(env.tracking.activeRequests()).toBe(1)

        client.destroy()
        await until(() => env.tracking.activeRequests() === 0)
        expect(env.tracking.activeRequests()).toBe(0)
        // La respuesta se ha cerrado, pero el trabajo de la petición sigue en marcha.
        expect(env.tracking.activeWork()).toBe(1)
        env.signals.emit('SIGTERM')
        await until(() => env.isClosed())
        await new Promise(resolve => setTimeout(resolve, 100))

        // app.close() ya ha terminado, pero el proceso no sale con el manejador en marcha.
        expect(finished).toBe(false)
        expect(env.exit).not.toHaveBeenCalled()
        slow.open()
        await until(() => env.exit.mock.calls.length > 0)

        expect(finished).toBe(true)
        expect(env.exit).toHaveBeenCalledTimes(1)
        expect(env.exit).toHaveBeenCalledWith(0)
        expect(env.log.entries().some(entry => entry.msg === CUT)).toBe(false)
        expect(env.tracking.activeRequests()).toBe(0)
        expect(env.tracking.activeWork()).toBe(0)
      })

      it('un manejador que nunca termina tras la desconexión sale con 1 dentro del plazo y lo registra', async () => {
        const stuck = gate()
        let entered = false
        const env = await setup(server => server.get('/colgada', async () => { entered = true; await stuck.promise; return { ok: true } }))
        await disconnectDuring(env, '/colgada', () => entered)
        const start = Date.now()

        env.signals.emit('SIGTERM')
        await until(() => env.exit.mock.calls.length > 0, 2_500)

        // Espera hasta el límite (plazo menos la reserva), sin agotar el plazo total.
        expect(Date.now() - start).toBeGreaterThanOrEqual(1_400)
        expect(Date.now() - start).toBeLessThan(2_000)
        expect(env.exit).toHaveBeenCalledWith(1)
        expect(env.log.entries().find(entry => entry.reason === 'incomplete')).toMatchObject({ activeRequests: 0, activeWork: 1, requestsCut: false })
        expect(env.log.entries().some(entry => entry.reason === 'timeout')).toBe(false)
        stuck.open()
        await until(() => env.tracking.activeWork() === 0)
      })

      it.each([
        ['termina con normalidad', (_reply: FastifyReply) => ({ ok: true })],
        ['devuelve reply.send()', (reply: FastifyReply) => reply.code(200).send({ ok: true })],
        ['lanza un error', () => { throw new Error('fallo tras la desconexión') }],
      ])('el recuento de trabajo vuelve a cero si tras la desconexión el manejador %s', async (_label, finishWith) => {
        const slow = gate()
        let entered = false
        const env = await setup(server => server.get('/lenta', async (_request, reply) => { entered = true; await slow.promise; return finishWith(reply) }))
        await disconnectDuring(env, '/lenta', () => entered)
        expect(env.tracking.activeWork()).toBe(1)

        slow.open()
        await until(() => env.tracking.activeWork() === 0)
        env.signals.emit('SIGTERM')
        await until(() => env.exit.mock.calls.length > 0)
        expect(env.exit).toHaveBeenCalledWith(0)
      })

      it('sigue el preHandler y el manejador que continúan tras la desconexión', async () => {
        const slow = gate()
        let entered = false
        let handled = false
        const env = await setup(server => server.get('/pre', {
          preHandler: async () => { entered = true; await slow.promise },
        }, async () => { await new Promise(resolve => setTimeout(resolve, 50)); handled = true; return { ok: true } }))
        await disconnectDuring(env, '/pre', () => entered)
        expect(env.tracking.activeWork()).toBe(1)

        env.signals.emit('SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 60))
        expect(env.exit).not.toHaveBeenCalled()
        slow.open()
        await until(() => env.exit.mock.calls.length > 0)

        expect(handled).toBe(true)
        expect(env.exit).toHaveBeenCalledWith(0)
      })

      it('un preHandler que responde sin llegar al manejador no deja trabajo pendiente', async () => {
        const env = await setup(server => server.get('/denegada', {
          preHandler: async (_request, reply) => reply.code(401).send({ message: 'no' }),
        }, async () => ({ ok: true })))

        expect(await get(env.port, '/denegada')).toBe(401)
        await until(() => env.tracking.activeWork() === 0)
        expect(env.tracking.activeRequests()).toBe(0)
      })

      it('un manejador que sigue trabajando tras responder se espera antes de salir', async () => {
        const slow = gate()
        let finished = false
        const env = await setup(server => server.get('/sigue', async (_request, reply) => {
          reply.send({ ok: true })
          await slow.promise
          finished = true
        }))
        expect(await get(env.port, '/sigue')).toBe(200)
        await until(() => env.tracking.activeRequests() === 0)
        expect(env.tracking.activeWork()).toBe(1)

        env.signals.emit('SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 60))
        expect(env.exit).not.toHaveBeenCalled()
        slow.open()
        await until(() => env.exit.mock.calls.length > 0)

        expect(finished).toBe(true)
        expect(env.exit).toHaveBeenCalledWith(0)
      })

      it('tras un cierre limpio se cancelan los temporizadores: no hay corte, plazo ni segunda salida', async () => {
        const env = await setup()
        const closeAll = vi.spyOn(env.server.server, 'closeAllConnections')
        const log = env.log.lines

        env.signals.emit('SIGTERM')
        await until(() => env.exit.mock.calls.length > 0)
        await new Promise(resolve => setTimeout(resolve, 2_100))

        expect(env.exit).toHaveBeenCalledTimes(1)
        expect(closeAll.mock.calls.length).toBeLessThanOrEqual(1)
        expect(log).toEqual([])
      })

      it('durante el cierre los recuentos nunca son negativos y no se duplican', async () => {
        const slow = gate()
        let entered = 0
        const env = await setup(server => server.get('/lenta', async () => { entered += 1; await slow.promise; return { ok: true } }))
        const responses = [get(env.port, '/lenta'), get(env.port, '/lenta'), get(env.port, '/lenta')]
        await until(() => entered === 3)
        expect([env.tracking.activeRequests(), env.tracking.activeWork(), env.tracking.openConnections()]).toEqual([3, 3, 3])
        const samples: number[] = []
        const sampler = setInterval(() => samples.push(env.tracking.activeRequests(), env.tracking.activeWork(), env.tracking.openConnections()), 5)

        env.signals.emit('SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 30))
        slow.open()
        await Promise.all(responses)
        await until(() => env.exit.mock.calls.length > 0)
        clearInterval(sampler)

        expect(Math.min(...samples)).toBeGreaterThanOrEqual(0)
        expect(Math.max(...samples)).toBeLessThanOrEqual(3)
        expect(env.exit).toHaveBeenCalledWith(0)
      })

      it('varias peticiones seguidas en una misma conexión no dejan recuentos erróneos', async () => {
        const agent = new Agent({ keepAlive: true, maxSockets: 1 })
        const env = await setup(server => server.get('/rapida', async () => ({ ok: true })))

        for (let i = 0; i < 5; i++) expect(await get(env.port, '/rapida', agent)).toBe(200)
        await until(() => env.tracking.activeRequests() === 0)

        expect(env.tracking.openConnections()).toBe(1)
        env.signals.emit('SIGTERM')
        await until(() => env.exit.mock.calls.length > 0)
        expect(env.exit).toHaveBeenCalledWith(0)
        await until(() => env.tracking.openConnections() === 0)
        expect(env.tracking.activeRequests()).toBe(0)
        agent.destroy()
      })
    })

    it('sin peticiones activas cierra al momento y sale con 0', async () => {
      app = Fastify({ logger: false })
      await app.listen({ port: 0, host: '127.0.0.1' })
      const signals = new EventEmitter()
      const exit = vi.fn()
      registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 3_000, drainMs: 2_000 })
      const start = Date.now()

      signals.emit('SIGTERM')
      await until(() => exit.mock.calls.length > 0)

      expect(Date.now() - start).toBeLessThan(500)
      expect(exit).toHaveBeenCalledWith(0)
    })

    it('al agotar el plazo total registra los envíos en curso como no confirmados antes de salir con 1', async () => {
      const log = capture()
      const tracker = createDeliveryTracker()
      const delivery = gate()
      tracker.track(delivery.promise)
      app = Fastify({ logger: log.logger })
      await app.ready()
      const close = vi.spyOn(app, 'close').mockReturnValue(new Promise<undefined>(() => undefined) as never)
      const signals = new EventEmitter()
      let linesAtExit = -1
      const exit = vi.fn(() => { linesAtExit = log.lines.length })
      registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 60, drainMs: 1_000 })

      signals.emit('SIGTERM')
      await until(() => exit.mock.calls.length > 0)

      expect(log.entries()[0]).toMatchObject({ level: 50, reason: 'timeout', timeoutMs: 60, pendingDeliveries: 1, deliveryState: 'unconfirmed' })
      expect(linesAtExit).toBe(1)
      expect(exit).toHaveBeenCalledWith(1)
      close.mockRestore()
      delivery.open()
      await tracker.waitForAll(1_000)
    })

    it('si el cierre termina con envíos en curso, sale con 1 y los registra como no confirmados', async () => {
      const log = capture()
      const tracker = createDeliveryTracker()
      const delivery = gate()
      tracker.track(delivery.promise)
      app = Fastify({ logger: log.logger })
      await app.ready()
      const signals = new EventEmitter()
      const exit = vi.fn()
      registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 1_000, drainMs: 500 })

      signals.emit('SIGTERM')
      await until(() => exit.mock.calls.length > 0)

      expect(exit).toHaveBeenCalledWith(1)
      expect(log.entries().find(entry => entry.reason === 'incomplete')).toMatchObject({ pendingDeliveries: 1, deliveryState: 'unconfirmed', requestsCut: false })
      delivery.open()
      await tracker.waitForAll(1_000)
    })

    it('el cierre se ejecuta una sola vez: la segunda señal informa de lo pendiente y sale con 1', async () => {
      const log = capture()
      const tracker = createDeliveryTracker()
      const delivery = gate()
      tracker.track(delivery.promise)
      app = Fastify({ logger: log.logger })
      await app.ready()
      const close = vi.spyOn(app, 'close').mockReturnValue(new Promise<undefined>(() => undefined) as never)
      const signals = new EventEmitter()
      const exit = vi.fn()
      registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 1_000, drainMs: 500 })

      signals.emit('SIGTERM')
      signals.emit('SIGINT')
      signals.emit('SIGTERM')

      expect(close).toHaveBeenCalledTimes(1)
      expect(exit).toHaveBeenCalledTimes(1)
      expect(exit).toHaveBeenCalledWith(1)
      expect(log.entries()[0]).toMatchObject({ reason: 'second_signal', pendingDeliveries: 1, deliveryState: 'unconfirmed' })
      close.mockRestore()
      delivery.open()
      await tracker.waitForAll(1_000)
    })

    it('la espera de envíos de onClose usa lo que queda del plazo total, sin reiniciarlo', async () => {
      const log = capture()
      const smtp = gate()
      mail.send.mockReturnValue(smtp.promise)
      app = Fastify({ logger: log.logger })
      await app.register(authRoutes)
      await app.ready()
      deliverRecoveryLinkInBackground(app.log, LINK)
      const signals = new EventEmitter()
      const exit = vi.fn()
      registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 200, drainMs: 150 })
      const start = Date.now()

      signals.emit('SIGTERM')
      await until(() => exit.mock.calls.length > 0)

      expect(Date.now() - start).toBeLessThan(400)
      expect(exit).toHaveBeenCalledWith(1)
      const warning = log.entries().find(entry => entry.msg === 'Cierre con envíos de correo sin terminar dentro del plazo')
      expect(warning).toMatchObject({ level: 40, pendingDeliveries: 1, deliveryState: 'unconfirmed' })
      expect(warning?.timeoutMs).toBeLessThanOrEqual(200)
      expect(log.entries().some(entry => entry.reason === 'timeout')).toBe(false)
      smtp.open()
      await until(() => countPendingRecoveryDeliveries() === 0)
    })
  })

  // Revisión de la Fase 1 (F0-005): el plazo de los envíos no cubre una petición colgada.
  it('una petición en curso que no termina no bloquea el cierre: sale con 1 al agotar el plazo total', async () => {
    const lines: string[] = []
    const stuck = gate()
    app = Fastify({ logger: { level: 'warn', stream: { write: (line: string) => { lines.push(line) } } } })
    let entered = false
    app.get('/colgada', async () => {
      entered = true
      await stuck.promise
      return { ok: true }
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    const client = httpRequest({ port, host: '127.0.0.1', path: '/colgada', agent: false })
    client.on('error', () => undefined)
    client.end()
    await until(() => entered)
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 100 })
    const start = Date.now()

    signals.emit('SIGTERM')
    await until(() => exit.mock.calls.length > 0)

    expect(Date.now() - start).toBeGreaterThanOrEqual(90)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
    expect(JSON.parse(lines[0])).toMatchObject({ level: 50, timeoutMs: 100, msg: 'El cierre ordenado no terminó dentro del plazo' })
    stuck.open()
    client.destroy()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('si el cierre termina antes del plazo, sale con 0 y el plazo se cancela', async () => {
    app = Fastify({ logger: false })
    await app.ready()
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 50 })

    signals.emit('SIGTERM')
    await until(() => exit.mock.calls.length > 0)
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('el plazo total por defecto queda por debajo de los 10 s habituales y por encima del de los envíos', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBe(9_000)
    expect(SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(DELIVERY_SHUTDOWN_TIMEOUT_MS)
  })

  it('los plazos efectivos: drenaje a los 6 s, envíos hasta 8 s y nunca más allá de 8,5 s desde la señal', async () => {
    expect(SHUTDOWN_DRAIN_MS).toBe(6_000)
    expect(DELIVERY_SHUTDOWN_TIMEOUT_MS).toBe(8_000)
    expect(REPORT_RESERVE_MS).toBe(500)
    app = Fastify({ logger: false })
    await app.ready()
    const close = vi.spyOn(app, 'close').mockReturnValue(new Promise<undefined>(() => undefined) as never)
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit })

    signals.emit('SIGTERM')

    // Sin el máximo de 8 s, la espera llegaría justo hasta el límite de 8,5 s: nunca más.
    expect(deliveryWaitBudgetMs(60_000)).toBeLessThanOrEqual(8_500)
    expect(deliveryWaitBudgetMs(60_000)).toBeGreaterThan(8_300)
    expect(deliveryWaitBudgetMs(DELIVERY_SHUTDOWN_TIMEOUT_MS)).toBe(8_000)
    signals.emit('SIGINT')
    expect(exit).toHaveBeenCalledWith(1)
    close.mockRestore()
  })

  it('un fallo del cierre se registra con campos cerrados, sin el mensaje', async () => {
    const lines: string[] = []
    app = Fastify({ logger: { level: 'warn', stream: { write: (line: string) => { lines.push(line) } } } })
    await app.ready()
    vi.spyOn(app, 'close').mockRejectedValue(Object.assign(new Error('fallo con secreto@estateforge.test'), { code: 'ECONNECTION' }))
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit })

    signals.emit('SIGTERM')
    await until(() => exit.mock.calls.length > 0)

    expect(JSON.parse(lines[0])).toMatchObject({ level: 50, errorName: 'Error', errorCode: 'ECONNECTION', msg: 'Falló el cierre ordenado' })
    expect(lines.join('')).not.toContain('secreto@estateforge.test')
    vi.mocked(app.close).mockRestore()
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
