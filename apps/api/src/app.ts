

import { env } from './env.js'

import Fastify, {
  type FastifyError,
} from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import {
  isAIProviderError,
} from './ai/ai-provider.error.js'

import { authRoutes } from './routes/auth.routes.js'
import { generationRoutes } from './routes/generation.routes.js'
import { propertyRoutes } from './routes/property.routes.js'
import { dashboardRoutes } from './routes/dashboard.routes.js'
import { aiKeyRoutes } from './routes/ai-key.routes.js'
import { adminRoutes } from './routes/admin.routes.js'

export async function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
  })

  app.decorateRequest(
    'userId',
    null,
  )

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

    // Necesario para que el navegador envíe y acepte
    // la cookie de sesión (estateforge_session) en
    // peticiones cross-origin.
    credentials: true,

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

  // El plugin debe registrarse antes que las rutas
  // que utilizan config.rateLimit.
  await app.register(rateLimit, {
    global: false,
    max: 20,
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
                  'La generación ha superado el límite de 40 segundos.',
              })

          case 'AI_PROVIDER_ERROR':
          default:
            console.error(
              '[EstateForge] Error del proveedor de IA:',
              {
                provider: error.provider,
                status: error.status,
                code: error.code,
                message: error.message,
              },
            )

            return reply
              .code(502)
              .send({
                code:
                  'AI_PROVIDER_ERROR',
                message:
                  error.message,
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
  // ROUTES
  // ==========================================================

  await app.register(authRoutes)
  await app.register(adminRoutes)
  await app.register(aiKeyRoutes)
  await app.register(generationRoutes)
  await app.register(dashboardRoutes)
  await app.register(propertyRoutes)

  // ==========================================================
  // HEALTH CHECK
  // ==========================================================

  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'estateforge-api',
    }
  })

  return app
}
