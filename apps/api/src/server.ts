import Fastify from 'fastify'
import cors from '@fastify/cors'
import { generationRoutes } from './routes/generation.routes.js'
import { propertyRoutes } from './routes/property.routes.js'

const app = Fastify({
  logger: true,
})

await app.register(cors, {
  origin: 'http://localhost:5173',
})

app.get('/health', async () => {
  return {
    status: 'ok',
    service: 'estateforge-api',
  }
})

await app.register(generationRoutes)
await app.register(propertyRoutes)

const start = async () => {
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