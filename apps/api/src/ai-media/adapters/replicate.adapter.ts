import type { AiProviderAdapter, OperationState, ProviderContext, SubmitRequest, SubmitResult, VerifyResult } from '../adapter.js'
import { AiMediaError } from '../errors.js'
import { safeFetch } from '../safe-fetch.js'
import { assertImageSize, bearer, dataUri, download, jsonHeaders, noModeration, operationId, pollFailure, promptText, requireJson, str, TIMEOUT, unsupported, verifyWithGet, type AdapterOptions } from './common.js'

// Replicate (agregador; DA-82), documentación consultada el 12/11/2026 (replicate.com/docs):
//   · comprobación: GET /v1/account (no genera);
//   · modelos oficiales: POST /v1/models/{owner}/{name}/predictions {input} → {id, status};
//   · GET /v1/predictions/{id}: starting | processing | succeeded | failed | canceled | aborted;
//   · POST /v1/predictions/{id}/cancel;
//   · las salidas son URL en replicate.delivery, caducan en una hora y se piden con la cabecera Authorization.
// Solo se registran los modelos cuyos parámetros de entrada constan en su página pública. La fotografía
// viaja como data URL (Replicate la recomienda hasta 1 MB). La clave y la factura son de Replicate.
// Probado solo con respuestas simuladas.

export const REPLICATE_HOSTS = ['api.replicate.com'] as const
export const REPLICATE_RESULT_HOSTS = ['replicate.delivery', '.replicate.delivery'] as const
const BASE = 'https://api.replicate.com/v1'
const MAX_IMAGE_BYTES = 1024 * 1024

export function createReplicateAdapter(options: AdapterOptions = {}): AiProviderAdapter {
  const call = (method: 'GET' | 'POST', path: string, ctx: ProviderContext, body?: unknown, timeoutMs = TIMEOUT.poll) =>
    safeFetch(`${BASE}${path}`, { method, headers: body === undefined ? bearer(ctx.apiKey) : jsonHeaders(bearer(ctx.apiKey)), ...(body !== undefined && { body: JSON.stringify(body) }) }, { allowedHosts: REPLICATE_HOSTS, timeoutMs, maxBytes: 4 * 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })

  return {
    verifyKey: (ctx: ProviderContext): Promise<VerifyResult> => verifyWithGet(`${BASE}/account`, bearer(ctx.apiKey), REPLICATE_HOSTS, options, ctx),

    async submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult> {
      if (request.kind !== 'video') return unsupported('Replicate', 'carteles')
      if (request.model !== 'bytedance/seedance-2.5') throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Modelo no admitido.')
      const primary = request.references[0]
      if (!primary) throw new AiMediaError('AI_INVALID_REQUEST', 'Este modelo necesita la fotografía principal como primer fotograma.')
      assertImageSize([primary], MAX_IMAGE_BYTES, 'Replicate')
      const input = { prompt: promptText(request.prompt, 4_000), image: dataUri(primary), duration: request.durationSeconds, aspect_ratio: '16:9', generate_audio: false }
      const json = requireJson(await call('POST', `/models/${request.model}/predictions`, ctx, { input }, TIMEOUT.submit), [200, 201, 202])
      return { operationId: operationId(json.id) }
    },

    async poll(ctx: ProviderContext, id: string): Promise<OperationState> {
      const response = await call('GET', `/predictions/${encodeURIComponent(id)}`, ctx)
      const json = response.json<Record<string, unknown>>()
      if (response.status !== 200 || !json) return pollFailure(response.status, json)
      switch (json.status) {
        case 'starting':
        case 'processing':
          return { state: 'running' }
        case 'canceled':
        case 'aborted':
          return { state: 'cancelled' }
        case 'succeeded': {
          const uri = str(json.output) ?? (Array.isArray(json.output) ? str(json.output[0]) : null)
          if (!uri) return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
          return { state: 'done', output: { mimeType: 'application/octet-stream', uri }, providerFlagged: false }
        }
        case 'failed':
          return /nsfw|safety|moderat|sensitive|policy/i.test(String(json.error ?? '')) ? { state: 'blocked', category: 'provider_safety_block' } : { state: 'failed', code: 'AI_PROVIDER_FAILED' }
        default:
          return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
      }
    },

    async cancel(ctx: ProviderContext, id: string) {
      try {
        const response = await call('POST', `/predictions/${encodeURIComponent(id)}/cancel`, ctx, {})
        return response.status === 200
      } catch {
        return false
      }
    },

    // Los archivos de salida exigen la cabecera Authorization, y solo se piden a replicate.delivery.
    fetchResult: (ctx: ProviderContext, uri: string, maxBytes: number) => download(uri, REPLICATE_RESULT_HOSTS, bearer(ctx.apiKey), maxBytes, options, ctx),

    moderate: noModeration('Replicate'),
  }
}
