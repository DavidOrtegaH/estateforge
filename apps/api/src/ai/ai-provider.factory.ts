import type { AIProvider } from './ai-provider.js'
import { MockAIProvider } from './mock-ai.provider.js'
import { GeminiProvider } from './gemini.provider.js'
import { OpenAIProvider } from './openai.provider.js'

export function createAIProvider(): AIProvider {
  const provider = (
    process.env.AI_PROVIDER ?? 'mock'
  ).toLowerCase()

  console.log(
    `[EstateForge] Proveedor de IA seleccionado: ${provider}`,
  )

  switch (provider) {
    case 'gemini':
      return new GeminiProvider()

    case 'openai':
      return new OpenAIProvider()

    case 'mock':
      return new MockAIProvider()

    default:
      throw new Error(
        `Proveedor de IA no soportado: ${provider}. ` +
          `Usa "mock", "gemini" u "openai".`,
      )
  }
}