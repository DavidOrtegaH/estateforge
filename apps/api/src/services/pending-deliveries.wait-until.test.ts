import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Contexto de Vercel simulado: se sustituye la exportación pública `waitUntil` de @vercel/functions,
// que es lo único que usa pending-deliveries.ts. No se tocan símbolos internos del SDK.
const sdk = vi.hoisted(() => ({ waitUntil: vi.fn<(promise: Promise<unknown>) => void>() }))
vi.mock('@vercel/functions', () => ({ waitUntil: sdk.waitUntil }))

import { createDeliveryTracker } from './pending-deliveries.js'

function deferred() {
  let resolve: () => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
process.on('unhandledRejection', onUnhandled)

beforeEach(() => {
  sdk.waitUntil.mockReset()
})

afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(unhandled).toEqual([])
})

const settledState = async (promise: Promise<unknown>) => {
  let state: 'pending' | 'fulfilled' | 'rejected' = 'pending'
  void promise.then(() => { state = 'fulfilled' }, () => { state = 'rejected' })
  await new Promise(resolve => setTimeout(resolve, 5))
  return state
}

describe('createDeliveryTracker con contexto de Vercel (waitUntil)', () => {
  it('registra cada envío en waitUntil de forma síncrona, sin que track espere al envío', async () => {
    const tracker = createDeliveryTracker()
    const delivery = deferred()

    const returned = tracker.track(delivery.promise)

    // La respuesta HTTP puede enviarse ya: track no devuelve nada que esperar.
    expect(returned).toBeUndefined()
    expect(sdk.waitUntil).toHaveBeenCalledTimes(1)
    const registered = sdk.waitUntil.mock.calls[0][0]
    expect(await settledState(registered)).toBe('pending')
    expect(tracker.count()).toBe(1)

    delivery.resolve()
    expect(await settledState(registered)).toBe('fulfilled')
    expect(tracker.count()).toBe(0)
  })

  it('entrega la promesa protegida: un fallo SMTP no llega como rechazo al runtime', async () => {
    const tracker = createDeliveryTracker()
    const delivery = deferred()
    tracker.track(delivery.promise)
    const registered = sdk.waitUntil.mock.calls[0][0]

    expect(registered).not.toBe(delivery.promise)
    delivery.reject(new Error('SMTP caído'))

    expect(await settledState(registered)).toBe('fulfilled')
    expect(tracker.count()).toBe(0)
  })

  it('la promesa registrada termina después de salir del seguimiento local (cierre local intacto)', async () => {
    const tracker = createDeliveryTracker()
    const delivery = deferred()
    tracker.track(delivery.promise)
    const registered = sdk.waitUntil.mock.calls[0][0]

    const waiting = tracker.waitForAll(1_000)
    delivery.resolve()
    await registered
    expect(tracker.count()).toBe(0)
    await expect(waiting).resolves.toEqual({ timedOut: false, pending: 0 })
  })

  it('cada envío se registra por separado', () => {
    const tracker = createDeliveryTracker()
    const a = deferred()
    const b = deferred()
    tracker.track(a.promise)
    tracker.track(b.promise)

    expect(sdk.waitUntil).toHaveBeenCalledTimes(2)
    expect(sdk.waitUntil.mock.calls[0][0]).not.toBe(sdk.waitUntil.mock.calls[1][0])
    a.resolve()
    b.resolve()
  })

  it('si waitUntil lanza, track no lanza y el envío sigue en el seguimiento local', async () => {
    sdk.waitUntil.mockImplementation(() => { throw new TypeError('contexto no válido') })
    const tracker = createDeliveryTracker()
    const delivery = deferred()

    expect(() => tracker.track(delivery.promise)).not.toThrow()
    expect(tracker.count()).toBe(1)

    delivery.resolve()
    await expect(tracker.waitForAll(1_000)).resolves.toEqual({ timedOut: false, pending: 0 })
  })
})
