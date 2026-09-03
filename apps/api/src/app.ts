import './env.js'

import Fastify from 'fastify'
import cors from '@fastify/cors'

import { generationRoutes } from './routes/generation.routes.js'
import { propertyRoutes } from './routes/property.routes.js'
import { dashboardRoutes } from './routes/dashboard.routes.js'

export async function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
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

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    )
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