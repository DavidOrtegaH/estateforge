
import type {
  FastifyInstance,
  FastifyReply,
} from 'fastify'

import {
  BulkIdsSchema,
  GenerationRequestSchema,
  GenerationUpdateSchema,
  ExistingPropertyGenerationSchema,
  IdParamsSchema,
} from '@estateforge/shared'

import {
  generateListing,
  generateListingForExistingProperty,
} from '../services/generation.service.js'

import { prisma } from '../db/prisma.js'

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

export async function generationRoutes(
  app: FastifyInstance,
) {
  /**
   * ==========================================================
   * GENERAR ANUNCIO DESDE UNA PETICIÓN COMPLETA
   * ==========================================================
   */

app.post(
  '/api/generations',
  {
    config: {
      rateLimit: {
        max: 70,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodyResult =
      GenerationRequestSchema.safeParse(
        request.body,
      )

    if (!bodyResult.success) {
      return sendValidationError(
        reply,
        bodyResult.error,
      )
    }

    const result = await generateListing(
      bodyResult.data,
    )

    return result
  },
)

  /**
   * ==========================================================
   * GENERAR ANUNCIO DESDE INMUEBLE EXISTENTE
   * ==========================================================
   */

app.post(
  '/api/generations/from-property',
  {
    config: {
      rateLimit: {
        max: 70,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodyResult =
      ExistingPropertyGenerationSchema.safeParse(
        request.body,
      )

    if (!bodyResult.success) {
      return sendValidationError(
        reply,
        bodyResult.error,
      )
    }

    const result =
      await generateListingForExistingProperty(
        bodyResult.data,
      )

    return result
  },
)

  /**
   * ==========================================================
   * LISTAR GENERACIONES
   * ==========================================================
   */

  app.get(
    '/api/generations',
    async () => {
      const generations =
        await prisma.generation.findMany({
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            property: true,
          },
        })

      return generations
    },
  )

  /**
   * ==========================================================
   * OBTENER GENERACIÓN
   * ==========================================================
   */

  app.get(
    '/api/generations/:id',
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

      const generation =
        await prisma.generation.findUnique({
          where: {
            id,
          },
          include: {
            property: true,
          },
        })

      if (!generation) {
        return reply.code(404).send({
          message: 'Generation not found',
        })
      }

      return generation
    },
  )

  /**
   * ==========================================================
   * EDITAR GENERACIÓN
   * ==========================================================
   */

  app.put(
    '/api/generations/:id',
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
        GenerationUpdateSchema.safeParse(
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

      const existingGeneration =
        await prisma.generation.findUnique({
          where: {
            id,
          },
        })

      if (!existingGeneration) {
        return reply.code(404).send({
          message: 'Generation not found',
        })
      }

      const generation =
        await prisma.generation.update({
          where: {
            id,
          },
          data: {
            ...(body.title !== undefined && {
              title: body.title,
            }),

            ...(body.description !==
              undefined && {
              description: body.description,
            }),

            ...(body.highlights !== undefined && {
              highlights: JSON.stringify(
                body.highlights,
              ),
            }),

            ...(body.callToAction !==
              undefined && {
              callToAction: body.callToAction,
            }),

            ...(body.provider !== undefined && {
              provider: body.provider,
            }),

            ...(body.tone !== undefined && {
              tone: body.tone,
            }),

            ...(body.language !== undefined && {
              language: body.language,
            }),
          },
          include: {
            property: true,
          },
        })

      return generation
    },
  )

  /**
   * ==========================================================
   * ELIMINAR UNA GENERACIÓN
   * ==========================================================
   */

  app.delete(
    '/api/generations/:id',
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

      const existingGeneration =
        await prisma.generation.findUnique({
          where: {
            id,
          },
        })

      if (!existingGeneration) {
        return reply.code(404).send({
          message: 'Generation not found',
        })
      }

      await prisma.generation.delete({
        where: {
          id,
        },
      })

      return {
        success: true,
      }
    },
  )

  /**
   * ==========================================================
   * ELIMINAR VARIAS GENERACIONES
   * ==========================================================
   */

  app.delete(
    '/api/generations',
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
        await prisma.generation.deleteMany({
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
}
