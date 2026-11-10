/* oxlint-disable unicorn/no-thenable -- estas pruebas construyen thenables a propósito */
import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import { connect, type AddressInfo, type Socket } from 'node:net'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestWorkOf, trackRequestWork, type RequestWorkTracker } from './request-work.js'
import { registerGracefulShutdown } from './shutdown.js'

// M-1: contrato del seguimiento con Fastify real. Las desconexiones usan sockets reales en
// localhost. La señal de cierre se emite sobre un emisor propio: NO son señales reales.

type Done = (error?: Error) => void

function gate<T = void>() {
  let open: (value: T) => void = () => undefined
  let fail: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    open = resolve
    fail = reject
  })
  return { promise, open, fail }
}

// Límite propio, por debajo del de Vitest, para que un fallo diga qué condición no se cumplió.
async function until(condition: () => boolean, ms = 2_000) {
  const deadline = Date.now() + ms
  while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  expect(condition(), `condición no alcanzada en ${ms} ms: ${condition.toString()}`).toBe(true)
}

const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))

// N-5: una espera con límite propio, muy por debajo del de Vitest, que dice qué no llegó.
async function within<T>(pending: PromiseLike<T>, what = 'la respuesta', ms = 1_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no llegó en ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([pending, limit])
  } finally {
    clearTimeout(timer)
  }
}

let apps: FastifyInstance[] = []
let clients: { destroy(): unknown }[] = []

// Los clientes se cierran antes: una prueba que falle no debe dejar app.close() esperando.
afterEach(async () => {
  for (const client of clients) client.destroy()
  clients = []
  await within(Promise.all(apps.map(app => app.close().catch(() => undefined))), 'app.close en la limpieza', 4_000)
  apps = []
})

async function tracked(setup: (app: FastifyInstance) => void) {
  const app = Fastify({ logger: false })
  apps.push(app)
  const work = trackRequestWork(app)
  setup(app)
  await app.ready()
  return { app, work }
}

async function plain(setup: (app: FastifyInstance) => void) {
  const app = Fastify({ logger: false })
  apps.push(app)
  setup(app)
  await app.ready()
  return app
}

async function listening(setup: (app: FastifyInstance) => void) {
  const app = Fastify({ logger: false })
  apps.push(app)
  const work = trackRequestWork(app)
  setup(app)
  await app.listen({ port: 0, host: '127.0.0.1' })
  return { app, work, port: (app.server.address() as AddressInfo).port }
}

function connectClient(port: number, path: string) {
  const client = httpRequest({ port, host: '127.0.0.1', path, agent: false })
  client.on('error', () => undefined)
  client.end()
  clients.push(client)
  return client
}

async function expectBalanced(work: RequestWorkTracker) {
  await vi.waitFor(() => expect(work.running()).toBe(0))
}

describe('etapas con promesa', () => {
  it('cuenta un manejador async pendiente y lo libera al resolverse', async () => {
    const work0 = gate<{ ok: boolean }>()
    const { app, work } = await tracked(a => a.get('/x', async () => work0.promise))
    const response = app.inject({ method: 'GET', url: '/x' })
    await until(() => work.running() === 1)

    work0.open({ ok: true })

    expect((await within(response)).json()).toEqual({ ok: true })
    await expectBalanced(work)
  })

  it('libera al rechazarse la promesa y conserva el error', async () => {
    const work0 = gate()
    const { app, work } = await tracked(a => a.get('/x', async () => work0.promise))
    const response = app.inject({ method: 'GET', url: '/x' })
    await until(() => work.running() === 1)

    work0.fail(new Error('fallo'))

    expect((await within(response)).statusCode).toBe(500)
    await expectBalanced(work)
  })

  it('libera tras una excepción síncrona del manejador y del hook', async () => {
    const { app, work } = await tracked(a => {
      a.get('/m', () => { throw new Error('m') })
      a.get('/h', { preHandler: () => { throw new Error('h') } }, async () => ({ ok: true }))
    })

    expect((await within(app.inject({ method: 'GET', url: '/m' }))).statusCode).toBe(500)
    expect((await within(app.inject({ method: 'GET', url: '/h' }))).statusCode).toBe(500)
    expect(work.running()).toBe(0)
  })

  it('cuenta un preHandler async y encadena con el manejador', async () => {
    const hook = gate()
    const handler = gate<{ ok: boolean }>()
    const { app, work } = await tracked(a => a.get('/x', { preHandler: [async () => hook.promise] }, async () => handler.promise))
    const response = app.inject({ method: 'GET', url: '/x' })
    await until(() => work.running() === 1)

    hook.open()
    await tick()
    expect(work.running()).toBe(1)
    handler.open({ ok: true })

    expect((await within(response)).statusCode).toBe(200)
    await expectBalanced(work)
  })

  it('una etapa que no termina sigue contada', async () => {
    const { app, work } = await tracked(a => a.get('/x', async () => new Promise(() => undefined)))
    const client = app.inject({ method: 'GET', url: '/x' })
    void client
    await until(() => work.running() === 1)
    await tick(60)

    expect(work.running()).toBe(1)
  })
})

describe('thenables', () => {
  function thenable(run: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => void) {
    return {
      calls: 0,
      then(this: { calls: number }, resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        this.calls += 1
        run(resolve, reject)
      },
    }
  }

  it('reconoce un thenable no nativo, lo cuenta hasta el final e invoca then una sola vez', async () => {
    const value = gate<unknown>()
    const result = thenable(resolve => { void value.promise.then(resolve) })
    const { app, work } = await tracked(a => a.get('/x', () => result))
    const response = app.inject({ method: 'GET', url: '/x' })
    await until(() => work.running() === 1)
    await tick()
    expect(work.running()).toBe(1)

    value.open({ ok: true })

    expect((await within(response)).json()).toEqual({ ok: true })
    expect(result.calls).toBe(1)
    await expectBalanced(work)
  })

  it('libera un thenable no nativo rechazado y conserva el error', async () => {
    const { app, work } = await tracked(a => a.get('/x', () => thenable((_r, reject) => reject(new Error('t')))))

    expect((await within(app.inject({ method: 'GET', url: '/x' }))).statusCode).toBe(500)
    await expectBalanced(work)
  })

  it('con un thenable que resuelve y rechaza, gana lo primero y libera una vez', async () => {
    const { app, work } = await tracked(a => a.get('/x', () => thenable((resolve, reject) => {
      resolve({ ok: true })
      reject(new Error('tarde'))
    })))

    expect((await within(app.inject({ method: 'GET', url: '/x' }))).json()).toEqual({ ok: true })
    await expectBalanced(work)
  })

  it('un hook que devuelve un thenable no nativo se cuenta hasta que termina', async () => {
    const value = gate<unknown>()
    const { app, work } = await tracked(a => a.get('/x', {
      preHandler: (() => thenable(resolve => { void value.promise.then(resolve) })) as never,
    }, async () => ({ ok: true })))
    const response = app.inject({ method: 'GET', url: '/x' })
    await until(() => work.running() === 1)
    await tick()
    expect(work.running()).toBe(1)

    value.open(undefined)

    expect((await within(response)).statusCode).toBe(200)
    await expectBalanced(work)
  })

  it.each([
    ['propiedad then que lanza', () => ({ get then() { throw new Error('getter') } })],
    ['método then que lanza', () => ({ then() { throw new Error('then') } })],
    ['then que no es función', () => ({ then: 1, valor: 2 })],
  ])('%s: el resultado HTTP es el mismo que sin seguimiento y no queda trabajo', async (_label, make) => {
    const define = (a: FastifyInstance) => a.get('/x', make as never)
    const { app, work } = await tracked(define)
    const raw = await plain(define)

    const [a, b] = await within(Promise.all([app.inject({ method: 'GET', url: '/x' }), raw.inject({ method: 'GET', url: '/x' })]), 'las dos respuestas')

    expect(a.statusCode).toBe(b.statusCode)
    expect(a.payload).toBe(b.payload)
    await expectBalanced(work)
  })

  it('reply no se trata como trabajo: un manejador y un hook síncronos que lo devuelven no quedan contados', async () => {
    const { app, work } = await tracked(a => {
      a.get('/m', (_q, reply) => reply.code(201).send({ ok: true }))
      a.get('/h', { preHandler: ((_q: FastifyRequest, reply: FastifyReply) => reply.code(401).send({ no: true })) as never }, async () => ({ ok: true }))
    })

    expect((await within(app.inject({ method: 'GET', url: '/m' }))).statusCode).toBe(201)
    expect((await within(app.inject({ method: 'GET', url: '/h' }))).statusCode).toBe(401)
    await expectBalanced(work)
  })
})

describe('T8-4: thenables anómalos, igual que sin seguimiento', () => {
  type Calls = { then: number }
  type Settle = (value: unknown) => void
  const failure = () => Object.assign(new Error('fallo del thenable'), { statusCode: 418 })
  const counted = (calls: Calls, run: (resolve: Settle, reject: Settle) => void) => ({
    then(resolve: Settle, reject: Settle) {
      calls.then += 1
      run(resolve, reject)
    },
  })
  const cases: [string, (calls: Calls) => unknown][] = [
    ['resuelve un valor normal', c => counted(c, resolve => resolve({ ok: 1 }))],
    ['rechaza', c => counted(c, (_resolve, reject) => reject(failure()))],
    ['resuelve otro thenable', c => counted(c, resolve => resolve({ then(inner: Settle) { inner({ ok: 1 }) } }))],
    ['resuelve y después lanza', c => counted(c, resolve => { resolve({ ok: 1 }); throw failure() })],
    ['resuelve y rechaza', c => counted(c, (resolve, reject) => { resolve({ ok: 1 }); reject(failure()) })],
    ['getter then que lanza', c => ({ get then() { c.then += 1; throw failure() } })],
    ['método then que lanza', c => counted(c, () => { throw failure() })],
    ['llama varias veces a sus callbacks', c => counted(c, resolve => { resolve({ a: 1 }); resolve({ b: 2 }) })],
  ]

  async function compare(define: (a: FastifyInstance, calls: Calls) => void) {
    const callsWith: Calls = { then: 0 }
    const callsWithout: Calls = { then: 0 }
    const { app, work } = await tracked(a => define(a, callsWith))
    const raw = await plain(a => define(a, callsWithout))

    const [a, b] = await within(Promise.all([app.inject({ method: 'GET', url: '/x' }), raw.inject({ method: 'GET', url: '/x' })]), 'las dos respuestas')

    expect({ estado: a.statusCode, cuerpo: a.payload, then: callsWith.then }).toEqual({ estado: b.statusCode, cuerpo: b.payload, then: callsWithout.then })
    await expectBalanced(work)
  }

  it.each(cases)('manejador: %s', async (_label, make) => {
    await compare((a, calls) => a.get('/x', (() => make(calls)) as never))
  })

  it.each(cases)('preHandler: %s', async (_label, make) => {
    await compare((a, calls) => a.get('/x', { preHandler: (() => make(calls)) as never }, async () => ({ fin: true })))
  })
})

describe('T8-3: valores no funcionales, igual que sin seguimiento', () => {
  async function outcome(trackIt: boolean, setup: (a: FastifyInstance) => void) {
    const app = Fastify({ logger: false })
    apps.push(app)
    if (trackIt) trackRequestWork(app)
    try {
      setup(app)
      await app.ready()
    } catch (error) {
      const { code, name, message } = error as Error & { code?: string }
      return { fase: 'arranque', code, name, message }
    }
    const response = await within(app.inject({ method: 'GET', url: '/x' }))
    return { fase: 'peticion', estado: response.statusCode, cuerpo: response.payload }
  }
  const handler = async () => ({ ok: true })
  const cases: [string, (a: FastifyInstance) => void, string][] = [
    ['manejador cadena', a => a.get('/x', { handler: 'x' as never }), 'arranque'],
    ['manejador número', a => a.get('/x', { handler: 3 as never }), 'arranque'],
    ['manejador ausente', a => a.route({ method: 'GET', url: '/x' } as never), 'arranque'],
    ['hook único cadena', a => a.get('/x', { preHandler: 'x' as never }, handler), 'arranque'],
    ['hook único objeto', a => a.get('/x', { preHandler: {} as never }, handler), 'arranque'],
    ['array con no función', a => a.get('/x', { preHandler: ['x'] as never }, handler), 'arranque'],
    ['array mixto', a => a.get('/x', { preHandler: [async () => undefined, 3] as never }, handler), 'arranque'],
    ['función válida', a => a.get('/x', { preHandler: async () => undefined }, handler), 'peticion'],
    ['callback válido', a => a.get('/x', { preHandler: (_q: FastifyRequest, _r: FastifyReply, done: Done) => done() }, handler), 'peticion'],
  ]

  it.each(cases)('%s', async (_label, setup, fase) => {
    const withTracking = await outcome(true, setup)

    expect(withTracking).toEqual(await outcome(false, setup))
    expect(withTracking.fase).toBe(fase)
  })
})

describe('N-2: validación de hooks de Fastify, igual que sin seguimiento', () => {
  async function outcome(trackIt: boolean, setup: (a: FastifyInstance) => void) {
    const app = Fastify({ logger: false })
    apps.push(app)
    if (trackIt) trackRequestWork(app)
    try {
      setup(app)
      await app.ready()
    } catch (error) {
      const { code, name, message } = error as Error & { code?: string }
      return { fase: 'arranque', code, name, message }
    }
    const response = await within(app.inject({ method: 'GET', url: '/x' }))
    return { fase: 'peticion', estado: response.statusCode, cuerpo: response.payload }
  }
  const handler = async () => ({ ok: true })
  const invalid = async (_q: FastifyRequest, _r: FastifyReply, _done: Done) => undefined
  const callback = (_q: FastifyRequest, _r: FastifyReply, done: Done) => done()
  const asyncOk = async (_q: FastifyRequest, _r: FastifyReply) => undefined
  const route = (preHandler: unknown) => (a: FastifyInstance) => { a.get('/x', { preHandler: preHandler as never }, handler) }
  const INVALID = 'FST_ERR_HOOK_INVALID_ASYNC_HANDLER'
  const NOT_FUNCTION = 'FST_ERR_HOOK_INVALID_HANDLER'
  const cases: [string, (a: FastifyInstance) => void, string, string | undefined][] = [
    ['array con async de tres argumentos', route([invalid]), 'arranque', INVALID],
    ['array: válido antes del inválido', route([asyncOk, invalid]), 'arranque', INVALID],
    ['array: callback antes del inválido', route([callback, invalid]), 'arranque', INVALID],
    ['array: el no función va primero', route(['x', invalid]), 'arranque', NOT_FUNCTION],
    ['array: el async inválido va primero', route([invalid, 'x']), 'arranque', INVALID],
    ['array válido: async y callback', route([asyncOk, callback]), 'peticion', undefined],
    ['hook único async de tres argumentos', route(invalid), 'peticion', undefined],
    ['hook único callback', route(callback), 'peticion', undefined],
    ['manejador async de tres argumentos', a => { a.get('/x', (async (_q: unknown, _r: unknown, _x: unknown) => ({ ok: 1 })) as never) }, 'peticion', undefined],
  ]

  it.each(cases)('%s', async (_label, setup, fase, code) => {
    const withTracking = await outcome(true, setup)

    expect(withTracking).toEqual(await outcome(false, setup))
    expect(withTracking.fase).toBe(fase)
    expect((withTracking as { code?: string }).code).toBe(code)
  })

  it('el envoltorio conserva aridad y prototipo y mantiene su marca', async () => {
    let seen: { length: number; ctor: string; name: string } | undefined
    const app = Fastify({ logger: false })
    apps.push(app)
    trackRequestWork(app)
    app.addHook('onRoute', route => {
      const hook = route.preHandler as unknown as (() => void) | undefined
      if (hook) seen = { length: hook.length, ctor: hook.constructor.name, name: hook.name }
    })
    app.get('/x', { preHandler: invalid }, handler)
    await app.ready()

    expect(seen).toEqual({ length: 3, ctor: 'AsyncFunction', name: 'wrappedStage' })
  })
})

describe('N-3: getters then con estado, igual que sin seguimiento', () => {
  type Calls = { reads: number; thens: number }
  type Settle = (value: unknown) => void
  const failure = () => Object.assign(new Error('fallo del getter'), { statusCode: 418 })
  const resolves = (calls: Calls, value: unknown = { ok: 1 }) => (resolve: Settle) => { calls.thens += 1; resolve(value) }
  const rejects = (calls: Calls) => (_resolve: Settle, reject: Settle) => { calls.thens += 1; reject(failure()) }

  const cases: [string, (calls: Calls) => unknown][] = [
    ['1 siempre función', c => ({ get then() { c.reads += 1; return resolves(c) } })],
    ['2 siempre no función', c => ({ valor: 2, get then() { c.reads += 1; return 7 } })],
    ['3 función y lanza en la segunda lectura', c => ({ get then() { c.reads += 1; if (c.reads > 1) throw failure(); return resolves(c) } })],
    ['4a alterna función y no función', c => ({ valor: 1, get then() { c.reads += 1; return c.reads % 2 === 1 ? resolves(c) : 7 } })],
    ['4b alterna no función y función', c => ({ valor: 1, get then() { c.reads += 1; return c.reads % 2 === 0 ? resolves(c) : 7 } })],
    ['5 funciones diferentes', c => ({ get then() { c.reads += 1; return resolves(c, { lectura: c.reads }) } })],
    ['6 función que rechaza', c => ({ get then() { c.reads += 1; return rejects(c) } })],
    ['7 función que resuelve', c => ({ get then() { c.reads += 1; return resolves(c, { resuelto: true }) } })],
    ['8 modifica estado en la lectura, no función', c => {
      const body = { lecturas: 0, get then() { c.reads += 1; body.lecturas += 1; return undefined } }
      return body
    }],
    ['8b modifica estado en la lectura, función', c => {
      const state = { lecturas: 0 }
      return { get then() { c.reads += 1; state.lecturas += 1; return resolves(c, { ...state }) } }
    }],
    ['getter que siempre lanza', c => ({ get then() { c.reads += 1; throw failure() } })],
    ['then heredado por getter', c => Object.create({ get then() { c.reads += 1; return resolves(c) } }) as unknown],
    ['Proxy con then función', c => new Proxy({}, { get: (_t, key) => { if (key === 'then') { c.reads += 1; return resolves(c) } return undefined } })],
  ]

  async function run(trackIt: boolean, define: (a: FastifyInstance, calls: Calls) => void) {
    const calls: Calls = { reads: 0, thens: 0 }
    const app = Fastify({ logger: false })
    apps.push(app)
    const work = trackIt ? trackRequestWork(app) : undefined
    define(app, calls)
    await app.ready()
    // Sin respuesta es un resultado válido: un hook sin thenable ni next tampoco avanza sin seguimiento.
    const response = await Promise.race([app.inject({ method: 'GET', url: '/x' }), tick(120).then(() => undefined)])
    const seen = response
      ? { estado: response.statusCode, cuerpo: response.payload, error: (JSON.parse(response.payload || 'null') as { code?: string } | null)?.code }
      : { estado: 'sin respuesta' }
    return { resultado: { ...seen, lecturas: calls.reads, invocaciones: calls.thens }, work, respondio: response !== undefined }
  }

  async function compare(define: (a: FastifyInstance, calls: Calls) => void) {
    const withTracking = await run(true, define)
    const without = await run(false, define)

    // El contador va primero: una respuesta con trabajo colgado es el defecto que se quiere ver.
    if (withTracking.respondio) await expectBalanced(withTracking.work as RequestWorkTracker)
    else expect(withTracking.work?.running()).toBe(1)
    expect(withTracking.resultado).toEqual(without.resultado)
  }

  it.each(cases)('manejador: %s', async (_label, make) => {
    await compare((a, calls) => a.get('/x', (() => make(calls)) as never))
  })

  it.each(cases)('preHandler: %s', async (_label, make) => {
    await compare((a, calls) => a.get('/x', { preHandler: (() => make(calls)) as never }, async () => ({ fin: true })))
  })

  const pendingForms: [string, (then: unknown, onRead: () => void) => unknown][] = [
    ['getter propio', (then, onRead) => ({ get then() { onRead(); return then } })],
    ['getter heredado', (then, onRead) => Object.create({ get then() { onRead(); return then } }) as unknown],
    ['Proxy', (then, onRead) => new Proxy({}, { get: (_t, key) => { if (key === 'then') { onRead(); return then } return undefined } })],
    ['Proxy en el prototipo', (then, onRead) => Object.create(new Proxy({}, { get: (_t, key) => { if (key === 'then') { onRead(); return then } return undefined } })) as unknown],
  ]

  it.each(pendingForms)('un hook con %s pendiente sigue contado y libera al asentarse', async (_label, make) => {
    const value = gate<unknown>()
    let reads = 0
    const then = (resolve: Settle) => { void value.promise.then(resolve) }
    const { app, work } = await tracked(a => a.get('/x', {
      preHandler: (() => make(then, () => { reads += 1 })) as never,
    }, async () => ({ ok: true })))
    const response = app.inject({ method: 'GET', url: '/x' })
    await until(() => work.running() === 1 && reads === 2)
    await tick()
    expect(work.running()).toBe(1)

    value.open(undefined)

    expect((await within(response)).statusCode).toBe(200)
    await expectBalanced(work)
  })

  it('el cuerpo de un objeto con accessor then llega intacto', async () => {
    const { app, work } = await tracked(a => a.get('/x', (() => ({ a: 1, b: { c: [2] }, get then() { return 5 } })) as never))

    expect((await within(app.inject({ method: 'GET', url: '/x' }))).json()).toEqual({ a: 1, b: { c: [2] }, then: 5 })
    await expectBalanced(work)
  })
})

describe('N-4: return reply y next diferido', () => {
  const deferred = (later: { promise: Promise<void> }) => ((_q: FastifyRequest, reply: FastifyReply, done: Done) => {
    void later.promise.then(() => done())
    return reply
  }) as never

  async function compare(define: (a: FastifyInstance, count: { handler: number }) => void) {
    const a = { handler: 0 }
    const b = { handler: 0 }
    const { app, work } = await tracked(x => define(x, a))
    const raw = await plain(x => define(x, b))
    const [x, y] = await within(Promise.all([app.inject({ method: 'GET', url: '/x' }), raw.inject({ method: 'GET', url: '/x' })]), 'las dos respuestas')

    expect({ estado: x.statusCode, cuerpo: x.payload, manejador: a.handler }).toEqual({ estado: y.statusCode, cuerpo: y.payload, manejador: b.handler })
    await expectBalanced(work)
  }

  it('sigue contado hasta next, con la respuesta y el manejador iguales que sin seguimiento', async () => {
    const later = gate()
    const { app, work } = await tracked(a => a.get('/x', { preHandler: deferred(later) }, async () => ({ ok: true })))
    const response = app.inject({ method: 'GET', url: '/x' })
    await until(() => work.running() === 1)
    await tick()
    expect(work.running()).toBe(1)

    later.open()

    expect((await within(response)).statusCode).toBe(200)
    await expectBalanced(work)
  })

  it('tras desconectarse el cliente no se libera antes de next', async () => {
    const later = gate()
    let entered = false
    const { work, port } = await listening(a => a.get('/x', {
      preHandler: ((_q: FastifyRequest, reply: FastifyReply, done: Done) => {
        entered = true
        void later.promise.then(() => done())
        return reply
      }) as never,
    }, async () => ({ ok: true })))
    const client = connectClient(port, '/x')
    await until(() => entered)

    client.destroy()
    await tick(60)
    expect(work.running()).toBe(1)

    later.open()
    await expectBalanced(work)
  })

  it.each([
    ['next diferido', (a: FastifyInstance, c: { handler: number }) => a.get('/x', { preHandler: ((_q: FastifyRequest, reply: FastifyReply, done: Done) => { setImmediate(() => done()); return reply }) as never }, async () => { c.handler += 1; return { ok: true } })],
    ['next síncrono y return reply', (a: FastifyInstance, c: { handler: number }) => a.get('/x', { preHandler: ((_q: FastifyRequest, reply: FastifyReply, done: Done) => { done(); return reply }) as never }, async () => { c.handler += 1; return { ok: true } })],
    ['responde y devuelve reply sin next', (a: FastifyInstance, c: { handler: number }) => a.get('/x', { preHandler: ((_q: FastifyRequest, reply: FastifyReply, _done: Done) => reply.code(401).send({ no: true })) as never }, async () => { c.handler += 1; return { ok: true } })],
    ['dos parámetros: responde y devuelve reply', (a: FastifyInstance, c: { handler: number }) => a.get('/x', { preHandler: ((_q: FastifyRequest, reply: FastifyReply) => reply.code(401).send({ no: true })) as never }, async () => { c.handler += 1; return { ok: true } })],
    ['async: responde y devuelve reply', (a: FastifyInstance, c: { handler: number }) => a.get('/x', { preHandler: async (_q, reply) => reply.code(401).send({ no: true }) }, async () => { c.handler += 1; return { ok: true } })],
  ])('%s: igual que sin seguimiento y sin trabajo colgado', async (_label, define) => {
    await compare(define)
  })

  it('dos parámetros con respuesta diferida: reply no se cuenta como trabajo', async () => {
    const later = gate()
    const { app, work } = await tracked(a => a.get('/x', {
      preHandler: ((_q: FastifyRequest, reply: FastifyReply) => {
        void later.promise.then(() => reply.code(202).send({ tarde: true }))
        return reply
      }) as never,
    }, async () => ({ ok: true })))
    const response = app.inject({ method: 'GET', url: '/x' })
    await tick()

    expect(work.running()).toBe(0)

    later.open()
    expect((await within(response)).statusCode).toBe(202)
  })

  it('límite documentado: un callback que responde sin next ni return sigue contado', async () => {
    const { app, work } = await tracked(a => a.get('/x', {
      preHandler: (_q: FastifyRequest, reply: FastifyReply, _done: Done) => { void reply.code(401).send({ no: true }) },
    }, async () => ({ ok: true })))

    expect((await within(app.inject({ method: 'GET', url: '/x' }))).statusCode).toBe(401)
    await tick()
    expect(work.running()).toBe(1)
  })
})

describe('N-1: frontera, trabajo diferido en onRequest no se sigue', () => {
  type Setup = (a: FastifyInstance, pending: Promise<void>, reached: () => void) => Promise<void>
  const route = (a: FastifyInstance, config?: object) => { a.get('/x', config ? { config } : {}, async () => ({ ok: true })) }
  const variants: [string, Setup][] = [
    ['origin async', async (a, pending, reached) => {
      await a.register(cors, { origin: (async () => { reached(); await pending; return true }) as never })
      route(a)
    }],
    ['origin con promesa sin async', async (a, pending, reached) => {
      await a.register(cors, { origin: (() => { reached(); return pending.then(() => true) }) as never })
      route(a)
    }],
    ['origin con callback diferido', async (a, pending, reached) => {
      await a.register(cors, { origin: (_origin, callback) => { reached(); void pending.then(() => callback(null, true)) } })
      route(a)
    }],
    ['keyGenerator async global', async (a, pending, reached) => {
      await a.register(rateLimit, { global: true, max: 5, timeWindow: '1 minute', keyGenerator: async () => { reached(); await pending; return 'k' } })
      route(a)
    }],
    ['keyGenerator async de ruta', async (a, pending, reached) => {
      await a.register(rateLimit, { global: false, max: 5, timeWindow: '1 minute' })
      route(a, { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: async () => { reached(); await pending; return 'k' } } })
    }],
  ]

  it.each(variants)('%s: no cuenta y el cierre no lo espera', async (_label, setup) => {
    const pending = gate()
    let reached = false
    const app = Fastify({ logger: false })
    apps.push(app)
    const work = trackRequestWork(app)
    await setup(app, pending.promise, () => { reached = true })
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 3_000, drainMs: 1_500 })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const client = connectClient((app.server.address() as AddressInfo).port, '/x')
    try {
      await until(() => reached)
      expect(work.running()).toBe(0)

      client.destroy()
      await tick(40)
      expect(work.running()).toBe(0)

      signals.emit('SIGTERM')
      await until(() => exit.mock.calls.length > 0)
      expect(exit).toHaveBeenCalledWith(0)
    } finally {
      pending.open()
    }
    await expectBalanced(work)
  })
})

describe('T8-6: this de cada etapa', () => {
  type Seen = Record<string, unknown>
  function stages(owner: (self: unknown) => boolean, seen: Seen, label: string) {
    return {
      preHandler: [
        async function (this: unknown) { seen[`${label} hook async`] = owner(this) },
        function (this: unknown, _q: FastifyRequest, _r: FastifyReply, done: Done) { seen[`${label} hook callback`] = owner(this); done() },
      ],
      handler: async function (this: unknown) { seen[`${label} manejador`] = owner(this); return 1 },
    }
  }
  async function contexts(trackIt: boolean) {
    const seen: Seen = {}
    const app = Fastify({ logger: false })
    apps.push(app)
    if (trackIt) trackRequestWork(app)
    app.get('/raiz', stages(self => self === app, seen, 'raíz'))
    let child: unknown
    await app.register(async instance => {
      child = instance
      instance.get('/hija', stages(self => self === child && self !== app, seen, 'hija'))
    })
    await app.ready()
    await within(app.inject({ method: 'GET', url: '/raiz' }))
    await within(app.inject({ method: 'GET', url: '/hija' }))
    await within(app.inject({ method: 'HEAD', url: '/hija' }))
    return seen
  }

  it('es la instancia correcta, también en un plugin, e igual que sin seguimiento', async () => {
    const withTracking = await contexts(true)

    expect(withTracking).toEqual({
      'raíz hook async': true, 'raíz hook callback': true, 'raíz manejador': true,
      'hija hook async': true, 'hija hook callback': true, 'hija manejador': true,
    })
    expect(withTracking).toEqual(await contexts(false))
  })
})

describe('T8-7: frontera del contrato', () => {
  it('async con return reply: una desconexión libera aunque siga una operación no registrada', async () => {
    const independent = gate()
    let entered = false
    let finished = false
    const { work, port } = await listening(a => a.get('/x', async (_q, reply) => {
      entered = true
      void independent.promise.then(() => { finished = true })
      return reply
    }))
    const client = connectClient(port, '/x')
    await until(() => entered)
    await tick()
    expect(work.running()).toBe(1)

    client.destroy()

    await until(() => work.running() === 0)
    expect(finished).toBe(false)
    independent.open()
  })
})

describe('reply devuelto con respuesta diferida', () => {
  it('no se cuenta como trabajo: el contrato exige devolver una promesa', async () => {
    const later = gate()
    const { app, work } = await tracked(a => a.get('/x', (_q, reply) => {
      void later.promise.then(() => reply.send({ ok: true }))
      return reply
    }))
    const response = app.inject({ method: 'GET', url: '/x' })
    await tick()

    expect(work.running()).toBe(0)

    later.open()
    expect((await within(response)).json()).toEqual({ ok: true })
  })
})

describe('hooks con callback', () => {
  it('cuenta hasta que se invoca next, de forma diferida', async () => {
    const hook = gate()
    let reached = false
    const { app, work } = await tracked(a => a.get('/x', {
      preHandler: (_q: FastifyRequest, _r: FastifyReply, done: Done) => { void hook.promise.then(() => done()) },
    }, async () => { reached = true; return { ok: true } }))
    const response = app.inject({ method: 'GET', url: '/x' })
    await until(() => work.running() === 1)
    await tick()
    expect(work.running()).toBe(1)
    expect(reached).toBe(false)

    hook.open()

    expect((await within(response)).statusCode).toBe(200)
    await expectBalanced(work)
  })

  it('un next síncrono libera y continúa', async () => {
    const { app, work } = await tracked(a => a.get('/x', { preHandler: (_q: FastifyRequest, _r: FastifyReply, done: Done) => done() }, async () => ({ ok: true })))

    expect((await within(app.inject({ method: 'GET', url: '/x' }))).statusCode).toBe(200)
    await expectBalanced(work)
  })

  it('un next con error libera y conserva el error', async () => {
    const define = (a: FastifyInstance) => a.get('/x', {
      preHandler: (_q: FastifyRequest, _r: FastifyReply, done: Done) => done(new Error('fallo')),
    }, async () => ({ ok: true }))
    const { app, work } = await tracked(define)
    const raw = await plain(define)

    const [a, b] = await within(Promise.all([app.inject({ method: 'GET', url: '/x' }), raw.inject({ method: 'GET', url: '/x' })]), 'las dos respuestas')

    expect(a.statusCode).toBe(500)
    expect(a.json()).toEqual(b.json())
    await expectBalanced(work)
  })

  it('next invocado dos veces: libera una sola vez y Fastify se comporta igual que sin seguimiento', async () => {
    const counts = { tracked: 0, plain: 0 }
    const define = (key: 'tracked' | 'plain') => (a: FastifyInstance) => a.get('/x', {
      preHandler: (_q: FastifyRequest, _r: FastifyReply, done: Done) => { done(); done() },
    }, async () => { counts[key] += 1; return { ok: true } })
    const { app, work } = await tracked(define('tracked'))
    const raw = await plain(define('plain'))

    const [a, b] = await within(Promise.all([app.inject({ method: 'GET', url: '/x' }), raw.inject({ method: 'GET', url: '/x' })]), 'las dos respuestas')

    expect(a.statusCode).toBe(b.statusCode)
    expect(counts.tracked).toBe(counts.plain)
    await expectBalanced(work)
    expect(work.running()).toBe(0)
  })

  it('una segunda invocación diferida de next no libera otra etapa que siga activa', async () => {
    const second = gate()
    let entered = false
    const { app, work } = await tracked(a => a.get('/x', {
      preHandler: [
        (_q: FastifyRequest, _r: FastifyReply, done: Done) => { setImmediate(() => { done(); done() }) },
        async () => { entered = true; await second.promise },
      ],
    }, async () => ({ ok: true })))
    const response = app.inject({ method: 'GET', url: '/x' })
    await until(() => entered)
    await tick()

    expect(work.running()).toBe(1)

    second.open()
    await within(response)
    await expectBalanced(work)
  })

  it('un callback que no se invoca sigue contado', async () => {
    const { app, work } = await tracked(a => a.get('/x', { preHandler: (() => undefined) as never }, async () => ({ ok: true })))
    void app.inject({ method: 'GET', url: '/x' })
    await until(() => work.running() === 1)
    await tick(60)

    expect(work.running()).toBe(1)
  })

  it('reenvía a next exactamente sus argumentos y su this', async () => {
    let stage: ((...args: unknown[]) => unknown) | undefined
    const app = Fastify({ logger: false })
    apps.push(app)
    trackRequestWork(app)
    app.addHook('onRoute', route => { stage = route.preHandler as unknown as typeof stage })
    const error = new Error('fallo')
    const self = { nombre: 'contexto' }
    app.get('/x', { preHandler: ((_q: FastifyRequest, _r: FastifyReply, done: (...args: unknown[]) => void) => { done.call(self, error, 'extra', 3) }) as never }, async () => 1)
    await app.ready()
    const next = vi.fn(function (this: unknown) { return this })

    stage?.({}, {}, next)

    expect(next).toHaveBeenCalledExactlyOnceWith(error, 'extra', 3)
    expect(next.mock.results[0].value).toBe(self)
  })
})

describe('contrato: lo que no se puede detectar', () => {
  it('un manejador síncrono con reply.send diferido no se cuenta', async () => {
    const later = gate()
    const { app, work } = await tracked(a => a.get('/x', (_q, reply) => { void later.promise.then(() => reply.send({ ok: true })) }))
    const response = app.inject({ method: 'GET', url: '/x' })
    await tick()

    expect(work.running()).toBe(0)
    later.open()
    expect((await within(response)).statusCode).toBe(200)
  })

  it('el trabajo fire-and-forget no registrado no se cuenta', async () => {
    const later = gate()
    const { app, work } = await tracked(a => a.get('/x', async () => { void later.promise; return { ok: true } }))

    expect((await within(app.inject({ method: 'GET', url: '/x' }))).statusCode).toBe(200)
    await expectBalanced(work)
    later.open()
  })
})

describe('comportamiento HTTP y rutas', () => {
  const define = (a: FastifyInstance) => {
    a.get('/obj', async () => ({ a: 1 }))
    a.get('/texto', async () => 'hola')
    a.get('/send', async (_q, reply) => reply.code(201).header('x-prueba', '1').send({ b: 2 }))
    a.get('/sync', () => ({ c: 3 }))
    a.get('/error', async () => { throw Object.assign(new Error('e'), { statusCode: 418 }) })
    a.post('/eco', async request => request.body)
    a.get('/pre', { preHandler: async (_q, reply) => { void reply.code(403).send({ d: 4 }) } }, async () => ({ e: 5 }))
  }

  it.each([
    ['GET', '/obj'], ['GET', '/texto'], ['GET', '/send'], ['GET', '/sync'], ['GET', '/error'], ['GET', '/pre'],
    ['HEAD', '/obj'], ['GET', '/no-existe'], ['POST', '/eco'],
  ] as const)('%s %s responde igual con y sin seguimiento', async (method, url) => {
    const { app, work } = await tracked(define)
    const raw = await plain(define)
    const options = method === 'POST' ? { method, url, payload: { z: 1 } } : { method, url }

    const [a, b] = await within(Promise.all([app.inject(options), raw.inject(options)]), 'las dos respuestas')

    expect(a.statusCode).toBe(b.statusCode)
    expect(a.payload).toBe(b.payload)
    expect(a.headers['content-type']).toBe(b.headers['content-type'])
    await expectBalanced(work)
  })

  it('el inventario registra las rutas, sus hooks y si el manejador es async', async () => {
    const { work, app } = await tracked(a => {
      a.get('/a', { preHandler: async () => undefined }, async () => 1)
      a.post('/b', { preValidation: async () => undefined }, () => 2)
      a.register(async child => { child.delete('/c', async () => 3) })
    })

    expect(work.routes()).toContainEqual({ method: 'GET', url: '/a', handlerIsAsync: true, routeHooks: ['preHandler'] })
    expect(work.routes()).toContainEqual({ method: 'POST', url: '/b', handlerIsAsync: false, routeHooks: ['preValidation'] })
    expect(work.routes()).toContainEqual({ method: 'DELETE', url: '/c', handlerIsAsync: true, routeHooks: [] })
    expect(work.routes().find(route => route.method === 'HEAD' && route.url === '/a')?.handlerIsAsync).toBe(true)
    expect(requestWorkOf(app)).toBe(work)
  })

  it('una ruta registrada antes de instalar el seguimiento no se cuenta ni aparece en el inventario', async () => {
    const app = Fastify({ logger: false })
    apps.push(app)
    const pending = gate()
    app.get('/antes', async () => pending.promise)
    const work = trackRequestWork(app)
    await app.ready()
    const response = app.inject({ method: 'GET', url: '/antes' })
    await tick()

    expect(work.running()).toBe(0)
    expect(work.routes()).toEqual([])
    pending.open()
    await within(response)
  })

  it('una ruta HEAD pendiente cuenta una sola petición', async () => {
    const pending = gate<{ ok: boolean }>()
    const { app, work } = await tracked(a => a.get('/x', async () => pending.promise))
    const response = app.inject({ method: 'HEAD', url: '/x' })
    await until(() => work.running() === 1)

    pending.open({ ok: true })

    expect((await within(response)).statusCode).toBe(200)
    await expectBalanced(work)
  })
})

describe('desconexiones reales (localhost)', () => {
  it('sigue contando el manejador tras la desconexión y lo libera al terminar', async () => {
    const pending = gate()
    let entered = false
    let finished = false
    const { work, port } = await listening(a => a.get('/x', async () => { entered = true; await pending.promise; finished = true; return { ok: true } }))
    const client = connectClient(port, '/x')
    await until(() => entered)

    client.destroy()
    await tick(60)
    expect(work.running()).toBe(1)
    expect(finished).toBe(false)

    pending.open()
    await until(() => finished)
    await expectBalanced(work)
  })

  it('sigue contando un preHandler async y un callback tras la desconexión', async () => {
    const asyncHook = gate()
    const callbackHook = gate()
    let entered = 0
    const { work, port } = await listening(a => {
      a.get('/async', { preHandler: async () => { entered += 1; await asyncHook.promise } }, async () => ({ ok: true }))
      a.get('/cb', { preHandler: (_q: FastifyRequest, _r: FastifyReply, done: Done) => { entered += 1; void callbackHook.promise.then(() => done()) } }, async () => ({ ok: true }))
    })
    const clients = [connectClient(port, '/async'), connectClient(port, '/cb')]
    await until(() => entered === 2)

    for (const client of clients) client.destroy()
    await tick(60)
    expect(work.running()).toBe(2)

    asyncHook.open()
    callbackHook.open()
    await expectBalanced(work)
  })

  it('un rechazo tras la desconexión libera el trabajo', async () => {
    const pending = gate()
    let entered = false
    const { work, port } = await listening(a => a.get('/x', async () => { entered = true; await pending.promise }))
    const client = connectClient(port, '/x')
    await until(() => entered)
    client.destroy()
    await tick(40)

    pending.fail(new Error('fallo tras desconectar'))

    await expectBalanced(work)
  })

  it('corte del cuerpo HTTP: el manejador no llega a ejecutarse y no queda trabajo', async () => {
    let handled = false
    const { work, port, app } = await listening(a => a.post('/x', async () => { handled = true; return { ok: true } }))
    const socket = await within(new Promise<Socket>((resolve, reject) => {
      const s = connect(port, '127.0.0.1', () => resolve(s))
      s.on('error', () => undefined)
      s.once('error', reject)
      clients.push(s)
    }), 'la conexión TCP')

    socket.write('POST /x HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"a"')
    await tick(40)
    socket.destroy()
    await tick(60)

    expect(handled).toBe(false)
    expect(work.running()).toBe(0)
    expect(app.server.listening).toBe(true)
  })
})

describe('concurrencia', () => {
  // running() es el tamaño de un Map: no puede ser negativo. La liberación doble se comprueba en
  // «una segunda invocación diferida de next no libera otra etapa que siga activa».
  it('peticiones simultáneas: recuento exacto mientras están pendientes y vuelta a cero', async () => {
    const pending = gate<{ ok: boolean }>()
    const { app, work } = await tracked(a => a.get('/x', async () => pending.promise))
    const responses = Array.from({ length: 25 }, () => app.inject({ method: 'GET', url: '/x' }))
    await until(() => work.running() === 25)
    await tick()
    expect(work.running()).toBe(25)

    pending.open({ ok: true })
    await within(Promise.all(responses), 'las respuestas')

    await expectBalanced(work)
  })

  it('etapas distintas pendientes a la vez', async () => {
    const hook = gate()
    const cb = gate()
    const handler = gate<number>()
    const { app, work } = await tracked(a => {
      a.get('/h', { preHandler: async () => hook.promise }, async () => 1)
      a.get('/c', { preHandler: (_q: FastifyRequest, _r: FastifyReply, done: Done) => { void cb.promise.then(() => done()) } }, async () => 2)
      a.get('/m', async () => handler.promise)
    })
    const responses = ['/h', '/c', '/m'].map(url => app.inject({ method: 'GET', url }))
    await until(() => work.running() === 3)

    hook.open()
    cb.open()
    handler.open(3)
    await within(Promise.all(responses), 'las respuestas')
    await expectBalanced(work)
  })

  it('desconexiones simultáneas: el trabajo sigue contado hasta terminar', async () => {
    const pending = gate()
    let entered = 0
    const { work, port } = await listening(a => a.get('/x', async () => { entered += 1; await pending.promise; return { ok: true } }))
    const clients = Array.from({ length: 10 }, () => connectClient(port, '/x'))
    await until(() => entered === 10)

    for (const client of clients) client.destroy()
    await tick(60)
    expect(work.running()).toBe(10)

    pending.open()
    await expectBalanced(work)
  })

  it('cierre con varias etapas activas y un rechazo durante el cierre: espera a todas y sale con 0', async () => {
    const handler = gate()
    const hook = gate()
    const failing = gate()
    let entered = 0
    const app = Fastify({ logger: false })
    apps.push(app)
    const work = trackRequestWork(app)
    app.get('/m', async () => { entered += 1; await handler.promise; return 1 })
    app.get('/h', { preHandler: async () => { entered += 1; await hook.promise } }, async () => 2)
    app.get('/r', async () => { entered += 1; await failing.promise })
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 3_000, drainMs: 1_500 })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    const clients = ['/m', '/h', '/r'].map(path => connectClient(port, path))
    await until(() => entered === 3)
    for (const client of clients) client.destroy()
    await until(() => work.running() === 3)

    signals.emit('SIGTERM')
    await tick(80)
    expect(exit).not.toHaveBeenCalled()
    failing.fail(new Error('rechazo durante el cierre'))
    await tick(40)
    expect(exit).not.toHaveBeenCalled()
    expect(work.running()).toBe(2)
    handler.open()
    hook.open()
    await until(() => exit.mock.calls.length > 0)

    expect(exit).toHaveBeenCalledWith(0)
    expect(work.running()).toBe(0)
  })
})
