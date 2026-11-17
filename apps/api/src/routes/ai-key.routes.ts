import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'

import { findProvider, simulatorEnabled } from '../ai-media/registry.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import {
  ConnectionError,
  CredentialCryptoError,
  deleteUserAIKey,
  getStoredAIKeyStatus,
  saveUserAIKey,
  type StoredAIKeyProvider,
} from '../services/user-ai-key.service.js'

// Cualquier proveedor del catálogo de la API (el simulador, solo en desarrollo). Estas rutas gestionan la
// conexión principal de cada proveedor; las conexiones con etiqueta van por /api/account/ai-connections.
const providerSchema = z
  .string()
  .max(24)
  .refine((provider): provider is StoredAIKeyProvider => Boolean(findProvider(provider)) && (provider !== 'simulador' || simulatorEnabled()))
const apiKeySchema = z
  .string()
  .trim()
  .min(1, 'La API key no puede estar vacía.')
  .max(512, 'La API key no puede superar los 512 caracteres.')

function providerFromParams(
  request: { params: unknown },
  reply: FastifyReply,
): StoredAIKeyProvider | null {
  const result = z.object({ provider: providerSchema }).safeParse(request.params)

  if (!result.success) {
    void reply.code(400).send({
      message: 'Proveedor de IA no válido.',
    })
    return null
  }

  return result.data.provider
}

export async function aiKeyRoutes(app: FastifyInstance) {
  app.get(
    '/api/account/ai-keys',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId

      if (!userId) {
        return reply.code(401).send({
          message: 'Se requiere una sesión activa.',
        })
      }

      return getStoredAIKeyStatus(userId)
    },
  )

  app.put(
    '/api/account/ai-keys/:provider',
    {
      preHandler: requireAuth,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId

      if (!userId) {
        return reply.code(401).send({
          message: 'Se requiere una sesión activa.',
        })
      }

      const provider = providerFromParams(request, reply)

      if (!provider) {
        return
      }

      const result = z
        .object({ apiKey: apiKeySchema })
        .strict()
        .safeParse(request.body)

      if (!result.success) {
        return reply.code(400).send({
          message: 'La API key proporcionada no es válida.',
        })
      }

      // Formato del proveedor (registro de la API): rechaza valores que no pueden ser una clave suya.
      const definition = findProvider(provider)
      if (definition && !definition.keyPattern.test(result.data.apiKey)) {
        return reply.code(400).send({
          message: `La API key no tiene el formato de ${definition.name}.`,
        })
      }

      try {
        await saveUserAIKey(
          userId,
          provider,
          result.data.apiKey,
        )
      } catch (error) {
        // Sin clave de cifrado válida no se guarda nada (nunca en texto plano).
        if (error instanceof CredentialCryptoError) {
          return reply.code(503).send({
            code: 'AI_ENCRYPTION_UNAVAILABLE',
            message: 'No se puede guardar la API key de forma segura en este momento.',
          })
        }
        if (error instanceof ConnectionError) {
          return reply.code(409).send({ code: error.code, message: error.message })
        }
        throw error
      }

      return {
        success: true,
        provider,
        configured: true,
      }
    },
  )

  app.delete(
    '/api/account/ai-keys/:provider',
    {
      preHandler: requireAuth,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId

      if (!userId) {
        return reply.code(401).send({
          message: 'Se requiere una sesión activa.',
        })
      }

      const provider = providerFromParams(request, reply)

      if (!provider) {
        return
      }

      await deleteUserAIKey(userId, provider)

      return {
        success: true,
        provider,
        configured: false,
      }
    },
  )
}
