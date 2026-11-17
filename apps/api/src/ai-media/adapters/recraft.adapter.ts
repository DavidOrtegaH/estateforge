import type { AiProviderAdapter, ProviderContext, SubmitRequest, SubmitResult, VerifyResult } from '../adapter.js'
import { safeFetch } from '../safe-fetch.js'
import { base64Image, bearer, jsonHeaders, noModeration, promptText, requireJson, TIMEOUT, unsupported, verifyWithGet, type AdapterOptions } from './common.js'

// Recraft (DA-82), documentación consultada el 12/11/2026 (recraft.ai/docs/api-reference):
//   · comprobación: GET /v1/users/me (cuenta y saldo; no genera);
//   · imagen: POST /v1/images/generations {prompt, model, size, n, response_format:'b64_json',
//     image_format:'png'}. Síncrono: {data:[{b64_json}]}.
// Solo texto a imagen. La respuesta no trae ninguna marca de seguridad: el resultado lo comprueba el
// clasificador externo del usuario. Probado solo con respuestas simuladas.

export const RECRAFT_HOSTS = ['external.api.recraft.ai'] as const
const BASE = 'https://external.api.recraft.ai/v1'

export function createRecraftAdapter(options: AdapterOptions = {}): AiProviderAdapter {
  return {
    verifyKey: (ctx: ProviderContext): Promise<VerifyResult> => verifyWithGet(`${BASE}/users/me`, bearer(ctx.apiKey), RECRAFT_HOSTS, options, ctx),

    async submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult> {
      if (request.kind !== 'poster') return unsupported('Recraft', 'vídeo')
      const body = { prompt: promptText(request.prompt, 9_000), model: request.model, size: '1:1', n: 1, response_format: 'b64_json', image_format: 'png' }
      const response = await safeFetch(`${BASE}/images/generations`, { method: 'POST', headers: jsonHeaders(bearer(ctx.apiKey)), body: JSON.stringify(body) }, { allowedHosts: RECRAFT_HOSTS, timeoutMs: TIMEOUT.sync, maxBytes: 32 * 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })
      const json = requireJson(response, [200])
      const first = Array.isArray(json.data) ? (json.data[0] as Record<string, unknown> | undefined) : undefined
      return { operationId: 'sync', immediate: base64Image(first?.b64_json) }
    },

    poll: async () => unsupported('Recraft', 'operaciones asíncronas'),
    cancel: async () => false,
    fetchResult: async () => unsupported('Recraft', 'descargas por URL'),
    moderate: noModeration('Recraft'),
  }
}
