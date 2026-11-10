import { types } from 'node:util'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

// Seguimiento del trabajo de cada petición (Fase 1, cierre ordenado, M-1).
//
// El cierre de una respuesta HTTP no indica que la petición haya terminado. Si el cliente se
// desconecta, app.close() puede resolverse con el manejador todavía en marcha, y Fastify no llega a
// ejecutar onResponse para esa petición. Por eso se instrumentan las etapas que ejecutan código
// propio: los preHandler de ruta y el manejador.
//
// Contrato de una etapa:
// - Empieza al invocarse y termina cuando termina su trabajo, aunque el cliente se haya ido.
// - Si devuelve un thenable (el mismo criterio que Fastify: propiedad `then` invocable), termina
//   cuando este se resuelve o rechaza. `reply` también tiene `then`, pero es la respuesta: no cuenta.
//   Fastify recibe un objeto cuyo `then` delega en el original: no hay asimilación ni una segunda
//   invocación, y Fastify ve cada llamada del thenable igual que sin seguimiento.
//   La propiedad `then` no se lee para clasificar el resultado: un dato se toma de su descriptor, y un
//   accessor o un Proxy se dejan a las lecturas de Fastify, que atraviesan un Proxy delegado (N-3).
// - Si no devuelve un thenable y es un hook con `next`, termina al invocarse `next`.
// - Un hook que declara `next` y devuelve `reply` sin haberlo invocado sigue contado hasta `next` o hasta
//   que la respuesta se envíe entera; una desconexión no lo libera (N-4). Es un uso que Fastify no
//   documenta: combina dos señales de final, y el envoltorio no cambia lo que Fastify hace con ellas.
// - Si no, termina al devolver. Un manejador síncrono que responda más tarde con reply.send no se
//   puede seguir: el trabajo asíncrono de una petición debe devolverse como promesa.
// - Una excepción síncrona la termina. Cada etapa se libera una sola vez.
// - Una etapa que no termina sigue contada: no hay cancelación ni liberación artificial.
//
// El seguimiento debe instalarse antes de registrar las rutas. Solo envuelve funciones: cualquier
// otro valor llega intacto a Fastify, que lo valida como siempre. El envoltorio conserva el prototipo y
// la aridad de la etapa para que la validación de arranque de Fastify vea lo mismo que sin él (N-2). No
// conserva el nombre: `wrappedStage` es la marca con la que la guarda reconoce un hook instrumentado.
//
// Frontera del contrato: el seguimiento no puede descubrir el trabajo que no se devuelve ni se
// registra. Devolver `reply` tampoco comunica el final de una operación independiente: solo indica
// el final de la respuesta, y una desconexión lo adelanta. El trabajo independiente de la petición
// debe usar un seguimiento explícito; los envíos de correo tienen el suyo (pending-deliveries.ts) y
// no existe una cola genérica. El no registrado no está garantizado durante el cierre.
//
// Fuera del contrato: onRequest y, con él, CORS y rate-limit (N-1). Un `origin`, `keyGenerator`, `max`,
// `allowList` u otra opción diferida se ejecuta antes de la primera etapa instrumentada y no cuenta, de
// modo que el cierre no la espera. Por eso esas formas están prohibidas, no seguidas: la guarda de
// app.routes-coverage.test.ts inspecciona las opciones efectivas de buildApp.

// Hooks de ciclo de petición que se pueden declarar en una ruta. Solo se instrumenta preHandler,
// el único que usa el proyecto; el inventario permite detectar cualquier otro.
const ROUTE_HOOKS = [
  'onRequest', 'preParsing', 'preValidation', 'preHandler', 'preSerialization',
  'onSend', 'onResponse', 'onError', 'onTimeout', 'onRequestAbort',
] as const

export interface RouteInventoryEntry {
  method: string
  url: string
  // Si el manejador declarado es una función async.
  handlerIsAsync: boolean
  // Hooks declarados en la ruta cuando se registró.
  routeHooks: string[]
}

export interface RequestWorkTracker {
  /** Peticiones con código propio en ejecución. */
  running(): number
  /** Rutas registradas después de instalar el seguimiento. */
  routes(): readonly RouteInventoryEntry[]
}

type Stage = (this: unknown, ...args: unknown[]) => unknown

const trackers = new WeakMap<FastifyInstance, RequestWorkTracker>()

export function requestWorkOf(app: FastifyInstance): RequestWorkTracker | undefined {
  return trackers.get(app)
}

type Then = (this: unknown, ...args: unknown[]) => unknown
type ThenLookup = { kind: 'none' } | { kind: 'data'; value: unknown } | { kind: 'accessor' }

// Localiza `then` sin invocar ningún getter ni trampa. Un Proxy en la cadena cuenta como accessor.
function lookupThen(value: unknown): ThenLookup {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return { kind: 'none' }
  for (let holder = value as object | null; holder !== null; holder = Object.getPrototypeOf(holder) as object | null) {
    if (types.isProxy(holder)) return { kind: 'accessor' }
    const descriptor = Object.getOwnPropertyDescriptor(holder, 'then')
    if (descriptor) return 'value' in descriptor ? { kind: 'data', value: descriptor.value } : { kind: 'accessor' }
  }
  return { kind: 'none' }
}

export function trackRequestWork(app: FastifyInstance): RequestWorkTracker {
  // Profundidad por petición: pueden solaparse etapas si un hook invoca la siguiente desde dentro.
  const running = new Map<FastifyRequest, number>()
  const inventory: RouteInventoryEntry[] = []
  // Las rutas HEAD automáticas reutilizan las opciones ya envueltas de su GET.
  const originals = new WeakMap<Stage, Stage>()

  const enter = (request: FastifyRequest) => {
    running.set(request, (running.get(request) ?? 0) + 1)
  }

  const leave = (request: FastifyRequest) => {
    const depth = (running.get(request) ?? 1) - 1
    if (depth > 0) running.set(request, depth)
    else running.delete(request)
  }

  const wrap = (stage: Stage): Stage => {
    if (originals.has(stage)) return stage

    const wrapped: Stage = function wrappedStage(this: unknown, ...args: unknown[]) {
      const request = args[0] as FastifyRequest
      const reply = args[1] as FastifyReply
      let finished = false
      let returned = false
      let settlesWithResult = false
      let nextCalled = false

      const finish = () => {
        if (finished) return
        finished = true
        leave(request)
      }

      // Fastify pasa `next` como último argumento en los hooks; los manejadores solo reciben dos.
      const last = args.length - 1
      const next = last >= 2 && typeof args[last] === 'function'
        ? (args[last] as (this: unknown, ...nextArgs: unknown[]) => unknown)
        : undefined
      if (next) {
        args[last] = function trackedNext(this: unknown, ...nextArgs: unknown[]) {
          nextCalled = true
          if (returned && !settlesWithResult) finish()
          return next.apply(this, nextArgs)
        }
      }

      enter(request)
      let result: unknown
      try {
        result = stage.apply(this, args)
      } catch (error) {
        finish()
        throw error
      }
      returned = true

      const endUnlessNextPending = () => {
        if (!next || nextCalled) finish()
      }

      if (result === reply) {
        // Sin `next` declarado no hay otra señal: `reply` indica el final, como en un hook de dos parámetros.
        if (!next || nextCalled || stage.length < 3) finish()
        else if (reply.raw.writableFinished) finish()
        else reply.raw.once('finish', finish)
        return result
      }

      const settling = (callback: (value: unknown) => unknown) => (value: unknown) => {
        finish()
        return callback(value)
      }
      const delegateThen = (original: Then) =>
        function delegatedThen(onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) {
          try {
            return original.call(result, settling(onFulfilled), settling(onRejected))
          } catch (error) {
            finish()
            throw error
          }
        }

      const found = lookupThen(result)

      if (found.kind === 'accessor') {
        // Fastify hace aquí las mismas lecturas que sin seguimiento, en el mismo orden. La primera decide
        // si el resultado es un thenable; el Proxy es transparente para todo lo demás (cuerpo incluido).
        let phase: 'pending' | 'thenable' | 'value' = 'pending'
        return new Proxy(result as object, {
          get(target, key) {
            if (key !== 'then') return Reflect.get(target, key, target) as unknown
            let value: unknown
            try {
              value = Reflect.get(target, key, target)
            } catch (error) {
              finish()
              throw error
            }
            if (typeof value === 'function') {
              if (phase === 'value') return value
              phase = 'thenable'
              settlesWithResult = true
              return delegateThen(value as Then)
            }
            if (phase === 'pending') {
              phase = 'value'
              endUnlessNextPending()
            } else if (phase === 'thenable') {
              // Fastify intentará invocar un valor que no es una función y fallará igual que sin seguimiento.
              finish()
            }
            return value
          },
        })
      }

      if (found.kind === 'data' && typeof found.value === 'function') {
        settlesWithResult = true
        // Fastify la invoca una vez, justo al recibirla. Cada llamada del thenable se le reenvía.
        // oxlint-disable-next-line unicorn/no-thenable -- delega en el thenable original
        return { then: delegateThen(found.value as Then) }
      }

      endUnlessNextPending()
      return result
    }

    // Fastify valida los hooks por constructor.name y length al registrar la ruta (N-2).
    Object.setPrototypeOf(wrapped, Object.getPrototypeOf(stage))
    Object.defineProperty(wrapped, 'length', { value: stage.length, configurable: true })
    originals.set(wrapped, stage)
    return wrapped
  }

  // Un valor que no es una función llega intacto a Fastify, que lo rechaza al registrar la ruta.
  const wrapFunction = (value: unknown): unknown => (typeof value === 'function' ? wrap(value as Stage) : value)

  app.addHook('onRoute', route => {
    const handler = route.handler as unknown as Stage
    const declared = originals.get(handler) ?? handler
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    const routeHooks = ROUTE_HOOKS.filter(hook => route[hook] !== undefined)
    for (const method of methods) {
      inventory.push({
        method: String(method),
        url: route.url,
        handlerIsAsync: typeof declared === 'function' && declared.constructor.name === 'AsyncFunction',
        routeHooks: [...routeHooks],
      })
    }

    route.handler = wrapFunction(handler) as typeof route.handler
    const { preHandler } = route
    if (Array.isArray(preHandler)) {
      route.preHandler = preHandler.map(wrapFunction) as typeof route.preHandler
    } else if (preHandler) {
      route.preHandler = wrapFunction(preHandler) as typeof route.preHandler
    }
  })

  const tracker: RequestWorkTracker = {
    running: () => running.size,
    routes: () => inventory,
  }
  trackers.set(app, tracker)
  return tracker
}
