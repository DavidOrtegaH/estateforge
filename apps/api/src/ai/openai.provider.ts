// Import nombrado: el SDK exporta `OpenAI` con nombre tanto en index.d.ts (CJS) como en index.d.mts (ESM).
// El import por defecto depende de cómo el compilador interprete el `default` de un paquete CommonJS y
// falla en el builder de Vercel (TS2709/TS2351) aunque pase con `tsc` NodeNext.
import { OpenAI } from 'openai'

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

export class OpenAIProvider
  implements AIProvider
{
  private readonly client: OpenAI
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
        'Configura tu API key de OpenAI en Ajustes para generar con este proveedor.',
      )
    }

    this.client = new OpenAI({
      apiKey: resolvedApiKey,
      timeout: REQUEST_TIMEOUT_MS,
      // El SDK reintenta por defecto (2 veces) ante 5xx, 429 o errores de red: una petición que el proveedor
      // pudo haber procesado se repetiría y podría cobrarse dos veces. Sin reintentos (MD-51).
      maxRetries: 0,
    })
  }

  async generate(
    prompt: string,
  ): Promise<GeneratedListing> {
    try {
      const response =
        await this.client.responses.create({
          model: this.model,

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

      const usage = (response as { usage?: Record<string, unknown> }).usage
      this.lastUsage = usageFrom(usage?.input_tokens, usage?.output_tokens)

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