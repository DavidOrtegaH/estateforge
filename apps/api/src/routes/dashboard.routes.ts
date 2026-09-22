import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'

import {
  requireAuth,
} from '../middleware/auth.middleware.js'

export async function dashboardRoutes(
  app: FastifyInstance,
) {
  app.get(
    '/api/dashboard/stats',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const userId = request.userId

      if (!userId) {
        return reply.code(401).send({
          message:
            'Se requiere una sesión activa.',
        })
      }

      const [properties, generations] =
        await Promise.all([
          prisma.property.count({
            where: {
              userId,
            },
          }),

          prisma.generation.count({
            where: {
              property: {
                userId,
              },
            },
          }),
        ])

      return {
        properties,
        generations,
      }
    },
  )
}