import type {
  FastifyInstance,
  FastifyReply,
} from 'fastify'

import { prisma } from '../db/prisma.js'

import {
  BulkIdsSchema,
  IdParamsSchema,
  PropertyUpdateSchema,
} from '@estateforge/shared'

function sendValidationError(
  reply: FastifyReply,
  error: {
    issues: Array<{
      path: PropertyKey[]
      message: string
    }>
  },
) {
  return reply.code(400).send({
    message: 'Datos de entrada no válidos',
    errors: error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    })),
  })
}

export async function propertyRoutes(
  app: FastifyInstance,
) {
  /**
   * ==========================================================
   * LISTAR INMUEBLES
   * ==========================================================
   */

  app.get('/api/properties', async () => {
    const properties =
      await prisma.property.findMany({
        include: {
          generations: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

    return properties
  })

  /**
   * ==========================================================
   * OBTENER INMUEBLE
   * ==========================================================
   */

  app.get(
    '/api/properties/:id',
    async (request, reply) => {
      const paramsResult =
        IdParamsSchema.safeParse(request.params)

      if (!paramsResult.success) {
        return sendValidationError(
          reply,
          paramsResult.error,
        )
      }

      const { id } = paramsResult.data

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

  /**
   * ==========================================================
   * ACTUALIZAR INMUEBLE
   * ==========================================================
   */

  app.put(
    '/api/properties/:id',
    async (request, reply) => {
      const paramsResult =
        IdParamsSchema.safeParse(request.params)

      if (!paramsResult.success) {
        return sendValidationError(
          reply,
          paramsResult.error,
        )
      }

      const bodyResult =
        PropertyUpdateSchema.safeParse(
          request.body,
        )

      if (!bodyResult.success) {
        return sendValidationError(
          reply,
          bodyResult.error,
        )
      }

      const { id } = paramsResult.data
      const body = bodyResult.data

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

      const property =
        await prisma.property.update({
          where: {
            id,
          },
          data: body,
          include: {
            generations: true,
          },
        })

      return property
    },
  )

  /**
   * ==========================================================
   * ELIMINAR VARIOS INMUEBLES
   * ==========================================================
   */

  app.delete(
    '/api/properties',
    async (request, reply) => {
      const bodyResult =
        BulkIdsSchema.safeParse(request.body)

      if (!bodyResult.success) {
        return sendValidationError(
          reply,
          bodyResult.error,
        )
      }

      const { ids } = bodyResult.data

      const result =
        await prisma.property.deleteMany({
          where: {
            id: {
              in: ids,
            },
          },
        })

      return {
        success: true,
        deletedCount: result.count,
      }
    },
  )

  /**
   * ==========================================================
   * ELIMINAR UN INMUEBLE
   * ==========================================================
   */

  app.delete(
    '/api/properties/:id',
    async (request, reply) => {
      const paramsResult =
        IdParamsSchema.safeParse(request.params)

      if (!paramsResult.success) {
        return sendValidationError(
          reply,
          paramsResult.error,
        )
      }

      const { id } = paramsResult.data

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