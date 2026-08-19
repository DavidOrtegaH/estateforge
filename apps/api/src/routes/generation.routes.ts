import type { FastifyInstance } from 'fastify'
import type {
  GenerationRequest,
  AIProviderType,
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

    const result = await generateListing(body)

    return result
  })

  app.post(
    '/api/generations/from-property',
    async (request, reply) => {
      const body =
        request.body as {
          propertyId: string
          tone: string
          language: string
          provider: string
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

      const result =
        await generateListingForExistingProperty({
          propertyId: body.propertyId,
          tone: body.tone,
          language: body.language,
          provider:
            body.provider as AIProviderType,
        })

      return result
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