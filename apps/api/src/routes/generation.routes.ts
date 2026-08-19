import type { FastifyInstance } from 'fastify'
import type {
  AIProviderType,
  GenerationRequest,
} from '@estateforge/shared'

import {
  generateListing,
  generateListingForExistingProperty,
} from '../services/generation.service.js'

import { prisma } from '../db/prisma.js'

export async function generationRoutes(
  app: FastifyInstance,
) {
  app.post('/api/generations', async (request, reply) => {
    const body =
      request.body as GenerationRequest

    if (!body.property) {
      return reply.code(400).send({
        message: 'property is required',
      })
    }

    if (!body.provider) {
      return reply.code(400).send({
        message: 'provider is required',
      })
    }

    if (
      body.provider !== 'mock' &&
      body.provider !== 'gemini'
    ) {
      return reply.code(400).send({
        message:
          'provider must be mock or gemini',
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

    try {
      const result =
        await generateListing(body)

      return result
    } catch (error) {
      request.log.error(error)

      return reply.code(500).send({
        message:
          error instanceof Error
            ? error.message
            : 'Error generating listing',
      })
    }
  })

  app.post(
    '/api/generations/from-property',
    async (request, reply) => {
      const body =
        request.body as {
          propertyId: string
          tone: string
          language: string
          provider: AIProviderType
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

      if (!body.provider) {
        return reply.code(400).send({
          message: 'provider is required',
        })
      }

      if (
        body.provider !== 'mock' &&
        body.provider !== 'gemini'
      ) {
        return reply.code(400).send({
          message:
            'provider must be mock or gemini',
        })
      }

      try {
        const result =
          await generateListingForExistingProperty(
            body,
          )

        return result
      } catch (error) {
        request.log.error(error)

        if (
          error instanceof Error &&
          error.message ===
            'Property not found'
        ) {
          return reply.code(404).send({
            message: 'Property not found',
          })
        }

        return reply.code(500).send({
          message:
            error instanceof Error
              ? error.message
              : 'Error generating listing',
        })
      }
    },
  )

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
}