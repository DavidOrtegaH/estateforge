import type { FastifyInstance } from 'fastify'

type ShutdownSignal = 'SIGINT' | 'SIGTERM'

interface ShutdownOptions {
  // Emisor de las señales; process en producción, un emisor propio en las pruebas.
  target?: { on(signal: ShutdownSignal, listener: () => void): unknown }
  exit?: (code: number) => void
}

/**
 * Cierre ordenado ante SIGINT o SIGTERM (E2.6). La primera señal llama a app.close(), que deja
 * terminar las peticiones en curso y después ejecuta los hooks onClose; el de authRoutes
 * espera a los enlaces de recuperación que se envían en segundo plano. Al terminar sale con 0
 * (o con 1 si el cierre falla). Una segunda señal, sea cual sea, sale al momento con 1 sin
 * esperar al cierre. Solo se sale una vez.
 */
export function registerGracefulShutdown(app: FastifyInstance, options: ShutdownOptions = {}): void {
  const target = options.target ?? process
  const processExit = options.exit ?? ((code: number) => process.exit(code))
  let closing = false
  let exited = false

  const exit = (code: number) => {
    if (exited) return
    exited = true
    processExit(code)
  }

  const onSignal = () => {
    if (closing) {
      exit(1)
      return
    }
    closing = true
    app.close().then(
      () => exit(0),
      (error: unknown) => {
        app.log.error(error)
        exit(1)
      },
    )
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    target.on(signal, onSignal)
  }
}
