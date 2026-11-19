import type {
  FastifyInstance,
  FastifyReply,
} from 'fastify'

import { prisma } from '../db/prisma.js'
import { drainStorageCleanup } from '../media/storage-cleanup.js'

import {
  BulkIdsSchema,
  IdParamsSchema,
  PropertyUpdateSchema,
} from '@estateforge/shared'

import {
  requireAuth,
} from '../middleware/auth.middleware.js'

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

  app.get(
    '/api/properties',
    {
      preHandler: requireAuth,
    },
    async (request) => {
      const properties =
        await prisma.property.findMany({
          where: {
            userId: request.userId,
          },
          include: {
            generations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })

      return properties
    },
  )

  /**
   * ==========================================================
   * OBTENER INMUEBLE
   * ==========================================================
   */

  app.get(
    '/api/properties/:id',
    {
      preHandler: requireAuth,
    },
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
        await prisma.property.findFirst({
          where: {
            id,
            userId: request.userId,
          },
          include: {
            generations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
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
    {
      preHandler: requireAuth,
    },
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
        await prisma.property.findFirst({
          where: {
            id,
            userId: request.userId,
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
            generations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
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
    {
      preHandler: requireAuth,
    },
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
            userId: request.userId,
          },
        })

      // Los archivos de sus fotografías y su material quedan en la cola de limpieza (trigger); se borran
      // ahora y, si falla, quedan pendientes (DA-46). Nunca lanza.
      await drainStorageCleanup(request.log, undefined, 200)

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
    {
      preHandler: requireAuth,
    },
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
        await prisma.property.findFirst({
          where: {
            id,
            userId: request.userId,
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

      // Los archivos de sus fotografías y su material quedan en la cola de limpieza (trigger); se borran
      // ahora y, si falla, quedan pendientes (DA-46). Nunca lanza.
      await drainStorageCleanup(request.log, undefined, 200)

      return {
        success: true,
      }
    },
  )
}