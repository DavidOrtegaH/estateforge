import { GoogleGenAI } from '@google/genai'
import type { GeneratedListing } from '@estateforge/shared'
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
    const response =
      await this.client.models.generateContent({
        model: 'models/gemini-3.6-flash',
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

    const text = response.text

    if (!text) {
      throw new Error(
        'Gemini no devolvió contenido.',
      )
    }

    return JSON.parse(text) as GeneratedListing
  }
}