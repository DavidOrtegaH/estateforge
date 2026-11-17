import type { AIProviderType } from '@estateforge/shared'

import type { FetchImpl } from '../ai-media/safe-fetch.js'
import { findProvider } from '../ai-media/registry.js'
import type { AIProvider } from './ai-provider.js'
import { AIProviderError } from './ai-provider.error.js'
import { GeminiProvider } from './gemini.provider.js'
import { MockAIProvider } from './mock-ai.provider.js'
import { OpenAIProvider } from './openai.provider.js'
import { AnthropicProvider, ChatCompletionsProvider } from './text/text-providers.js'

/** Credencial del usuario autenticado y modelo del catálogo con los que se ejecuta una generación. */
export interface UserAICredential {
  apiKey: string
  model: string
  /** Solo pruebas de contrato. */
  fetchImpl?: FetchImpl
}

/**
 * BYOK obligatorio (DA-77, DA-82). «mock» es una plantilla local sin IA ni llamadas externas y no usa clave.
 * Los demás proveedores exigen la credencial del usuario: no existe ninguna clave del servidor ni se lee
 * ninguna variable de entorno. El protocolo y la URL de cada proveedor salen del catálogo (nunca del
 * usuario). «simulador» solo existe en desarrollo y pruebas.
 */
export function createAIProvider(
  provider: AIProviderType,
  credential?: UserAICredential,
): AIProvider {
  if (provider === 'mock') {
    return new MockAIProvider()
  }

  if (!credential?.apiKey) {
    throw new AIProviderError(
      'AI_KEY_REQUIRED',
      'Configura tu propia API key de este proveedor en Ajustes para generar con IA.',
    )
  }

  // El simulador se resuelve aunque no esté activado en el entorno: no hace ninguna llamada externa.
  if (provider === 'simulador') {
    // Simulador local (no es un proveedor real): mismo generador determinista que la plantilla local.
    return new MockAIProvider()
  }

  const definition = findProvider(provider)
  const protocol = definition?.text
  if (!definition || !protocol) {
    throw new Error(
      `Proveedor de IA no soportado: ${provider}`,
    )
  }
  const options = { name: definition.name, apiKey: credential.apiKey, model: credential.model, hosts: definition.allowedHosts, fetchImpl: credential.fetchImpl }

  switch (protocol.protocol) {
    case 'gemini-sdk':
      return new GeminiProvider(credential.apiKey, credential.model)

    case 'openai-responses':
      return new OpenAIProvider(credential.apiKey, credential.model)

    case 'anthropic-messages':
      return new AnthropicProvider(options, protocol)

    case 'chat-completions':
      return new ChatCompletionsProvider(options, protocol)

    default:
      return new MockAIProvider()
  }
}
