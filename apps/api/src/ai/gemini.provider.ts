
import { GoogleGenAI } from '@google/genai'

import {
  GeneratedListingSchema,
  type GeneratedListing,
} from '@estateforge/shared'

import { usageFrom, type AIProvider, type AIUsage } from './ai-provider.js'

import {
  AIProviderError,
  classifyAIProviderError,
} from './ai-provider.error.js'

const REQUEST_TIMEOUT_MS = 40_000

interface PromptProperty {
  title?: string
  operation: string
  type: string
  price: number
  address: string
  city: string
  neighborhood: string
  area: number
  bedrooms: number
  bathrooms: number
  floor?: number
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
}

function extractPropertyFromPrompt(
  prompt: string,
): PromptProperty {
  const marker =
    'DATOS DEL INMUEBLE:'

  const start =
    prompt.indexOf(marker)

  if (start === -1) {
    throw new AIProviderError(
      'AI_PROVIDER_ERROR',
      'No se encontraron los datos del inmueble en el prompt.',
    )
  }

  const jsonStart =
    prompt.indexOf('{', start)

  if (jsonStart === -1) {
    throw new AIProviderError(
      'AI_PROVIDER_ERROR',
      'No se encontrÃ³ el JSON del inmueble en el prompt.',
    )
  }

  let braceCount = 0
  let jsonEnd = -1

  for (
    let i = jsonStart;
    i < prompt.length;
    i++
  ) {
    if (prompt[i] === '{') {
      braceCount++
    } else if (
      prompt[i] === '}'
    ) {
      braceCount--

      if (braceCount === 0) {
        jsonEnd = i
        break
      }
    }
  }

  if (jsonEnd === -1) {
    throw new AIProviderError(
      'AI_PROVIDER_ERROR',
      'No se pudo determinar el final de los datos del inmueble.',
    )
  }

  const json =
    prompt.slice(
      jsonStart,
      jsonEnd + 1,
    )

  try {
    return JSON.parse(
      json,
    ) as PromptProperty
  } catch {
    throw new AIProviderError(
      'AI_PROVIDER_ERROR',
      'Los datos del inmueble no tienen un formato vÃ¡lido.',
    )
  }
}

export class GeminiProvider
  implements AIProvider
{
  private readonly client: GoogleGenAI
  lastUsage?: AIUsage

  // BYOK (DA-77): la clave es siempre la del usuario; nunca se lee del entorno del servidor.
  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    const resolvedApiKey = apiKey?.trim()

    if (!resolvedApiKey) {
      throw new AIProviderError(
        'AI_KEY_REQUIRED',
        'Configura tu API key de Gemini en Ajustes para generar con este proveedor.',
      )
    }

    this.client =
      new GoogleGenAI({
        apiKey: resolvedApiKey,
      })
  }

  async generate(
    prompt: string,
  ): Promise<GeneratedListing> {
    const controller =
      new AbortController()

    const timeoutId =
      setTimeout(() => {
        controller.abort()
      }, REQUEST_TIMEOUT_MS)

    try {
      const inputProperty =
        extractPropertyFromPrompt(
          prompt,
        )

      const propertyTypeLabel =
        inputProperty.type === 'villa' ||
        inputProperty.type === 'chalet'
          ? 'Chalet'
          : inputProperty.type === 'apartment' ||
              inputProperty.type === 'flat'
            ? 'Piso'
            : inputProperty.type === 'house'
              ? 'Casa'
              : inputProperty.type === 'penthouse'
                ? 'Ático'
                : inputProperty.type === 'duplex'
                  ? 'Dúplex'
                  : inputProperty.type === 'studio'
                    ? 'Estudio'
                    : inputProperty.type === 'commercial'
                      ? 'Local comercial'
                      : inputProperty.type === 'office'
                        ? 'Oficina'
                        : inputProperty.type === 'land'
                          ? 'Terreno'
                          : 'Inmueble'


      const response =
        await this.client.models.generateContent(
          {
            model:
              this.model,

            contents:
              prompt,

            config: {
              abortSignal:
                controller.signal,

              responseMimeType:
                'application/json',

              responseSchema: {
                type: 'object',

                properties: {
                  title: {
                    type: 'string',
                  },

                  description: {
                    type: 'string',
                  },

                  highlights: {
                    type: 'array',

                    items: {
                      type: 'string',
                    },
                  },

                  callToAction: {
                    type: 'string',
                  },
                },

                required: [
                  'title',
                  'description',
                  'highlights',
                  'callToAction',
                ],
              },
            },
          },
        )

      const usage = (response as { usageMetadata?: Record<string, unknown> }).usageMetadata
      this.lastUsage = usageFrom(usage?.promptTokenCount, usage?.candidatesTokenCount)

      const text =
        response.text?.trim()

      if (!text) {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'Gemini no devolviÃ³ contenido.',
        )
      }

      let parsed: unknown

      try {
        parsed =
          JSON.parse(text)
      } catch {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'Gemini devolviÃ³ una respuesta que no es JSON vÃ¡lido.',
        )
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null
      ) {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'Gemini devolviÃ³ un anuncio con un formato invÃ¡lido.',
        )
      }

      const parsedListing =
        parsed as Record<
          string,
          unknown
        >

      if (
        inputProperty.type === 'villa' ||
        inputProperty.type === 'chalet'
      ) {
        const languageMatch =
          prompt.match(/IDIOMA:\s*([\s\S]*?)\n\s*DATOS DEL INMUEBLE:/)
        const isSpanish =
          languageMatch?.[1]
            ?.toLowerCase()
            .includes('español') ?? false

        if (isSpanish) {
          for (const field of [
            'title',
            'description',
            'highlights',
            'callToAction',
          ]) {
            const value = parsedListing[field]

            if (typeof value === 'string') {
              parsedListing[field] = value.replace(
                /\bvilla\b/gi,
                propertyTypeLabel,
              )
            } else if (Array.isArray(value)) {
              parsedListing[field] = value.map((item) =>
                typeof item === 'string'
                  ? item.replace(/\bvilla\b/gi, propertyTypeLabel)
                  : item,
              )
            }
          }
        }
      }

      if (
        inputProperty.title &&
        inputProperty.title.trim() !== ''
      ) {
        parsedListing.title =
          inputProperty.title
      } else if (
        typeof parsedListing.title !==
          'string' ||
        parsedListing.title.trim() === ''
      ) {
        parsedListing.title =
          `Inmueble en ${
            inputProperty.city ||
            'venta'
          }`
      }

      const validation =
        GeneratedListingSchema.safeParse(
          parsedListing,
        )

      if (!validation.success) {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'Gemini devolviÃ³ un anuncio con un formato invÃ¡lido.',
        )
      }

      return validation.data
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw error
      }

      if (
        controller.signal.aborted
      ) {
        throw new AIProviderError(
          'AI_TIMEOUT',
          'Error al generar el anuncio con Gemini: La solicitud a Gemini ha superado el tiempo límite de 40 segundos.',
        )
      }

      throw classifyAIProviderError(
        'Gemini',
        error,
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
