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
import { FREE_TEXT_NOT_INCLUDED, type GenerationNotice } from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import { buildListingPrompt } from './prompt.service.js'
import { validateGeneratedListing } from './listing-validator.service.js'
import { createAIProvider } from '../ai/ai-provider.factory.js'
import { AIProviderError } from '../ai/ai-provider.error.js'
import { discoverOpenRouterModels } from '../ai/text/openrouter-discovery.js'
import { findProvider, isSelectable } from '../ai-media/registry.js'
import { ConnectionError, CredentialCryptoError, isStoredAIKeyProvider, resolveConnection } from './user-ai-key.service.js'

interface ExistingPropertyGenerationRequest {
  propertyId: string
  provider: AIProviderType
  model?: string
  connectionId?: string
  tone: ListingTone
  language: ListingLanguage
  userId: string
}

interface GenerationResult {
  listing: GeneratedListing
  propertyId: string
  generationId: string
  /** Avisos para el usuario sobre el contenido generado (por ejemplo, texto libre no incluido). */
  notices: GenerationNotice[]
}

/**
 * La plantilla local inglesa no traduce ni copia las observaciones del inmueble (texto libre del usuario):
 * se avisa para que el usuario añada su versión inglesa editando el anuncio, en vez de perderlas en silencio.
 * Los proveedores de IA reciben las observaciones y redactan en el idioma pedido, así que no llevan aviso.
 */
export function generationNotices(provider: AIProviderType, language: ListingLanguage, additionalInformation: string | null | undefined): GenerationNotice[] {
  return provider === 'mock' && language === 'english' && additionalInformation?.trim() ? [FREE_TEXT_NOT_INCLUDED] : []
}

/**
 * Generación de texto con la credencial del usuario autenticado (BYOK obligatorio, DA-77).
 *
 * - «mock» es una plantilla local: no es IA, no llama a ningún servicio y no necesita clave.
 * - Cualquier otro proveedor usa exclusivamente la API key cifrada que guardó ese usuario y el modelo de
 *   su preferencia (o el predeterminado del catálogo). Sin clave no hay llamada externa.
 * - No existe clave del servidor, ni de otro usuario, ni cambio silencioso de proveedor: si el proveedor
 *   falla, el error llega al usuario tal cual.
 */
/** Modelo y conexión elegidos para una operación concreta (sin cambiar la preferencia guardada). */
export interface TextGenerationChoice {
  model?: string
  connectionId?: string
  /** Idioma del anuncio: la plantilla local lo necesita; los proveedores de IA lo reciben en el prompt. */
  language?: ListingLanguage
}

export async function generateWithUserKey(
  provider: AIProviderType,
  prompt: string,
  userId: string,
  choice: TextGenerationChoice = {},
): Promise<GeneratedListing> {
  if (provider === 'mock') {
    return createAIProvider(provider, undefined, { language: choice.language }).generate(prompt)
  }

  const definition = findProvider(provider)
  if (!definition || !isStoredAIKeyProvider(provider) || !definition.capabilities.includes('text')) {
    throw new AIProviderError('AI_KEY_REQUIRED', 'Proveedor de IA no disponible.')
  }

  const preference = await prisma.aiMediaPreference.findUnique({ where: { userId }, select: { textProvider: true, textModel: true, textKeyId: true } })
  const samePreference = preference?.textProvider === provider

  let connection
  try {
    connection = await resolveConnection(userId, provider, choice.connectionId, samePreference ? preference.textKeyId : null)
  } catch (error) {
    if (error instanceof CredentialCryptoError) {
      throw new AIProviderError('AI_KEY_UNREADABLE', 'No se puede usar la API key guardada. Vuelve a introducirla en Ajustes.')
    }
    if (error instanceof ConnectionError) {
      throw new AIProviderError('AI_KEY_REQUIRED', `Tienes varias conexiones de ${definition.name}. Elige cuál usar para los textos en Ajustes o al generar.`)
    }
    throw error
  }
  if (!connection) {
    throw new AIProviderError('AI_KEY_REQUIRED', choice.connectionId ? `La conexión elegida de ${definition.name} ya no existe. Elige otra.` : `Para generar con ${definition.name} configura tu propia API key en Ajustes. EstateForge no aporta claves de IA.`)
  }

  // Modelo: el elegido para esta operación; si no, el de la preferencia del usuario para este proveedor; si
  // no, el recomendado del catálogo. Un modelo que ya no está disponible no se sustituye por otro.
  const requested = choice.model ?? (samePreference ? preference.textModel : null)
  const catalog = definition.models.filter(item => item.purpose === 'text' && isSelectable(item))
  let modelId: string | undefined
  if (requested) {
    if (catalog.some(item => item.id === requested)) modelId = requested
    else if (definition.capabilities.includes('model-discovery') && (await isDiscoveredModel(definition.id, requested, connection.apiKey))) modelId = requested
    else throw new AIProviderError('AI_MODEL_NOT_ALLOWED', `El modelo de texto que elegiste para ${definition.name} ya no está disponible. Elige otro en Ajustes.`)
  } else {
    modelId = catalog[0]?.id
  }
  if (!modelId) {
    throw new AIProviderError('AI_MODEL_NOT_ALLOWED', 'Este proveedor no tiene ningún modelo de texto admitido.')
  }

  return createAIProvider(provider, { apiKey: connection.apiKey, model: modelId }).generate(prompt)
}

/** Modelo que no está en el catálogo estático pero sí en el catálogo validado del agregador. */
export async function isDiscoveredModel(providerId: string, modelId: string, apiKey: string): Promise<boolean> {
  if (providerId !== 'openrouter') return false
  try {
    return (await discoverOpenRouterModels(apiKey)).some(model => model.id === modelId)
  } catch {
    return false
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
export function toSharedProperty(
  property: {
    title: string
    operation: string
    type: string
    price: { toString(): string } | number
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
      Number(property.price.toString()),

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
    userId: string
  },
): Promise<GenerationResult> {
  const prompt =
    buildListingPrompt(request)

  const result =
    await generateWithUserKey(
      request.provider,
      prompt,
      request.userId,
      { model: request.model, connectionId: request.connectionId, language: request.language },
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
              // El inmueble conserva el título que escribió el usuario si el anuncio se redacta en inglés
              // (la interfaz y los datos del inmueble siguen en español); en español, como hasta ahora.
              title:
                (request.language === 'english' ? request.property.title : '') ||
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

              commercialStatus:
                request.property.commercialStatus,

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

    notices: generationNotices(request.provider, request.language, request.property.additionalInformation),
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
    // 404 como el resto de rutas de inmuebles: un inmueble ajeno o inexistente responde igual. Sin
    // statusCode, el manejador global lo trataba como un fallo interno (500) y lo registraba como error.
    throw Object.assign(
      new Error('Property not found'),
      { statusCode: 404 },
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
  }

  const prompt =
    buildListingPrompt(
      generationRequest,
    )

  const result =
    await generateWithUserKey(
      request.provider,
      prompt,
      request.userId,
      { model: request.model, connectionId: request.connectionId, language: request.language },
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

    notices: generationNotices(request.provider, request.language, sharedProperty.additionalInformation),
  }
}
