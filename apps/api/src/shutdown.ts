import type { ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

import type { FastifyInstance } from 'fastify'

import { requestWorkOf } from './request-work.js'
import { safeErrorFields } from './services/log-safety.js'
import { countAllPendingDeliveries, limitDeliveryWaitUntil } from './services/pending-deliveries.js'

type ShutdownSignal = 'SIGINT' | 'SIGTERM'

// Plazo total del cierre, contado desde la primera señal y común a todas las etapas (F0-005). Por
// debajo de los 10 s habituales entre SIGTERM y SIGKILL.
export const SHUTDOWN_TIMEOUT_MS = 9_000

// Tiempo para que terminen las peticiones en curso. Después se cortan sus conexiones, para que
// server.close() termine y se ejecuten los hooks onClose dentro del plazo total (C-2).
export const SHUTDOWN_DRAIN_MS = 6_000

// Cada cuánto se cierran las conexiones sin ninguna petición activa. server.close() solo cierra las
// inactivas al llamarlo, y closeIdleConnections() no cierra las que aún no han enviado ninguna
// petición (V-1). Sin esto, una conexión keep-alive o una abierta sin petición retrasan el cierre.
const IDLE_CONNECTION_REAP_MS = 100

// Parte final del plazo total reservada para informar y salir. Toda espera acaba antes de ella: a
// los 8,5 s de la señal con los valores por defecto.
export const REPORT_RESERVE_MS = 500

// Cada cuánto se comprueba si ha terminado el trabajo que app.close() no espera.
const WORK_POLL_MS = 20

interface ShutdownOptions {
  // Emisor de las señales; process en producción, un emisor propio en las pruebas.
  target?: { on(signal: ShutdownSignal, listener: () => void): unknown }
  exit?: (code: number) => void
  // Plazos del cierre; las pruebas los acortan.
  timeoutMs?: number
  drainMs?: number
}

export interface ShutdownTracking {
  // Respuestas HTTP sin cerrar.
  activeRequests(): number
  // Conexiones TCP abiertas.
  openConnections(): number
  // Peticiones con código propio en ejecución; puede haberlas sin respuesta ni conexión abierta.
  activeWork(): number
}

/**
 * Cierre ordenado ante SIGINT o SIGTERM (E2.6, F0-005). La primera señal llama a app.close(), que
 * deja terminar las peticiones en curso y después ejecuta los hooks onClose; el de authRoutes
 * espera a los envíos en segundo plano.
 *
 * Debe registrarse antes de escuchar: distingue conexiones abiertas de peticiones activas siguiendo
 * cada socket y cada respuesta. Una petición sale del recuento al cerrarse su respuesta, que ocurre
 * una sola vez, tanto si termina como si el cliente corta. Solo cuenta como cortada la que sigue
 * activa al acabar el drenaje.
 *
 * app.close() solo espera a las respuestas: tras resolverse, se sigue esperando, dentro del plazo,
 * al trabajo de peticiones cuyo cliente ya se fue y a los envíos en curso.
 *
 * Sale con 0 solo si el cierre termina sin cortar peticiones y sin trabajo ni envíos en curso. Sale con 1 si
 * el cierre falla, queda incompleto o agota el plazo total, o ante una segunda señal, que sale al
 * momento. Antes de una salida forzada registra los envíos en curso: su resultado no está
 * confirmado. Solo se sale una vez.
 */
export function registerGracefulShutdown(app: FastifyInstance, options: ShutdownOptions = {}): ShutdownTracking {
  const target = options.target ?? process
  const processExit = options.exit ?? ((code: number) => process.exit(code))
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS
  const drainMs = options.drainMs ?? SHUTDOWN_DRAIN_MS
  let closing = false
  let exited = false
  let requestsCut = false
  let stopTimers = () => {}
  const activeWork = () => requestWorkOf(app)?.running() ?? 0

  // Conjuntos, no contadores: añadir o quitar dos veces no altera el recuento.
  const openSockets = new Set<Socket>()
  const activeResponses = new Map<ServerResponse, Socket>()

  app.server.on('connection', (socket: Socket) => {
    openSockets.add(socket)
    socket.once('close', () => openSockets.delete(socket))
  })
  app.server.on('request', (request, response: ServerResponse) => {
    activeResponses.set(response, request.socket)
    response.once('close', () => activeResponses.delete(response))
  })

  const exit = (code: number) => {
    if (exited) return
    exited = true
    stopTimers()
    processExit(code)
  }

  const pendingFields = () => {
    const pendingDeliveries = countAllPendingDeliveries()
    const activeRequests = activeResponses.size
    const work = activeWork()
    return pendingDeliveries > 0
      ? { activeRequests, activeWork: work, pendingDeliveries, deliveryState: 'unconfirmed' as const }
      : { activeRequests, activeWork: work, pendingDeliveries }
  }

  // Cierra las conexiones sin petición activa. Una conexión con una petición a medio recibir aún
  // no tiene respuesta y también se cierra: no es una petición en curso.
  const closeConnectionsWithoutRequest = () => {
    const busySockets = new Set(activeResponses.values())
    for (const socket of openSockets) {
      if (!busySockets.has(socket)) socket.destroy()
    }
  }

  const cutActiveRequests = () => {
    const activeRequests = activeResponses.size
    if (activeRequests > 0) {
      requestsCut = true
      app.log.warn({ activeRequests, drainMs }, 'Se cortan las peticiones que seguían en curso durante el cierre')
    }
    app.server.closeAllConnections()
  }

  const onSignal = () => {
    if (closing) {
      app.log.error({ reason: 'second_signal', ...pendingFields() }, 'Salida forzada: segunda señal durante el cierre')
      exit(1)
      return
    }
    closing = true
    const waitLimitAt = Date.now() + timeoutMs - Math.min(REPORT_RESERVE_MS, timeoutMs / 4)
    limitDeliveryWaitUntil(waitLimitAt)

    closeConnectionsWithoutRequest()
    const reaper = setInterval(closeConnectionsWithoutRequest, IDLE_CONNECTION_REAP_MS)
    const drain = setTimeout(cutActiveRequests, drainMs)
    const deadline = setTimeout(() => {
      app.log.error({ reason: 'timeout', timeoutMs, ...pendingFields() }, 'El cierre ordenado no terminó dentro del plazo')
      exit(1)
    }, timeoutMs)
    let workPoll: ReturnType<typeof setTimeout> | undefined
    stopTimers = () => {
      clearInterval(reaper)
      clearTimeout(drain)
      clearTimeout(deadline)
      clearTimeout(workPoll)
    }

    const finish = () => {
      const pending = pendingFields()
      if (pending.pendingDeliveries > 0 || pending.activeWork > 0 || requestsCut) {
        app.log.error({ reason: 'incomplete', requestsCut, ...pending }, 'Cierre incompleto')
        exit(1)
        return
      }
      exit(0)
    }

    const waitForRemainingWork = () => {
      const idle = activeWork() === 0 && countAllPendingDeliveries() === 0
      if (idle || Date.now() >= waitLimitAt) {
        finish()
        return
      }
      workPoll = setTimeout(waitForRemainingWork, WORK_POLL_MS)
    }

    app.close().then(
      waitForRemainingWork,
      (error: unknown) => {
        // Campos cerrados: el error de un hook de cierre no tiene un contenido controlado.
        app.log.error({ ...safeErrorFields(error), ...pendingFields() }, 'Falló el cierre ordenado')
        exit(1)
      },
    )
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    target.on(signal, onSignal)
  }

  return {
    activeRequests: () => activeResponses.size,
    openConnections: () => openSockets.size,
    activeWork,
  }
}
