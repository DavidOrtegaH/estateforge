import type {
  GeneratedListing,
  GenerationRequest,
  PropertyOperation,
  PropertyType,
  PropertyCondition,
  ListingTone,
  ListingLanguage,
  AIProviderType,
} from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import { buildListingPrompt } from './prompt.service.js'
import type { AIProvider } from '../ai/ai-provider.js'
import { MockAIProvider } from '../ai/mock-ai.provider.js'
import { OpenAIProvider } from '../ai/openai.provider.js'
import { GeminiProvider } from '../ai/gemini.provider.js'

function createAIProvider(
  provider: AIProviderType,
  apiKey?: string,
): AIProvider {
  if (provider === 'gemini') {
    return new GeminiProvider(apiKey)
  }

  if (provider === 'openai') {
    return new OpenAIProvider(apiKey)
  }

  return new MockAIProvider()
}

interface ExistingPropertyGenerationRequest {
  propertyId: string
  provider: AIProviderType
  tone: ListingTone
  language: ListingLanguage
  apiKey?: string
}

interface GenerationResult {
  listing: GeneratedListing
  propertyId: string
  generationId: string
}

async function createGeneration(
  propertyId: string,
  result: GeneratedListing,
  provider: AIProviderType,
  tone: string,
  language: string,
): Promise<string> {
  const generation =
    await prisma.generation.create({
      data: {
        propertyId,
        title: result.title,
        description: result.description,
        highlights: JSON.stringify(
          result.highlights,
        ),
        callToAction:
          result.callToAction,
        provider,
        tone,
        language,
      },
    })

  return generation.id
}

export async function generateListing(
  request: GenerationRequest & { apiKey?: string },
): Promise<GenerationResult> {
  const aiProvider =
    createAIProvider(
      request.provider,
      request.apiKey,
    )

  const prompt =
    buildListingPrompt(request)

  const result =
    await aiProvider.generate(prompt)

  const property =
    await prisma.property.create({
      data: {
        title:
          result.title ||
          'Inmueble en ' +
            request.property.city,

        operation:
          request.property.operation,

        type:
          request.property.type,

        price:
          request.property.price,

        address:
          request.property.address,

        city:
          request.property.city,

        neighborhood:
          request.property.neighborhood,

        area:
          request.property.area,

        bedrooms:
          request.property.bedrooms,

        bathrooms:
          request.property.bathrooms,

        floor:
          request.property.floor,

        condition:
          request.property.condition,

        elevator:
          request.property.elevator,

        terrace:
          request.property.terrace,

        balcony:
          request.property.balcony,

        garage:
          request.property.garage,

        storageRoom:
          request.property.storageRoom,

        pool:
          request.property.pool,

        garden:
          request.property.garden,

        airConditioning:
          request.property.airConditioning,

        heating:
          request.property.heating,

        additionalInformation:
          request.property
            .additionalInformation,
      },
    })

  const generationId =
    await createGeneration(
      property.id,
      result,
      request.provider,
      request.tone,
      request.language,
    )

  return {
    listing: result,
    propertyId: property.id,
    generationId,
  }
}

export async function generateListingForExistingProperty(
  request: ExistingPropertyGenerationRequest,
): Promise<GenerationResult> {
  const property =
    await prisma.property.findUnique({
      where: {
        id: request.propertyId,
      },
    })

  if (!property) {
    throw new Error(
      'Property not found',
    )
  }

  const generationRequest = {
    property: {
      operation:
        property.operation as PropertyOperation,

      type:
        property.type as PropertyType,

      title:
        property.title,

      price:
        property.price,

      address:
        property.address,

      city:
        property.city,

      neighborhood:
        property.neighborhood,

      area:
        property.area,

      bedrooms:
        property.bedrooms,

      bathrooms:
        property.bathrooms,

      floor:
        property.floor ?? undefined,

      condition:
        property.condition as PropertyCondition,

      elevator:
        property.elevator,

      terrace:
        property.terrace,

      balcony:
        property.balcony,

      garage:
        property.garage,

      storageRoom:
        property.storageRoom,

      pool:
        property.pool,

      garden:
        property.garden,

      airConditioning:
        property.airConditioning,

      heating:
        property.heating,

      additionalInformation:
        property.additionalInformation,
    },

    provider:
      request.provider,

    tone:
      request.tone,

    language:
      request.language,

    apiKey:
      request.apiKey,
  }

  const aiProvider =
    createAIProvider(
      request.provider,
      request.apiKey,
    )

  const prompt =
    buildListingPrompt(
      generationRequest,
    )

  const result =
    await aiProvider.generate(prompt)

  const generationId =
    await createGeneration(
      property.id,
      result,
      request.provider,
      request.tone,
      request.language,
    )

  return {
    listing: result,
    propertyId: property.id,
    generationId,
  }
}