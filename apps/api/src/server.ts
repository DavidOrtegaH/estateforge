import { buildApp } from './app.js'
import { prisma } from './db/prisma.js'
import { readinessRoutes } from './routes/readiness.routes.js'
import { readServerAddress } from './server-config.js'
import { registerGracefulShutdown } from './shutdown.js'

const start = async () => {
  const address = readServerAddress(process.env)
  const app = await buildApp()

  // Disponibilidad con PostgreSQL. Se registra aquí, no en buildApp, para no alterar app.ts.
  await app.register(readinessRoutes)

  // El pool se cierra con la aplicación, dentro del cierre ordenado.
  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })

  // Cierre ordenado: espera a los enlaces de recuperación que se envían en segundo plano (E2.6).
  registerGracefulShutdown(app)

  try {
    await app.listen(address)
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

// Un fallo de arranque termina con código 1 y un mensaje sin datos de conexión.
start().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'No se ha podido arrancar la API.',
  )
  process.exit(1)
})
