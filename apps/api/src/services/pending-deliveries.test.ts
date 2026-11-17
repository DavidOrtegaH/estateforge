import { afterEach, describe, expect, it, vi } from 'vitest'

import { countAllPendingDeliveries, createDeliveryTracker, DELIVERY_SHUTDOWN_TIMEOUT_MS, deliveryWaitBudgetMs, limitDeliveryWaitUntil } from './pending-deliveries.js'

// Corrección C de la Fase 1 (F0-005): espera de cierre uniforme, con plazo máximo, para los
// envíos en segundo plano. Plazos cortos y temporizadores reales: lo que se mide es el tiempo.

function deferred() {
  let resolve: () => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
process.on('unhandledRejection', onUnhandled)

afterEach(async () => {
  // Da tiempo a que Node notifique un rechazo sin gestionar, si lo hubiera.
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(unhandled).toEqual([])
})

describe('presupuesto del cierre y recuento global', () => {
  it('cuenta los envíos en curso de todos los seguimientos', async () => {
    const before = countAllPendingDeliveries()
    const first = createDeliveryTracker()
    const second = createDeliveryTracker()
    const a = deferred()
    const b = deferred()
    first.track(a.promise)
    second.track(b.promise)

    expect(countAllPendingDeliveries()).toBe(before + 2)
    a.resolve()
    b.resolve()
    await first.waitForAll(1_000)
    await second.waitForAll(1_000)
    expect(countAllPendingDeliveries()).toBe(before)
  })

  it('la espera nunca supera lo que le queda al plazo total y no reinicia el contador', () => {
    limitDeliveryWaitUntil(Date.now() + 200)
    expect(deliveryWaitBudgetMs(8_000)).toBeLessThanOrEqual(200)
    expect(deliveryWaitBudgetMs(50)).toBe(50)
    limitDeliveryWaitUntil(Date.now() - 10)
    expect(deliveryWaitBudgetMs(8_000)).toBe(0)
  })
})

describe('createDeliveryTracker', () => {
  it('el plazo por defecto es de 8 segundos, por debajo de los 10 s de gracia habituales de SIGTERM', () => {
    expect(DELIVERY_SHUTDOWN_TIMEOUT_MS).toBe(8_000)
  })

  it('sin envíos pendientes termina al momento', async () => {
    const tracker = createDeliveryTracker()
    const start = Date.now()

    await expect(tracker.waitForAll(1_000)).resolves.toEqual({ timedOut: false, pending: 0 })
    expect(Date.now() - start).toBeLessThan(50)
  })

  it('con un envío pendiente espera a que termine', async () => {
    const tracker = createDeliveryTracker()
    const delivery = deferred()
    tracker.track(delivery.promise)
    let done = false

    const waiting = tracker.waitForAll(1_000).then(result => { done = true; return result })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(done).toBe(false)
    expect(tracker.count()).toBe(1)

    delivery.resolve()
    await expect(waiting).resolves.toEqual({ timedOut: false, pending: 0 })
    expect(tracker.count()).toBe(0)
  })

  it('con varios envíos espera a todos', async () => {
    const tracker = createDeliveryTracker()
    const deliveries = [deferred(), deferred(), deferred()]
    for (const delivery of deliveries) tracker.track(delivery.promise)
    expect(tracker.count()).toBe(3)

    const waiting = tracker.waitForAll(1_000)
    deliveries[1].resolve()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(tracker.count()).toBe(2)
    deliveries[0].resolve()
    deliveries[2].resolve()

    await expect(waiting).resolves.toEqual({ timedOut: false, pending: 0 })
  })

  it('espera también a los envíos que se añaden mientras espera', async () => {
    const tracker = createDeliveryTracker()
    const first = deferred()
    const second = deferred()
    tracker.track(first.promise)

    const waiting = tracker.waitForAll(1_000)
    // Al terminar el primero se registra otro, antes de que la espera lo dé por acabado.
    tracker.track(second.promise)
    first.resolve()
    await new Promise(resolve => setTimeout(resolve, 20))
    let done = false
    void waiting.then(() => { done = true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(done).toBe(false)
    expect(tracker.count()).toBe(1)

    second.resolve()
    await expect(waiting).resolves.toEqual({ timedOut: false, pending: 0 })
  })

  it('un envío añadido después de que termine uno anterior, durante la espera, también se espera', async () => {
    const tracker = createDeliveryTracker()
    const first = deferred()
    const late = deferred()
    tracker.track(first.promise.then(() => { tracker.track(late.promise) }))

    const waiting = tracker.waitForAll(1_000)
    first.resolve()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(tracker.count()).toBe(1)

    late.resolve()
    await expect(waiting).resolves.toEqual({ timedOut: false, pending: 0 })
  })

  it('un envío que rechaza no bloquea la espera ni deja un rechazo sin gestionar', async () => {
    const tracker = createDeliveryTracker()
    const failing = deferred()
    const ok = deferred()
    tracker.track(failing.promise)
    tracker.track(ok.promise)

    const waiting = tracker.waitForAll(1_000)
    failing.reject(new Error('SMTP caído'))
    ok.resolve()

    await expect(waiting).resolves.toEqual({ timedOut: false, pending: 0 })
    expect(tracker.count()).toBe(0)
  })

  it('un envío que supera el plazo no bloquea: la espera termina dentro del plazo y lo cuenta como pendiente', async () => {
    const tracker = createDeliveryTracker()
    const stuck = deferred()
    const ok = deferred()
    tracker.track(stuck.promise)
    tracker.track(ok.promise)
    ok.resolve()
    const start = Date.now()

    const result = await tracker.waitForAll(100)
    const elapsed = Date.now() - start

    expect(result).toEqual({ timedOut: true, pending: 1 })
    expect(elapsed).toBeGreaterThanOrEqual(90)
    expect(elapsed).toBeLessThan(400)
    // El envío no se cancela: si termina después, sale del registro sin errores.
    stuck.resolve()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(tracker.count()).toBe(0)
  })

  it('con envíos que se encadenan sin fin, la espera termina igualmente en el plazo', async () => {
    const tracker = createDeliveryTracker()
    let stopped = false
    const chain = (): void => {
      if (stopped) return
      tracker.track(new Promise<void>(resolve => setTimeout(() => { resolve(); chain() }, 10)))
    }
    chain()
    const start = Date.now()

    const result = await tracker.waitForAll(100)
    stopped = true

    expect(result.timedOut).toBe(true)
    expect(Date.now() - start).toBeLessThan(400)
    await new Promise(resolve => setTimeout(resolve, 30))
  })

  it('fuera de Vercel (SDK real, sin contexto de petición) track no lanza, no espera y conserva el seguimiento local', async () => {
    const tracker = createDeliveryTracker()
    const failing = deferred()

    expect(tracker.track(failing.promise)).toBeUndefined()
    expect(tracker.count()).toBe(1)

    failing.reject(new Error('SMTP caído'))
    await expect(tracker.waitForAll(1_000)).resolves.toEqual({ timedOut: false, pending: 0 })
    expect(tracker.count()).toBe(0)
  })

  it('el temporizador del plazo se cancela cuando la espera termina antes', async () => {
    const tracker = createDeliveryTracker()
    const delivery = deferred()
    tracker.track(delivery.promise)
    const cleared = vi.spyOn(globalThis, 'clearTimeout')
    try {
      const waiting = tracker.waitForAll(60_000)
      delivery.resolve()
      const start = Date.now()

      await expect(waiting).resolves.toEqual({ timedOut: false, pending: 0 })
      expect(Date.now() - start).toBeLessThan(100)
      expect(cleared).toHaveBeenCalled()
    } finally {
      cleared.mockRestore()
    }
  })
})
