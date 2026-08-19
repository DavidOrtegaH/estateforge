import type { AIProvider } from './ai-provider.js'
import { MockAIProvider } from './mock-ai.provider.js'
import { GeminiProvider } from './gemini.provider.js'
import { OpenAIProvider } from './openai.provider.js'
import type { AIProviderType } from '@estateforge/shared'

export function createAIProvider(
  provider: AIProviderType,
): AIProvider {
  console.log(
    `[EstateForge] Generando anuncio con proveedor: ${provider}`,
  )

  switch (provider) {
    case 'mock':
      return new MockAIProvider()

    case 'gemini':
      return new GeminiProvider()

    default:
      throw new Error(
        `Proveedor de IA no soportado: ${provider}`,
      )
  }
}