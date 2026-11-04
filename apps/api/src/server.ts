import { buildApp } from './app.js'
import { registerGracefulShutdown } from './shutdown.js'

const start = async () => {
  const app = await buildApp()

  // Cierre ordenado: espera a los enlaces de recuperación que se envían en segundo plano (E2.6).
  registerGracefulShutdown(app)

  try {
    await app.listen({
      port: 3000,
      host: 'localhost',
    })
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

start()
