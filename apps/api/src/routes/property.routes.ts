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

  app.get('/api/properties/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const property = await prisma.property.findUnique({
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
  })

  app.put('/api/properties/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const body = request.body as {
      operation?: string
      type?: string
      price?: number
      address?: string
      city?: string
      neighborhood?: string
      area?: number
      bedrooms?: number
      bathrooms?: number
      floor?: number | null
      condition?: string
      elevator?: boolean
      terrace?: boolean
      balcony?: boolean
      garage?: boolean
      pool?: boolean
      garden?: boolean
      airConditioning?: boolean
      heating?: boolean
      additionalInformation?: string
    }

    const existingProperty =
      await prisma.property.findUnique({
        where: {
          id,
        },
      })

    if (!existingProperty) {
      return reply.code(404).send({
        message: 'Property not found',
      })
    }

    const property = await prisma.property.update({
      where: {
        id,
      },
      data: {
        ...(body.operation !== undefined && {
          operation: body.operation,
        }),

        ...(body.type !== undefined && {
          type: body.type,
        }),

        ...(body.price !== undefined && {
          price: body.price,
        }),

        ...(body.address !== undefined && {
          address: body.address,
        }),

        ...(body.city !== undefined && {
          city: body.city,
        }),

        ...(body.neighborhood !== undefined && {
          neighborhood: body.neighborhood,
        }),

        ...(body.area !== undefined && {
          area: body.area,
        }),

        ...(body.bedrooms !== undefined && {
          bedrooms: body.bedrooms,
        }),

        ...(body.bathrooms !== undefined && {
          bathrooms: body.bathrooms,
        }),

        ...(body.floor !== undefined && {
          floor: body.floor,
        }),

        ...(body.condition !== undefined && {
          condition: body.condition,
        }),

        ...(body.elevator !== undefined && {
          elevator: body.elevator,
        }),

        ...(body.terrace !== undefined && {
          terrace: body.terrace,
        }),

        ...(body.balcony !== undefined && {
          balcony: body.balcony,
        }),

        ...(body.garage !== undefined && {
          garage: body.garage,
        }),

        ...(body.pool !== undefined && {
          pool: body.pool,
        }),

        ...(body.garden !== undefined && {
          garden: body.garden,
        }),

        ...(body.airConditioning !== undefined && {
          airConditioning: body.airConditioning,
        }),

        ...(body.heating !== undefined && {
          heating: body.heating,
        }),

        ...(body.additionalInformation !== undefined && {
          additionalInformation:
            body.additionalInformation,
        }),
      },
      include: {
        generations: true,
      },
    })

    return property
  })

  app.delete(
    '/api/properties/:id',
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const existingProperty =
        await prisma.property.findUnique({
          where: {
            id,
          },
        })

      if (!existingProperty) {
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
      }
    },
  )
}