import type { AiProviderAdapter, InputImage, OperationState, ProviderContext, SubmitRequest, SubmitResult, VerifyResult } from '../adapter.js'
import { AiMediaError } from '../errors.js'
import { assertAllowedUrl, safeFetch } from '../safe-fetch.js'
import { assertImageSize, dataUri, download, errorText, jsonHeaders, noModeration, pollFailure, promptText, requireJson, str, TIMEOUT, verifyWithGet, type AdapterOptions } from './common.js'

// fal.ai (agregador; DA-82), documentación consultada el 12/11/2026 (fal.ai/docs y páginas de cada modelo):
//   · comprobación: GET https://api.fal.ai/v1/models/pricing?endpoint_id=… (exige una clave válida; no genera);
//   · cola: POST https://queue.fal.run/{endpoint} con la entrada del modelo → {request_id, status_url,
//     response_url, cancel_url}. Hay que usar las URL devueltas;
//   · GET status_url → IN_QUEUE | IN_PROGRESS | COMPLETED (con error y error_type si falló);
//   · GET response_url → resultado (images[].url o video.url) en fal.media; PUT cancel_url cancela.
// Cabecera Authorization: Key. Se envía X-Fal-Store-IO: 0 para que fal no guarde entradas ni salidas. Las
// fotografías viajan como data URI (los modelos las admiten; nunca una URL pública). Cada endpoint se
// registra por separado con su fabricante; la clave y la factura son de fal.ai. Probado solo con
// respuestas simuladas.

export const FAL_HOSTS = ['queue.fal.run', 'api.fal.ai'] as const
export const FAL_RESULT_HOSTS = ['fal.media', '.fal.media'] as const
const QUEUE = 'https://queue.fal.run'
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const headers = (apiKey: string) => ({ Authorization: `Key ${apiKey}`, 'X-Fal-Store-IO': '0' })

type Builder = (prompt: string, images: InputImage[], seconds: number) => Record<string, unknown>
const MODELS: Record<string, Builder> = {
  'fal-ai/flux-2': prompt => ({ prompt, image_size: { width: 1024, height: 1280 }, num_images: 1, output_format: 'png', enable_safety_checker: true }),
  'fal-ai/flux-2/edit': (prompt, images) => ({ prompt, image_urls: images.slice(0, 4).map(dataUri), image_size: { width: 1024, height: 1280 }, num_images: 1, output_format: 'png', enable_safety_checker: true }),
  'fal-ai/nano-banana-2': prompt => ({ prompt, num_images: 1, aspect_ratio: '4:5', resolution: '1K', output_format: 'png' }),
  'fal-ai/kling-video/v3/pro/image-to-video': (prompt, images, seconds) => ({ prompt, start_image_url: dataUri(images[0]), duration: String(seconds), generate_audio: false }),
  'bytedance/seedance-2.0/fast/image-to-video': (prompt, images, seconds) => ({ prompt, image_url: dataUri(images[0]), resolution: '720p', duration: String(seconds), aspect_ratio: '16:9', generate_audio: false }),
  'minimax/h3-max/image-to-video': (prompt, images, seconds) => ({ prompt, image_url: dataUri(images[0]), duration: seconds, resolution: '768P', prompt_expansion_mode: 'disabled', enable_safety_checker: true }),
}

interface Urls {
  s: string
  r: string
  c: string
}
const encode = (urls: Urls) => Buffer.from(JSON.stringify(urls)).toString('base64url')
function decode(operationId: string): Urls {
  try {
    const urls = JSON.parse(Buffer.from(operationId, 'base64url').toString('utf8')) as Urls
    for (const url of [urls.s, urls.r, urls.c]) assertAllowedUrl(url, ['queue.fal.run'])
    return urls
  } catch {
    throw new AiMediaError('AI_INVALID_OUTPUT', 'Operación no válida.')
  }
}

export function createFalAdapter(options: AdapterOptions = {}): AiProviderAdapter {
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, ctx: ProviderContext, body?: unknown, timeoutMs = TIMEOUT.poll) =>
    safeFetch(url, { method, headers: body === undefined ? headers(ctx.apiKey) : jsonHeaders(headers(ctx.apiKey)), ...(body !== undefined && { body: JSON.stringify(body) }) }, { allowedHosts: FAL_HOSTS, timeoutMs, maxBytes: 8 * 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })

  return {
    verifyKey: (ctx: ProviderContext): Promise<VerifyResult> => verifyWithGet('https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux-2', { Authorization: `Key ${ctx.apiKey}` }, FAL_HOSTS, options, ctx),

    async submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult> {
      const builder = MODELS[request.model]
      if (!builder) throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Modelo no admitido.')
      if (request.kind === 'video' && request.references.length === 0) throw new AiMediaError('AI_INVALID_REQUEST', 'Este modelo necesita la fotografía principal como primer fotograma.')
      assertImageSize(request.references, MAX_IMAGE_BYTES, 'fal.ai')
      const body = builder(promptText(request.prompt, 4_000), request.references, request.durationSeconds ?? 0)
      const json = requireJson(await call('POST', `${QUEUE}/${request.model}`, ctx, body, TIMEOUT.submit), [200, 201, 202], [422])
      const urls = { s: str(json.status_url), r: str(json.response_url), c: str(json.cancel_url) }
      if (!urls.s || !urls.r || !urls.c || !str(json.request_id)) throw new AiMediaError('AI_INVALID_OUTPUT', 'El proveedor no ha devuelto un identificador de operación válido.')
      // Las URL las da el proveedor: solo se aceptan si son https y de la cola de fal.
      for (const url of [urls.s, urls.r, urls.c]) assertAllowedUrl(url, ['queue.fal.run'])
      return { operationId: encode(urls as Urls) }
    },

    async poll(ctx: ProviderContext, id: string): Promise<OperationState> {
      const urls = decode(id)
      const status = await call('GET', urls.s, ctx)
      const state = status.json<Record<string, unknown>>()
      if (status.status !== 200 && status.status !== 202) return pollFailure(status.status, state)
      if (!state) return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
      if (state.status === 'IN_QUEUE' || state.status === 'IN_PROGRESS') return { state: 'running' }
      if (state.status !== 'COMPLETED') return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
      if (state.error || state.error_type) {
        return /content_policy|moderat/.test(errorText({ error: state.error, type: state.error_type })) ? { state: 'blocked', category: 'provider_safety_block' } : { state: 'failed', code: 'AI_PROVIDER_FAILED' }
      }
      const result = await call('GET', urls.r, ctx)
      const json = result.json<Record<string, unknown>>()
      // 422: el modelo ha rechazado la entrada (p. ej. content_policy_violation).
      if (result.status !== 200 || !json) return pollFailure(result.status, json, /content_policy/.test(errorText(json)) ? [422] : [])
      if (Array.isArray(json.has_nsfw_concepts) && json.has_nsfw_concepts.some(Boolean)) return { state: 'blocked', category: 'provider_safety_block' }
      const image = Array.isArray(json.images) ? (json.images[0] as Record<string, unknown> | undefined) : undefined
      const uri = str(image?.url) ?? str((json.video as Record<string, unknown> | undefined)?.url)
      if (!uri) return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
      return { state: 'done', output: { mimeType: 'application/octet-stream', uri }, providerFlagged: false }
    },

    async cancel(ctx: ProviderContext, id: string) {
      try {
        const response = await call('PUT', decode(id).c, ctx)
        return response.status === 200 || response.status === 202
      } catch {
        return false
      }
    },

    fetchResult: (ctx: ProviderContext, uri: string, maxBytes: number) => download(uri, FAL_RESULT_HOSTS, {}, maxBytes, options, ctx),

    moderate: noModeration('fal.ai'),
  }
}

export const FAL_MODELS = Object.keys(MODELS)
