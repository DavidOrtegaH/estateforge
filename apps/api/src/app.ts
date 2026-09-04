import { env } from './env.js'

import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import { generationRoutes } from './routes/generation.routes.js'
import { propertyRoutes } from './routes/property.routes.js'
import { dashboardRoutes } from './routes/dashboard.routes.js'

export async function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
  })

  // Leemos el origen desde las variables de entorno para evitar valores hardcodeados
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
  })

  await app.register(rateLimit, {
    global: false,
    max: 5,
    timeWindow: '1 minute',
  })

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header(
      'Referrer-Policy',
      'strict-origin-when-cross-origin',
    )
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