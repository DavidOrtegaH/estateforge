import OpenAI from 'openai'
import type { GeneratedListing } from '@estateforge/shared'
import type { AIProvider } from './ai-provider.js'

export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async generate(prompt: string): Promise<GeneratedListing> {
    const response = await this.client.responses.create({
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

    return JSON.parse(response.output_text) as GeneratedListing
  }
}