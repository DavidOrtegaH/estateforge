import type { FastifyInstance } from 'fastify'
import type { GenerationRequest, AIProviderType } from '@estateforge/shared'

import {
  generateListing,
  generateListingForExistingProperty,
} from '../services/generation.service.js'

import { prisma } from '../db/prisma.js'

export async function generationRoutes(
  app: FastifyInstance,
) {
  /*
   * Generar anuncio a partir de una petición completa
   */
  app.post('/api/generations', async (request) => {
    const body =
      request.body as GenerationRequest

    const result = await generateListing(body)

    return result
  })

  /*
   * Generar anuncio a partir de un inmueble existente
   */
  app.post(
    '/api/generations/from-property',
    async (request, reply) => {
      const body =
        request.body as {
          propertyId: string
          provider?: AIProviderType
          tone: string
          language: string
        }

      if (!body.propertyId) {
        return reply.code(400).send({
          message: 'propertyId is required',
        })
      }

      if (!body.tone) {
        return reply.code(400).send({
          message: 'tone is required',
        })
      }

      if (!body.language) {
        return reply.code(400).send({
          message: 'language is required',
        })
      }

      const result =
        await generateListingForExistingProperty({
          propertyId: body.propertyId,
          // Si body.provider es undefined, pasamos undefined explícitamente solo si el tipo lo permite,
          // o aseguramos el tipado correcto mediante un cast de objeto.
          ...(body.provider && { provider: body.provider }),
          tone: body.tone,
          language: body.language,
        } as Parameters<typeof generateListingForExistingProperty>[0])

      return result
    },
  )

  /*
   * Obtener todos los anuncios generados
   */
  app.get('/api/generations', async () => {
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
  })

  /*
   * Obtener un anuncio concreto
   */
  app.get(
    '/api/generations/:id',
    async (request, reply) => {
      const { id } =
        request.params as { id: string }

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

  /*
   * Editar un anuncio generado
   */
  app.put(
    '/api/generations/:id',
    async (request, reply) => {
      const { id } =
        request.params as { id: string }

      const body = request.body as {
        title?: string
        description?: string
        highlights?: string[] | string
        callToAction?: string
        provider?: AIProviderType
        tone?: string
        language?: string
      }

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

      let highlights: string | undefined

      if (body.highlights !== undefined) {
        if (Array.isArray(body.highlights)) {
          highlights = JSON.stringify(
            body.highlights,
          )
        } else {
          highlights = body.highlights
        }
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

            ...(highlights !== undefined && {
              highlights,
            }),

            ...(body.callToAction !==
              undefined && {
              callToAction: body.callToAction,
            }),

            ...(body.provider !== undefined && {
              provider: body.provider as AIProviderType,
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

  /*
   * Eliminar un anuncio generado
   */
  app.delete(
    '/api/generations/:id',
    async (request, reply) => {
      const { id } =
        request.params as { id: string }

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
}