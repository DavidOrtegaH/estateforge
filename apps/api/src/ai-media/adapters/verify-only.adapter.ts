import type { AiProviderAdapter, ProviderContext, VerifyResult } from '../adapter.js'
import { bearer, noModeration, unsupported, verifyWithGet, type AdapterOptions } from './common.js'

// Proveedores de solo texto (Anthropic, Mistral, DeepSeek, Groq, OpenRouter): el texto lo generan los
// proveedores de ai/text; este adaptador solo comprueba la clave sin generar contenido, con un GET a una
// URL fija del proveedor. Si el proveedor no documenta ninguna comprobación así (OpenRouter), lo dice.

export interface VerifyOnlyConfig {
  name: string
  hosts: readonly string[]
  /** listModels: la comprobación es una lista de modelos de la cuenta (se usa para el diagnóstico). */
  verify: { url: string; header: 'bearer' | 'x-api-key'; extraHeaders?: Record<string, string>; listModels?: boolean } | null
}

export function createVerifyOnlyAdapter(config: VerifyOnlyConfig, options: AdapterOptions = {}): AiProviderAdapter {
  return {
    async verifyKey(ctx: ProviderContext): Promise<VerifyResult> {
      if (!config.verify) return { ok: false, code: 'AI_VERIFY_UNSUPPORTED' }
      const auth = config.verify.header === 'bearer' ? bearer(ctx.apiKey) : { 'x-api-key': ctx.apiKey }
      return verifyWithGet(config.verify.url, { ...auth, ...config.verify.extraHeaders }, config.hosts, options, ctx, config.verify.listModels === true)
    },
    submit: async () => unsupported(config.name, 'carteles ni vídeos'),
    poll: async () => unsupported(config.name, 'carteles ni vídeos'),
    cancel: async () => false,
    fetchResult: async () => unsupported(config.name, 'carteles ni vídeos'),
    moderate: noModeration(config.name),
  }
}
