// Seguimiento de los envíos de correo en segundo plano (Fase 1, corrección C, F0-005).
//
// La verificación del email, el restablecimiento de contraseña y la recuperación obligatoria (E2)
// envían algunos correos sin que la respuesta HTTP los espere. Cada servicio registra aquí sus
// envíos, y el cierre ordenado de la API (hook onClose de authRoutes) espera a que terminen, con un
// plazo máximo común.
//
// En Vercel no hay cierre ordenado: la función puede congelarse en cuanto se envía la respuesta.
// Por eso cada envío registrado se entrega también a `waitUntil` del SDK oficial
// (@vercel/functions), que prolonga la vida de la invocación hasta que termine, sin que la
// respuesta HTTP lo espere (anti-enumeración). Fuera de Vercel no hay contexto de petición y
// `waitUntil` no hace nada: solo queda el seguimiento local de siempre.

import { waitUntil } from '@vercel/functions'
// Plazo máximo de espera al cerrar. Un envío SMTP normal tarda pocos segundos, pero los tiempos de
// espera por defecto de nodemailer son mucho mayores (2 minutos para conectar y 10 de inactividad
// del socket), así que sin un plazo el cierre podría alargarse minutos. Se elige por debajo de los
// 10 segundos que suelen conceder los orquestadores entre SIGTERM y SIGKILL (por ejemplo, Docker).
// Si se agota, el cierre continúa: los envíos que sigan en curso se pierden si el proceso termina,
// igual que ante una caída, y el titular puede pedir otro enlace.
export const DELIVERY_SHUTDOWN_TIMEOUT_MS = 8_000

export interface DeliveryWaitResult {
  // true si se agotó el plazo con envíos todavía en curso.
  timedOut: boolean
  // Envíos que seguían en curso al terminar la espera (0 si no se agotó el plazo).
  pending: number
}

export interface DeliveryTracker {
  /** Registra un envío ya iniciado. Su resultado o su error no se propagan: los gestiona el servicio. */
  track(delivery: Promise<unknown>): void
  /** Envíos en curso. */
  count(): number
  /**
   * Espera a los envíos en curso y a los que se registren mientras espera, como mucho `timeoutMs`.
   * Nunca rechaza y no deja temporizadores activos al terminar.
   */
  waitForAll(timeoutMs?: number): Promise<DeliveryWaitResult>
}

const trackers = new Set<DeliveryTracker>()

/** Envíos en curso de todos los servicios, para informar antes de una salida forzada. */
export function countAllPendingDeliveries(): number {
  let total = 0
  for (const tracker of trackers) total += tracker.count()
  return total
}

let deliveryWaitLimitAt: number | null = null

/** Fija el instante en el que debe terminar la espera de envíos: la del plazo total del cierre. */
export function limitDeliveryWaitUntil(at: number): void {
  deliveryWaitLimitAt = at
}

/** Tiempo de espera disponible: nunca más de `maxMs` ni más de lo que le queda al cierre. */
export function deliveryWaitBudgetMs(maxMs: number): number {
  return deliveryWaitLimitAt === null ? maxMs : Math.min(maxMs, Math.max(0, deliveryWaitLimitAt - Date.now()))
}

// Se entrega la promesa protegida (nunca rechaza), no la original: un fallo SMTP no puede llegar al
// runtime como rechazo sin gestionar. Si `waitUntil` fallara, el envío sigue en el seguimiento local
// y `track` no lanza: la respuesta HTTP no puede depender de esto.
function extendInvocationLifetime(tracked: Promise<void>): void {
  try {
    waitUntil(tracked)
  } catch {
    // Sin contexto útil: se mantiene solo el seguimiento local.
  }
}

export function createDeliveryTracker(): DeliveryTracker {
  const pending = new Set<Promise<void>>()

  const tracker: DeliveryTracker = {
    track(delivery) {
      // Ni el resultado ni un rechazo llegan a quien espera; el servicio ya lo ha registrado.
      const tracked: Promise<void> = delivery
        .then(() => undefined, () => undefined)
        .finally(() => {
          pending.delete(tracked)
        })
      pending.add(tracked)
      extendInvocationLifetime(tracked)
    },

    count() {
      return pending.size
    },

    async waitForAll(timeoutMs = DELIVERY_SHUTDOWN_TIMEOUT_MS) {
      if (pending.size === 0) return { timedOut: false, pending: 0 }
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<'timeout'>(resolve => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs)
      })
      try {
        // Un envío puede terminar y dejar otro registrado mientras se espera: se repite hasta vaciar.
        while (pending.size > 0) {
          const outcome = await Promise.race([
            Promise.allSettled(pending).then(() => 'settled' as const),
            deadline,
          ])
          if (outcome === 'timeout') return { timedOut: true, pending: pending.size }
        }
        return { timedOut: false, pending: 0 }
      } finally {
        clearTimeout(timer)
      }
    },
  }

  trackers.add(tracker)
  return tracker
}
