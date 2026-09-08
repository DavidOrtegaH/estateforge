import { GoogleGenAI } from '@google/genai'

import {
  GeneratedListingSchema,
  type GeneratedListing,
} from '@estateforge/shared'

import type { AIProvider } from './ai-provider.js'

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
      'No se encontró el JSON del inmueble en el prompt.',
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
      'Los datos del inmueble no tienen un formato válido.',
    )
  }
}

export class GeminiProvider
  implements AIProvider
{
  private readonly client: GoogleGenAI

  constructor(apiKey?: string) {
    const resolvedApiKey =
      apiKey ??
      process.env.GEMINI_API_KEY

    if (!resolvedApiKey) {
      throw new AIProviderError(
        'AI_INVALID_API_KEY',
        'La API key de Gemini no está configurada.',
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

      const response =
        await this.client.models.generateContent(
          {
            model:
              'gemini-3.6-flash',

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

      const text =
        response.text?.trim()

      if (!text) {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'Gemini no devolvió contenido.',
        )
      }

      let parsed: unknown

      try {
        parsed =
          JSON.parse(text)
      } catch {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'Gemini devolvió una respuesta que no es JSON válido.',
        )
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null
      ) {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'Gemini devolvió un anuncio con un formato inválido.',
        )
      }

      const parsedListing =
        parsed as Record<
          string,
          unknown
        >

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
          'Gemini devolvió un anuncio con un formato inválido.',
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