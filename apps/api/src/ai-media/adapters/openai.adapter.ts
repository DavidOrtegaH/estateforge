import type { AiModerationCategory } from '@estateforge/shared'

import type { AiProviderAdapter, ModerationRequest, ModerationVerdict, ProviderContext, SubmitRequest, SubmitResult, VerifyResult } from '../adapter.js'
import { AiMediaError } from '../errors.js'
import { safeFetch } from '../safe-fetch.js'
import { base64Image, bearer, dataUri, jsonHeaders, promptText, requireJson, TIMEOUT, unsupported, verifyWithGet, type AdapterOptions } from './common.js'

// OpenAI (DA-77, DA-82), documentación consultada el 12/11/2026:
//   · comprobación de la clave: GET /v1/models (no genera contenido);
//   · fondo de cartel con GPT Image: POST /v1/images/generations (sin referencias) o /v1/images/edits
//     (con fotografías de referencia como data URL). Síncrono: devuelve data[].b64_json;
//   · clasificador de seguridad: POST /v1/moderations con omni-moderation-latest (texto e imagen; no vídeo).
// El texto lo genera ai/openai.provider.ts. La API de vídeo (Sora) se cerró el 24/09/2026: no hay vídeo.
// Probado solo con respuestas simuladas que siguen la forma documentada.

export const OPENAI_HOSTS = ['api.openai.com'] as const
const BASE = 'https://api.openai.com/v1'
export const OPENAI_MODERATION_MODEL = 'omni-moderation-latest'

/** Categorías del clasificador de OpenAI → categorías controladas de EstateForge. */
const CATEGORY_MAP: Record<string, AiModerationCategory> = {
  'sexual/minors': 'sexual_minors',
  sexual: 'sexual_explicit',
  harassment: 'harassment',
  'harassment/threatening': 'harassment',
  hate: 'hate',
  'hate/threatening': 'hate',
  illicit: 'dangerous_illegal',
  'illicit/violent': 'dangerous_illegal',
  'self-harm': 'violence',
  'self-harm/intent': 'violence',
  'self-harm/instructions': 'violence',
  violence: 'violence',
  'violence/graphic': 'violence',
}

export function createOpenAIAdapter(options: AdapterOptions = {}): AiProviderAdapter {
  const post = (path: string, body: unknown, timeoutMs: number, ctx: ProviderContext) =>
    safeFetch(`${BASE}${path}`, { method: 'POST', headers: jsonHeaders(bearer(ctx.apiKey)), body: JSON.stringify(body) }, { allowedHosts: OPENAI_HOSTS, timeoutMs, maxBytes: 48 * 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })

  return {
    verifyKey: (ctx: ProviderContext): Promise<VerifyResult> => verifyWithGet(`${BASE}/models`, bearer(ctx.apiKey), OPENAI_HOSTS, options, ctx, true),

    async submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult> {
      if (request.kind !== 'poster') return unsupported('OpenAI', 'vídeo')
      const common = { model: request.model, prompt: promptText(request.prompt, 32_000), size: '1024x1536', quality: 'medium', n: 1, output_format: 'png', moderation: 'auto' }
      const response =
        request.references.length > 0
          ? await post('/images/edits', { ...common, images: request.references.map(image => ({ image_url: dataUri(image) })) }, TIMEOUT.sync, ctx)
          : await post('/images/generations', common, TIMEOUT.sync, ctx)
      const json = requireJson(response, [200])
      const first = Array.isArray(json.data) ? (json.data[0] as Record<string, unknown> | undefined) : undefined
      return { operationId: 'sync', immediate: base64Image(first?.b64_json) }
    },

    poll: async () => unsupported('OpenAI', 'operaciones asíncronas'),
    cancel: async () => false,
    fetchResult: async () => unsupported('OpenAI', 'descargas por URL'),

    async moderate(ctx: ProviderContext, request: ModerationRequest): Promise<ModerationVerdict> {
      const unavailable = () => new AiMediaError('MODERATION_UNAVAILABLE', 'No se ha podido completar la comprobación de seguridad.', 'moderation_unavailable')
      // Este clasificador no analiza vídeo: no se da por bueno un vídeo sin clasificar.
      if (request.video) throw unavailable()
      const input: unknown[] = []
      const text = Object.values(request.text ?? {}).filter(Boolean).join('\n')
      if (text) input.push({ type: 'text', text })
      for (const image of request.images ?? []) input.push({ type: 'image_url', image_url: { url: dataUri(image) } })
      if (input.length === 0) throw unavailable()
      let response
      try {
        response = await post('/moderations', { model: OPENAI_MODERATION_MODEL, input }, TIMEOUT.sync, ctx)
      } catch {
        throw unavailable()
      }
      const json = response.json<{ results?: { flagged?: unknown; categories?: Record<string, unknown> }[] }>()
      const results = json?.results
      if (response.status !== 200 || !Array.isArray(results) || results.length === 0 || results.some(result => typeof result?.flagged !== 'boolean')) throw unavailable()
      const categories = new Set<AiModerationCategory>()
      let flagged = false
      for (const result of results) {
        if (result.flagged) flagged = true
        for (const [name, value] of Object.entries(result.categories ?? {})) {
          if (value === true) {
            flagged = true
            categories.add(CATEGORY_MAP[name] ?? 'provider_safety_block')
          }
        }
      }
      return flagged ? { allowed: false, categories: categories.size ? [...categories] : ['provider_safety_block'] } : { allowed: true, categories: [] }
    },
  }
}
