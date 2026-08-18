import OpenAI from 'openai'
import {
  GeneratedListingSchema,
  type GeneratedListing,
} from '@estateforge/shared'
import type { AIProvider } from './ai-provider.js'

export class OpenAIProvider
  implements AIProvider
{
  private readonly client: OpenAI

  constructor() {
    const apiKey =
      process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY no está configurada.',
      )
    }

    this.client = new OpenAI({
      apiKey,
    })
  }

  async generate(
    prompt: string,
  ): Promise<GeneratedListing> {
    try {
      const response =
        await this.client.responses.create({
          model: 'gpt-5.5',
          input: prompt,
          text: {
            format: {
              type: 'json_schema',
              name: 'generated_listing',
              strict: true,
              schema: {
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
                additionalProperties: false,
              },
            },
          },
        })

      const text =
        response.output_text?.trim()

      if (!text) {
        throw new Error(
          'OpenAI no devolvió contenido.',
        )
      }

      let parsed: unknown

      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(
          'OpenAI devolvió una respuesta que no es JSON válido.',
        )
      }

      const validation =
        GeneratedListingSchema.safeParse(parsed)

      if (!validation.success) {
        throw new Error(
          'OpenAI devolvió un anuncio con un formato inválido.',
        )
      }

      return validation.data
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Error al generar el anuncio con OpenAI: ${error.message}`,
        )
      }

      throw new Error(
        'Error desconocido al generar el anuncio con OpenAI.',
      )
    }
  }
}