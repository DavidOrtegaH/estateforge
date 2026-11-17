import type { AiProviderAdapter, ProviderContext, SubmitRequest, SubmitResult, VerifyResult } from '../adapter.js'
import { AiMediaError } from '../errors.js'
import { safeFetch } from '../safe-fetch.js'
import { base64Image, bearer, noModeration, requireJson, TIMEOUT, unsupported, verifyWithGet, type AdapterOptions } from './common.js'

// Stability AI (DA-82), documentación consultada el 12/11/2026 (docs.stability.ai):
//   · comprobación: GET /v1/user/balance (créditos; no genera);
//   · imagen: POST /v2beta/stable-image/generate/{core|ultra|sd3}, multipart/form-data, síncrono. Con
//     Accept: application/json devuelve {image: base64, finish_reason: SUCCESS | CONTENT_FILTERED}.
// Solo texto a imagen: no se envía ninguna fotografía. La API solo admite prompts en inglés (422
// invalid_language), así que se usa la versión breve en inglés de las reglas. No hay vídeo.
// Probado solo con respuestas simuladas.

export const STABILITY_HOSTS = ['api.stability.ai'] as const
const BASE = 'https://api.stability.ai'
const ENDPOINTS: Record<string, { path: string; model?: string }> = {
  'stable-image-core': { path: '/v2beta/stable-image/generate/core' },
  'stable-image-ultra': { path: '/v2beta/stable-image/generate/ultra' },
  'sd3.5-large': { path: '/v2beta/stable-image/generate/sd3', model: 'sd3.5-large' },
}

export function createStabilityAdapter(options: AdapterOptions = {}): AiProviderAdapter {
  return {
    verifyKey: (ctx: ProviderContext): Promise<VerifyResult> => verifyWithGet(`${BASE}/v1/user/balance`, bearer(ctx.apiKey), STABILITY_HOSTS, options, ctx),

    async submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult> {
      if (request.kind !== 'poster') return unsupported('Stability AI', 'vídeo')
      const endpoint = ENDPOINTS[request.model]
      if (!endpoint) throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Modelo no admitido.')
      const form = new FormData()
      form.set('prompt', request.prompt.compact)
      form.set('aspect_ratio', '4:5')
      form.set('output_format', 'png')
      if (endpoint.model) {
        form.set('model', endpoint.model)
        form.set('mode', 'text-to-image')
      }
      // Sin content-type: fetch pone el de multipart con su delimitador.
      const response = await safeFetch(`${BASE}${endpoint.path}`, { method: 'POST', headers: { ...bearer(ctx.apiKey), Accept: 'application/json' }, body: form }, { allowedHosts: STABILITY_HOSTS, timeoutMs: TIMEOUT.sync, maxBytes: 32 * 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })
      // 403: moderación de la entrada (content_moderation); 422: idioma o figura pública.
      const json = requireJson(response, [200], [403])
      if (json.finish_reason === 'CONTENT_FILTERED') return { operationId: 'sync', immediate: { state: 'blocked', category: 'provider_safety_block' } }
      return { operationId: 'sync', immediate: base64Image(json.image) }
    },

    poll: async () => unsupported('Stability AI', 'operaciones asíncronas'),
    cancel: async () => false,
    fetchResult: async () => unsupported('Stability AI', 'descargas por URL'),
    moderate: noModeration('Stability AI'),
  }
}
