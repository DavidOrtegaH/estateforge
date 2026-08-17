import { GoogleGenAI } from '@google/genai'
import type { GeneratedListing } from '@estateforge/shared'
import type { AIProvider } from './ai-provider.js'

function isGeneratedListing(
  value: unknown,
): value is GeneratedListing {
  if (!value || typeof value !== 'object') {
    return false
  }

  const listing = value as Record<string, unknown>

  return (
    typeof listing.title === 'string' &&
    listing.title.trim().length > 0 &&
    typeof listing.description === 'string' &&
    listing.description.trim().length > 0 &&
    Array.isArray(listing.highlights) &&
    listing.highlights.every(
      (highlight) =>
        typeof highlight === 'string' &&
        highlight.trim().length > 0,
    ) &&
    typeof listing.callToAction === 'string' &&
    listing.callToAction.trim().length > 0
  )
}

export class GeminiProvider implements AIProvider {
  private readonly client: GoogleGenAI

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY

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
    try {
      const response =
        await this.client.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
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
        })

      const text = response.text?.trim()

      if (!text) {
        throw new Error(
          'Gemini no devolvió contenido.',
        )
      }

      let parsed: unknown

      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(
          'Gemini devolvió una respuesta que no es JSON válido.',
        )
      }

      if (!isGeneratedListing(parsed)) {
        throw new Error(
          'Gemini devolvió un anuncio con un formato inválido.',
        )
      }

      return parsed
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Error al generar el anuncio con Gemini: ${error.message}`,
        )
      }

      throw new Error(
        'Error desconocido al generar el anuncio con Gemini.',
      )
    }
  }
}