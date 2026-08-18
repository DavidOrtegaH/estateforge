import { GoogleGenAI } from '@google/genai'
import {
  GeneratedListingSchema,
  type GeneratedListing,
} from '@estateforge/shared'
import type { AIProvider } from './ai-provider.js'

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

      const validation =
        GeneratedListingSchema.safeParse(parsed)

      if (!validation.success) {
        throw new Error(
          'Gemini devolvió un anuncio con un formato inválido.',
        )
      }

      return validation.data
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