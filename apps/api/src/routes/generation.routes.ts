import type { FastifyInstance } from 'fastify'
import type {
  AIProviderType,
  GenerationRequest,
  ListingLanguage,
  ListingTone,
} from '@estateforge/shared'

import {
  generateListing,
  generateListingForExistingProperty,
} from '../services/generation.service.js'

import { prisma } from '../db/prisma.js'

const validProviders: AIProviderType[] = [
  'mock',
  'gemini',
  'openai',
]

const validTones: ListingTone[] = [
  'professional',
  'premium',
  'friendly',
]

const validLanguages: ListingLanguage[] = [
  'español',
  'english',
]

function isAIProviderType(
  value: unknown,
): value is AIProviderType {
  return (
    typeof value === 'string' &&
    validProviders.includes(
      value as AIProviderType,
    )
  )
}

function isListingTone(
  value: unknown,
): value is ListingTone {
  return (
    typeof value === 'string' &&
    validTones.includes(value as ListingTone)
  )
}

function isListingLanguage(
  value: unknown,
): value is ListingLanguage {
  return (
    typeof value === 'string' &&
    validLanguages.includes(
      value as ListingLanguage,
    )
  )
}

export async function generationRoutes(
  app: FastifyInstance,
) {
  app.post(
    '/api/generations',
    async (request, reply) => {
      const body =
        request.body as Partial<GenerationRequest>

      if (!body.property) {
        return reply.code(400).send({
          message: 'property is required',
        })
      }

      if (!isAIProviderType(body.provider)) {
        return reply.code(400).send({
          message:
            'provider must be mock, gemini or openai',
        })
      }

      if (!isListingTone(body.tone)) {
        return reply.code(400).send({
          message:
            'tone must be profesional, premium or amistoso',
        })
      }

      if (!isListingLanguage(body.language)) {
        return reply.code(400).send({
          message:
            'language must be español or english',
        })
      }

      const generationRequest: GenerationRequest = {
        property: body.property,
        provider: body.provider,
        tone: body.tone,
        language: body.language,
      }

      const result =
        await generateListing(
          generationRequest,
        )

      return result
    },
  )

  app.post(
    '/api/generations/from-property',
    async (request, reply) => {
      const body =
        request.body as {
          propertyId?: string
          provider?: AIProviderType
          tone?: ListingTone
          language?: ListingLanguage
        }

      if (!body.propertyId) {
        return reply.code(400).send({
          message: 'propertyId is required',
        })
      }

      if (!isAIProviderType(body.provider)) {
        return reply.code(400).send({
          message:
            'provider must be mock, gemini or openai',
        })
      }

      if (!isListingTone(body.tone)) {
        return reply.code(400).send({
          message:
            'tone must be profesional, premium or amistoso',
        })
      }

      if (!isListingLanguage(body.language)) {
        return reply.code(400).send({
          message:
            'language must be español or english',
        })
      }

      const result =
        await generateListingForExistingProperty(
          {
            propertyId: body.propertyId,
            provider: body.provider,
            tone: body.tone,
            language: body.language,
          },
        )

      return result
    },
  )

  app.get(
    '/api/generations',
    async () => {
      const generations =
        await prisma.generation.findMany({
          orderBy: {
            createdAt: 'asc',
          },
          include: {
            property: true,
          },
        })

      return generations
    },
  )

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