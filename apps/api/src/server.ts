import { buildApp } from './app.js'
import { closeDatabase } from './db/prisma.js'
import { maintenanceRoutes } from './routes/maintenance.routes.js'
import { readinessRoutes } from './routes/readiness.routes.js'
import { readServerAddress } from './server-config.js'
import { registerGracefulShutdown } from './shutdown.js'

const start = async () => {
  const address = readServerAddress(process.env)
  const app = await buildApp()

  // Disponibilidad con PostgreSQL. Se registra con el proceso, no en buildApp: las pruebas que
  // construyen la app no tienen base de datos.
  await app.register(readinessRoutes)

  // Limpieza diaria de la cola StorageCleanup (Vercel Cron), protegida con CRON_SECRET. Usa
  // PostgreSQL y el almacenamiento real, así que también se registra solo con el proceso.
  await app.register(maintenanceRoutes)

  // Cierre ordenado: espera a las peticiones, a su trabajo y a los envíos en segundo plano, y solo
  // después cierra el pool de PostgreSQL (DA-38).
  registerGracefulShutdown(app, { closeResources: closeDatabase })

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
