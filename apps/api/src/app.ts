import { env } from './env.js'

import Fastify, {
  type FastifyError,
} from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import {
  isAIProviderError,
} from './ai/ai-provider.error.js'

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
      // --------------------------------------------------------
      // Errores controlados de proveedores de IA
      // --------------------------------------------------------

      if (
        isAIProviderError(error)
      ) {
        switch (error.code) {
          case 'AI_QUOTA_EXCEEDED':
            return reply
              .code(429)
              .send({
                code:
                  'AI_QUOTA_EXCEEDED',
                message:
                  'Se ha agotado la cuota disponible del proveedor de IA.',
              })

          case 'AI_INVALID_API_KEY':
            return reply
              .code(401)
              .send({
                code:
                  'AI_INVALID_API_KEY',
                message:
                  'La API key proporcionada no es válida.',
              })

          case 'AI_TIMEOUT':
            return reply
              .code(504)
              .send({
                code:
                  'AI_TIMEOUT',
                message:
                  'La generación ha superado el tiempo límite de 15 segundos.',
              })

          case 'AI_PROVIDER_ERROR':
          default:
            return reply
              .code(502)
              .send({
                code:
                  'AI_PROVIDER_ERROR',
                message:
                  'El proveedor de IA no está disponible en este momento.',
              })
        }
      }

      // --------------------------------------------------------
      // Errores esperables del cliente
      // --------------------------------------------------------

      const statusCode =
        typeof error.statusCode === 'number'
          ? error.statusCode
          : 500

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
            message:
              error.message,
          })
      }

      // --------------------------------------------------------
      // Errores internos
      // --------------------------------------------------------
      //
      // Nunca exponemos detalles internos
      // del servidor, base de datos o proveedores.
      //

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