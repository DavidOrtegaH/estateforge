import type { AiProviderAdapter, OperationState, ProviderContext, SubmitRequest, SubmitResult, VerifyResult } from '../adapter.js'
import { AiMediaError } from '../errors.js'
import { safeFetch } from '../safe-fetch.js'
import { base64Image, bearer, dataUri, download, errorText, jsonHeaders, noModeration, operationId, pollFailure, promptText, requireJson, str, TIMEOUT, verifyWithGet, type AdapterOptions } from './common.js'

// xAI (DA-82), documentación consultada el 12/11/2026 (docs.x.ai):
//   · comprobación: GET /v1/models (modelos disponibles para la clave);
//   · imagen: POST /v1/images/generations {model, prompt, n, aspect_ratio, resolution, response_format:'b64_json'}
//     o POST /v1/images/edits con images:[{url: data URL}] (hasta 5). Síncrono;
//   · vídeo: POST /v1/videos/generations → {request_id}; GET /v1/videos/{request_id} → status
//     pending | done | failed; el resultado es una URL temporal en vidgen.x.ai. No hay cancelación.
// El vídeo parte de la fotografía principal como primer fotograma y se pide sin audio. El texto lo genera
// ai/text. Probado solo con respuestas simuladas que siguen la forma documentada.

export const XAI_HOSTS = ['api.x.ai'] as const
export const XAI_RESULT_HOSTS = ['vidgen.x.ai'] as const
const BASE = 'https://api.x.ai/v1'

export function createXaiAdapter(options: AdapterOptions = {}): AiProviderAdapter {
  const call = (method: 'GET' | 'POST', path: string, ctx: ProviderContext, body?: unknown, timeoutMs = TIMEOUT.submit) =>
    safeFetch(`${BASE}${path}`, { method, headers: body === undefined ? bearer(ctx.apiKey) : jsonHeaders(bearer(ctx.apiKey)), ...(body !== undefined && { body: JSON.stringify(body) }) }, { allowedHosts: XAI_HOSTS, timeoutMs, maxBytes: 48 * 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })

  return {
    verifyKey: (ctx: ProviderContext): Promise<VerifyResult> => verifyWithGet(`${BASE}/models`, bearer(ctx.apiKey), XAI_HOSTS, options, ctx, true),

    async submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult> {
      const prompt = promptText(request.prompt, 8_000)
      if (request.kind === 'poster') {
        const common = { model: request.model, prompt, n: 1, aspect_ratio: '3:4', resolution: '1k', response_format: 'b64_json' }
        const response =
          request.references.length > 0
            ? await call('POST', '/images/edits', ctx, { ...common, images: request.references.map(image => ({ url: dataUri(image) })) }, TIMEOUT.sync)
            : await call('POST', '/images/generations', ctx, common, TIMEOUT.sync)
        const json = requireJson(response, [200])
        const first = Array.isArray(json.data) ? (json.data[0] as Record<string, unknown> | undefined) : undefined
        return { operationId: 'sync', immediate: base64Image(first?.b64_json, str(first?.mime_type) ?? 'image/jpeg') }
      }
      const primary = request.references[0]
      if (!primary) throw new AiMediaError('AI_INVALID_REQUEST', 'Este modelo necesita la fotografía principal como primer fotograma.')
      const body = { model: request.model, prompt, image: { url: dataUri(primary) }, duration: request.durationSeconds, resolution: '720p', generate_audio: false }
      const json = requireJson(await call('POST', '/videos/generations', ctx, body), [200, 201, 202])
      return { operationId: operationId(json.request_id) }
    },

    async poll(ctx: ProviderContext, id: string): Promise<OperationState> {
      const response = await call('GET', `/videos/${encodeURIComponent(id)}`, ctx, undefined, TIMEOUT.poll)
      // 202: la solicitud diferida sigue pendiente.
      if (response.status === 202) return { state: 'running' }
      const json = response.json<Record<string, unknown>>()
      if (response.status !== 200 || !json) return pollFailure(response.status, json)
      if (json.status === 'pending') return { state: 'running' }
      if (json.status === 'failed') {
        // invalid_argument incluye el contenido bloqueado por moderación.
        const text = errorText(json)
        if (/invalid_argument|moderat|policy/.test(text)) return { state: 'blocked', category: 'provider_safety_block' }
        if (/permission_denied/.test(text)) return { state: 'failed', code: 'AI_PERMISSION_DENIED' }
        return { state: 'failed', code: 'AI_PROVIDER_FAILED' }
      }
      if (json.status === 'done') {
        const video = json.video as Record<string, unknown> | undefined
        const uri = str(video?.url)
        if (!uri) return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
        return { state: 'done', output: { mimeType: 'video/mp4', uri }, providerFlagged: video?.respect_moderation === false }
      }
      return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
    },

    // La documentación no ofrece cancelación: el resultado se descarta al llegar.
    cancel: async () => false,

    fetchResult: (ctx: ProviderContext, uri: string, maxBytes: number) => download(uri, XAI_RESULT_HOSTS, {}, maxBytes, options, ctx),

    moderate: noModeration('xAI'),
  }
}
