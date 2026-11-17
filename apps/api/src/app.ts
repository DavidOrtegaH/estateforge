

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
import { mediaRoutes } from './routes/media.routes.js'
import { aiMediaRoutes } from './routes/ai-media.routes.js'

import { trackRequestWork } from './request-work.js'
import { keepsRouteCacheControl } from './cache-control.js'
import { configureClientIp, requestClientIp } from './client-ip.js'
import { storageDriverOf } from './storage/object-storage.js'
import {
  DATABASE_UNAVAILABLE_BODY,
  DATABASE_UNAVAILABLE_RETRY_AFTER_S,
  DATABASE_UNAVAILABLE_STATUS,
  databaseUnavailableKind,
} from './db/availability.js'
import { safeErrorFields } from './services/log-safety.js'

export async function buildApp() {
  const app = Fastify({
    // Solo avisos y errores (Fase 1, revisión): sin esto, request.log y app.log no escriben nada
    // y los fallos de envío se perderían. No se baja a «info», que registraría la URL de cada
    // petición, y alguna lleva un token (/api/auth/security-incident/:token).
    logger: { level: 'warn' },
    bodyLimit: 1_048_576,
  })

  // Antes de registrar ninguna ruta: el cierre ordenado necesita saber qué trabajo sigue en marcha.
  trackRequestWork(app)

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
  // IP del cliente (MD-4): la del socket salvo CLIENT_IP_SOURCE=vercel dentro de Vercel (client-ip.ts).
  configureClientIp(process.env)
  // Almacenamiento (DA-58): una configuración incompleta o insegura impide arrancar.
  storageDriverOf(process.env)
  await app.register(rateLimit, {
    global: false,
    max: 20,
    timeWindow: '1 minute',
    keyGenerator: requestClientIp,
  })

  // ==========================================================
  // CABECERAS DE SEGURIDAD
  // ==========================================================

  // Síncrono a propósito: Fastify ya ha terminado la etapa del manejador y este hook no se contabiliza
  // como trabajo en el cierre. app.routes-coverage.test.ts falla si deja de limitarse a poner cabeceras.
  app.addHook(
    'onSend',
    (_request, reply, _payload, done) => {
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

      // La API no es contenido indexable: ni sus respuestas JSON ni los archivos que sirve.
      reply.header(
        'X-Robots-Tag',
        'noindex, nofollow',
      )

      // Caché (cache-control.ts): no-store salvo que la ruta ya haya fijado una política privada.
      if (!keepsRouteCacheControl(reply.getHeader('Cache-Control'))) {
        reply.header(
          'Cache-Control',
          'no-store',
        )
      }

      done()
    },
  )

  // ==========================================================
  // MANEJO CENTRALIZADO DE ERRORES
  // ==========================================================

  app.setErrorHandler(
    (
      error: FastifyError,
      request,
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
                  'Tu cuenta del proveedor de IA no tiene cuota disponible. Revisa tu plan en el proveedor.',
              })

          case 'AI_RATE_LIMITED':
            return reply
              .code(429)
              .send({
                code: 'AI_RATE_LIMITED',
                message: error.message,
              })

          case 'AI_INVALID_API_KEY':
            return reply
              .code(401)
              .send({
                code:
                  'AI_INVALID_API_KEY',
                message:
                  'El proveedor ha rechazado tu API key. Revísala o sustitúyela en Ajustes.',
              })

          case 'AI_PERMISSION_DENIED':
            return reply
              .code(422)
              .send({
                code: 'AI_PERMISSION_DENIED',
                message: error.message,
              })

          // BYOK (DA-77): sin la clave del propio usuario no hay llamada externa ni alternativa.
          case 'AI_KEY_REQUIRED':
          case 'AI_KEY_UNREADABLE':
          case 'AI_MODEL_NOT_ALLOWED':
            return reply
              .code(error.code === 'AI_MODEL_NOT_ALLOWED' ? 400 : 409)
              .send({
                code: error.code,
                message: error.message,
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
      // Base de datos no disponible (DA-37)
      // --------------------------------------------------------
      //
      // Pool agotado, límite de conexiones, servidor caído o
      // reiniciándose: la petición es válida y se puede repetir.
      // Solo campos cerrados en el log: el mensaje de Prisma o de
      // pg puede incluir el host, el SQL o la fila rechazada.
      //

      const unavailable =
        databaseUnavailableKind(error)

      if (unavailable) {
        request.log.warn(
          {
            dbUnavailable: unavailable,
            ...safeErrorFields(error),
          },
          'Base de datos no disponible',
        )

        return reply
          .code(DATABASE_UNAVAILABLE_STATUS)
          .header(
            'Retry-After',
            String(DATABASE_UNAVAILABLE_RETRY_AFTER_S),
          )
          .send(DATABASE_UNAVAILABLE_BODY)
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
        statusCode === 413 ||
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
  // Galería de fotografías y material publicitario (DA-46, DA-47): plugin encapsulado con
  // sus propios parsers binarios y límites de tamaño.
  await app.register(mediaRoutes)
  await app.register(aiMediaRoutes)

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
