import OpenAI from 'openai'

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

export class OpenAIProvider
  implements AIProvider
{
  private readonly client: OpenAI

  constructor(apiKey?: string) {
    const resolvedApiKey =
      apiKey ??
      process.env.OPENAI_API_KEY

    if (!resolvedApiKey) {
      throw new AIProviderError(
        'AI_INVALID_API_KEY',
        'La API key de OpenAI no está configurada.',
      )
    }

    this.client = new OpenAI({
      apiKey: resolvedApiKey,
      timeout: REQUEST_TIMEOUT_MS,
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

              name:
                'generated_listing',

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

                additionalProperties:
                  false,
              },
            },
          },
        })

      const text =
        response.output_text?.trim()

      if (!text) {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'OpenAI no devolvió contenido.',
        )
      }

      let parsed: unknown

      try {
        parsed = JSON.parse(text)
      } catch {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'OpenAI devolvió una respuesta que no es JSON válido.',
        )
      }

      const validation =
        GeneratedListingSchema.safeParse(
          parsed,
        )

      if (!validation.success) {
        throw new AIProviderError(
          'AI_PROVIDER_ERROR',
          'OpenAI devolvió un anuncio con un formato inválido.',
        )
      }

      return validation.data
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw error
      }

      throw classifyAIProviderError(
        'OpenAI',
        error,
      )
    }
  }
}