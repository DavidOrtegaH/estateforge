import { GoogleGenAI } from '@google/genai'
import {
  GeneratedListingSchema,
  type GeneratedListing,
} from '@estateforge/shared'
import type { AIProvider } from './ai-provider.js'

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
  pool: boolean
  garden: boolean
  airConditioning: boolean
  heating: boolean
  additionalInformation: string
}

function extractPropertyFromPrompt(
  prompt: string,
): PromptProperty {
  const marker = 'DATOS DEL INMUEBLE:'
  const start = prompt.indexOf(marker)

  if (start === -1) {
    throw new Error(
      'No se encontraron los datos del inmueble en el prompt.',
    )
  }

  const jsonStart = prompt.indexOf('{', start)

  if (jsonStart === -1) {
    throw new Error(
      'No se encontró el JSON del inmueble en el prompt.',
    )
  }

  let braceCount = 0
  let jsonEnd = -1

  for (let i = jsonStart; i < prompt.length; i++) {
    if (prompt[i] === '{') {
      braceCount++
    } else if (prompt[i] === '}') {
      braceCount--
      if (braceCount === 0) {
        jsonEnd = i
        break
      }
    }
  }

  if (jsonEnd === -1) {
    throw new Error(
      'No se pudo determinar el final de los datos del inmueble.',
    )
  }

  const json = prompt.slice(jsonStart, jsonEnd + 1)

  return JSON.parse(json) as PromptProperty
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
      // Extraemos los datos originales del inmueble (incluyendo el título del formulario)
      const inputProperty = extractPropertyFromPrompt(prompt)

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

      let parsed: any

      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(
          'Gemini devolvió una respuesta que no es JSON válido.',
        )
      }

      // Si el título viene vacío o queremos priorizar estrictamente el introducido en el input:
      if (inputProperty.title && inputProperty.title.trim() !== '') {
        parsed.title = inputProperty.title
      } else if (!parsed.title || parsed.title.trim() === '') {
        parsed.title = `Inmueble en ${inputProperty.city || 'venta'}`
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