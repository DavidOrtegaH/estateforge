import type {
  GeneratedListing,
  GenerationRequest,
  Property,
  PropertyOperation,
  PropertyType,
  PropertyCondition,
  ListingTone,
  ListingLanguage,
  AIProviderType,
} from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import { buildListingPrompt } from './prompt.service.js'
import { validateGeneratedListing } from './listing-validator.service.js'
import { createAIProvider } from '../ai/ai-provider.factory.js'
import { isAIProviderError } from '../ai/ai-provider.error.js'
import { getUserAIKey } from './user-ai-key.service.js'

interface ExistingPropertyGenerationRequest {
  propertyId: string
  provider: AIProviderType
  tone: ListingTone
  language: ListingLanguage
  apiKey?: string
  userId: string
}

interface GenerationResult {
  listing: GeneratedListing
  propertyId: string
  generationId: string
}

export async function generateWithUserKeyFallback(
  provider: AIProviderType,
  prompt: string,
  apiKey: string | undefined,
  userId: string,
): Promise<GeneratedListing> {
  // Mock never needs an API key and must never consult stored keys.
  if (provider === 'mock') {
    return createAIProvider(provider).generate(prompt)
  }

  // An explicitly supplied key always has priority and remains temporary.
  if (apiKey) {
    return createAIProvider(provider, apiKey).generate(prompt)
  }

  try {
    return await createAIProvider(provider).generate(prompt)
  } catch (error) {
    if (!isAIProviderError(error) || error.code !== 'AI_QUOTA_EXCEEDED') {
      throw error
    }

    // Only when the server-side provider quota is exhausted do we try
    // the encrypted key saved by the authenticated user.
    try {
      const storedKey = await getUserAIKey(
        userId,
        provider,
      )

      if (!storedKey) {
        throw error
      }

      return createAIProvider(provider, storedKey).generate(prompt)
    } catch (storedKeyError) {
      // A missing encryption key or a damaged stored secret must not turn
      // the provider quota error into an unrelated 500. The user can still
      // recover by supplying a temporary API key manually.
      if (storedKeyError === error) {
        throw error
      }

      throw error
    }
  }
}

/**
 * Convierte el modelo de Prisma al tipo Property utilizado
 * por el paquete shared.
 *
 * El modelo de Prisma contiene campos adicionales como:
 * - id
 * - userId
 * - createdAt
 * - updatedAt
 *
 * Estos campos pertenecen a persistencia y no forman parte
 * del tipo Property compartido utilizado por el validador.
 *
 * Además, Prisma utiliza null para floor cuando no existe
 * valor, mientras que el tipo compartido utiliza undefined.
 */
function toSharedProperty(
  property: {
    title: string
    operation: string
    type: string
    price: number
    address: string
    city: string
    neighborhood: string
    area: number
    bedrooms: number
    bathrooms: number
    floor: number | null
    condition: string
    elevator: boolean
    terrace: boolean
    balcony: boolean
    garage: boolean
    storageRoom: boolean
    pool: boolean
    garden: boolean
    airConditioning: boolean
    heating: boolean
    additionalInformation: string
  },
): Property {
  return {
    title:
      property.title,

    operation:
      property.operation as PropertyOperation,

    type:
      property.type as PropertyType,

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
  }
}

export async function generateListing(
  request: GenerationRequest & {
    apiKey?: string
    userId: string
  },
): Promise<GenerationResult> {
  const prompt =
    buildListingPrompt(request)

  const result =
    await generateWithUserKeyFallback(
      request.provider,
      prompt,
      request.apiKey,
      request.userId,
    )

  const {
    property,
    generation,
    validatedListing,
  } =
    await prisma.$transaction(
      async (tx) => {
        const property =
          await tx.property.create({
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
                request.property
                  .airConditioning,

              heating:
                request.property.heating,

              additionalInformation:
                request.property
                  .additionalInformation,

              userId:
                request.userId,
            },
          })

        const sharedProperty =
          toSharedProperty(
            property,
          )

        const validatedListing =
          validateGeneratedListing(
            result,
            sharedProperty,
          )

        const generation =
          await tx.generation.create({
            data: {
              propertyId:
                property.id,

              title:
                validatedListing.title,

              description:
                validatedListing.description,

              highlights:
                JSON.stringify(
                  validatedListing.highlights,
                ),

              callToAction:
                validatedListing.callToAction,

              provider:
                request.provider,

              tone:
                request.tone,

              language:
                request.language,
            },
          })

        return {
          property,
          generation,
          validatedListing,
        }
      },
    )

  return {
    listing:
      validatedListing,

    propertyId:
      property.id,

    generationId:
      generation.id,
  }
}

export async function generateListingForExistingProperty(
  request: ExistingPropertyGenerationRequest,
): Promise<GenerationResult> {
  const property =
    await prisma.property.findFirst({
      where: {
        id: request.propertyId,
        userId: request.userId,
      },
    })

  if (!property) {
    throw new Error(
      'Property not found',
    )
  }

  const sharedProperty =
    toSharedProperty(
      property,
    )

  const generationRequest: GenerationRequest = {
    property: {
      title:
        sharedProperty.title,

      operation:
        sharedProperty.operation,

      type:
        sharedProperty.type,

      price:
        sharedProperty.price,

      address:
        sharedProperty.address,

      city:
        sharedProperty.city,

      neighborhood:
        sharedProperty.neighborhood,

      area:
        sharedProperty.area,

      bedrooms:
        sharedProperty.bedrooms,

      bathrooms:
        sharedProperty.bathrooms,

      floor:
        sharedProperty.floor,

      condition:
        sharedProperty.condition,

      elevator:
        sharedProperty.elevator,

      terrace:
        sharedProperty.terrace,

      balcony:
        sharedProperty.balcony,

      garage:
        sharedProperty.garage,

      storageRoom:
        sharedProperty.storageRoom,

      pool:
        sharedProperty.pool,

      garden:
        sharedProperty.garden,

      airConditioning:
        sharedProperty.airConditioning,

      heating:
        sharedProperty.heating,

      additionalInformation:
        sharedProperty
          .additionalInformation,
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

  const prompt =
    buildListingPrompt(
      generationRequest,
    )

  const result =
    await generateWithUserKeyFallback(
      request.provider,
      prompt,
      request.apiKey,
      request.userId,
    )

  const validatedListing =
    validateGeneratedListing(
      result,
      sharedProperty,
    )

  const generation =
    await prisma.generation.create({
      data: {
        propertyId:
          property.id,

        title:
          validatedListing.title,

        description:
          validatedListing.description,

        highlights:
          JSON.stringify(
            validatedListing.highlights,
          ),

        callToAction:
          validatedListing.callToAction,

        provider:
          request.provider,

        tone:
          request.tone,

        language:
          request.language,
      },
    })

  return {
    listing:
      validatedListing,

    propertyId:
      property.id,

    generationId:
      generation.id,
  }
}
