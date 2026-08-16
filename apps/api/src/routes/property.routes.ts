import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'

export async function propertyRoutes(
  app: FastifyInstance,
) {
  app.get('/api/properties', async () => {
    const properties = await prisma.property.findMany({
      include: {
        generations: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return properties
  })

  app.get(
    '/api/properties/:id',
    async (request, reply) => {
      const { id } = request.params as {
        id: string
      }

      const property =
        await prisma.property.findUnique({
          where: {
            id,
          },
          include: {
            generations: true,
          },
        })

      if (!property) {
        return reply.code(404).send({
          message: 'Property not found',
        })
      }

      return property
    },
  )

  app.delete(
    '/api/properties/:id',
    async (request, reply) => {
      const { id } = request.params as {
        id: string
      }

      const property =
        await prisma.property.findUnique({
          where: {
            id,
          },
        })

      if (!property) {
        return reply.code(404).send({
          message: 'Property not found',
        })
      }

      await prisma.property.delete({
        where: {
          id,
        },
      })

      return {
        success: true,
        propertyId: id,
      }
    },
  )
}