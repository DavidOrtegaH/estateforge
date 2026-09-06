import { env } from './env.js'

import Fastify, {
  type FastifyError,
} from 'fastify'
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

  // ==========================================================
  // CORS
  // ==========================================================

  await app.register(cors, {
    origin: (origin, cb) => {
      const allowedOrigin =
        process.env.CORS_ORIGIN ??
        env.CORS_ORIGIN

      // Permite peticiones sin header Origin
      // o desde el origen configurado.
      if (
        !origin ||
        origin === allowedOrigin
      ) {
        cb(null, true)
        return
      }

      cb(null, false)
    },

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
  })

  // ==========================================================
  // RATE LIMITING
  // ==========================================================

  await app.register(rateLimit, {
    global: false,
    max: 5,
    timeWindow: '1 minute',
  })

  // ==========================================================
  // CABECERAS DE SEGURIDAD
  // ==========================================================

  app.addHook(
    'onSend',
    async (_request, reply) => {
      reply.header(
        'X-Content-Type-Options',
        'nosniff',
      )

      reply.header(
        'X-Frame-Options',
        'DENY',
      )

      reply.header(
        'Referrer-Policy',
        'strict-origin-when-cross-origin',
      )

      reply.header(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=()',
      )
    },
  )

  // ==========================================================
  // MANEJO CENTRALIZADO DE ERRORES
  // ==========================================================

  app.setErrorHandler(
    (
      error: FastifyError,
      _request,
      reply,
    ) => {
      const statusCode =
        typeof error.statusCode === 'number'
          ? error.statusCode
          : 500

      // Errores esperables del cliente.
      if (
        statusCode === 400 ||
        statusCode === 404 ||
        statusCode === 405 ||
        statusCode === 409 ||
        statusCode === 415 ||
        statusCode === 429
      ) {
        return reply
          .code(statusCode)
          .send({
            message: error.message,
          })
      }

      // Nunca exponemos detalles internos
      // del servidor, base de datos o proveedores.
      return reply
        .code(500)
        .send({
          message:
            'Error interno del servidor',
        })
    },
  )

  // ==========================================================
  // HEALTH CHECK
  // ==========================================================

  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'estateforge-api',
    }
  })

  // ==========================================================
  // ROUTES
  // ==========================================================

  await app.register(generationRoutes)
  await app.register(dashboardRoutes)
  await app.register(propertyRoutes)

  return app
}