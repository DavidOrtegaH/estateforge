import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'

import { requireAuth } from '../middleware/auth.middleware.js'
import {
  deleteUserAIKey,
  getStoredAIKeyStatus,
  saveUserAIKey,
  type StoredAIKeyProvider,
} from '../services/user-ai-key.service.js'

const providerSchema = z.enum(['gemini', 'openai'])
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
      message: 'Proveedor de IA no válido. Usa gemini u openai.',
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

      await saveUserAIKey(
        userId,
        provider,
        result.data.apiKey,
      )

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
