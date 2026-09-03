import './env.js'

import Fastify from 'fastify'
import cors from '@fastify/cors'

import { generationRoutes } from './routes/generation.routes.js'
import { propertyRoutes } from './routes/property.routes.js'
import { dashboardRoutes } from './routes/dashboard.routes.js'

export async function buildApp() {
  const app = Fastify({
    logger: false,
  })

  await app.register(cors, {
    origin: 'http://localhost:5173',
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
  })

  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'estateforge-api',
    }
  })

  await app.register(generationRoutes)
  await app.register(dashboardRoutes)
  await app.register(propertyRoutes)

  return app
}