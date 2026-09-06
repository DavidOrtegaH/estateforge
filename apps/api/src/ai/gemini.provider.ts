import { GoogleGenAI } from '@google/genai'

import {
  GeneratedListingSchema,
  type GeneratedListing,
} from '@estateforge/shared'

import type { AIProvider } from './ai-provider.js'

const REQUEST_TIMEOUT_MS = 15_000

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
  additionalInformation?: string
}

function extractPropertyFromPrompt(
  prompt: string,
): PromptProperty {
  const marker =
    'DATOS DEL INMUEBLE:'

  const start =
    prompt.indexOf(marker)

  if (start === -1) {
    throw new Error(
      'No se encontraron los datos del inmueble en el prompt.',
    )
  }

  const jsonText =
    prompt
      .slice(start + marker.length)
      .trim()

  try {
    return JSON.parse(
      jsonText,
    ) as PromptProperty
  } catch {
    throw new Error(
      'Los datos del inmueble del prompt no son JSON válido.',
    )
  }
}

export class GeminiProvider
  implements AIProvider
{
  private readonly client: GoogleGenAI

  constructor() {
    const apiKey =
      process.env.GEMINI_API_KEY

    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY no está configurada.',
      )
    }

    this.client = new GoogleGenAI({
      apiKey,
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
            model: 'gemini-3.6-flash',
            contents: prompt,
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
        throw new Error(
          'Gemini no devolvió contenido.',
        )
      }

      let parsed: unknown

      try {
        parsed =
          JSON.parse(text)
      } catch {
        throw new Error(
          'Gemini devolvió una respuesta que no es JSON válido.',
        )
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null
      ) {
        throw new Error(
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
          `Inmueble en ${inputProperty.city}`
      }

      const validation =
        GeneratedListingSchema.safeParse(
          parsedListing,
        )

      if (!validation.success) {
        throw new Error(
          'Gemini devolvió un anuncio con un formato inválido.',
        )
      }

      return validation.data
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.name ===
            'AbortError' ||
          controller.signal.aborted
        )
      ) {
        throw new Error(
          'Error al generar el anuncio con Gemini: La solicitud a Gemini ha superado el tiempo límite de 15 segundos.',
        )
      }

      if (error instanceof Error) {
        throw new Error(
          `Error al generar el anuncio con Gemini: ${error.message}`,
        )
      }

      throw new Error(
        'Error desconocido al generar el anuncio con Gemini.',
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }
}