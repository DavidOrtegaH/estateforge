import type { AiProviderAdapter, OperationState, ProviderContext, SubmitRequest, SubmitResult, VerifyResult } from '../adapter.js'
import { AiMediaError } from '../errors.js'
import { safeFetch } from '../safe-fetch.js'
import { assertImageSize, bearer, dataUri, download, jsonHeaders, noModeration, operationId, pollFailure, promptText, requireJson, str, TIMEOUT, verifyWithGet, type AdapterOptions } from './common.js'

// Runway (agregador; DA-82). Documentación consultada el 12/11/2026 (docs.dev.runwayml.com) y esquemas
// exactos del SDK oficial runwayml/sdk-node (generado del OpenAPI de Runway):
//   · comprobación: GET /v1/organization (saldo de créditos; no genera);
//   · vídeo: POST /v1/image_to_video; imagen: POST /v1/text_to_image. Ambas devuelven {id};
//   · GET /v1/tasks/{id}: PENDING | THROTTLED | RUNNING | SUCCEEDED (output: URL[]) | FAILED (failureCode) | CANCELLED;
//   · DELETE /v1/tasks/{id} cancela.
// Cabeceras: Authorization: Bearer y X-Runway-Version. Las fotografías viajan como data URI (máx. 5 MB
// codificados), nunca como URL pública. Cada modelo se registra por separado con su fabricante real y
// con los parámetros que su esquema admite; la clave y la factura son de Runway. Las salidas caducan en
// 24-48 h y su host no está garantizado por la documentación (ejemplo: cloudfront.net): solo se descarga
// de los hosts del registro. Probado solo con respuestas simuladas.

export const RUNWAY_HOSTS = ['api.dev.runwayml.com'] as const
export const RUNWAY_RESULT_HOSTS = ['.cloudfront.net', '.runwayml.com'] as const
export const RUNWAY_VERSION = '2024-11-06'
const BASE = 'https://api.dev.runwayml.com/v1'
/** 5 MB codificados en base64 ≈ 3,6 MB binarios. */
const MAX_IMAGE_BYTES = 3.6 * 1024 * 1024

const headers = (apiKey: string) => ({ ...bearer(apiKey), 'X-Runway-Version': RUNWAY_VERSION })

type VideoBody = (seconds: number, resolution?: string) => Record<string, unknown>
/** Parámetros fijos de cada modelo de vídeo (image_to_video), según su esquema. short: prompt de hasta 1000 caracteres. */
const VIDEO: Record<string, { short?: boolean; body: VideoBody }> = {
  'gen4.5': { short: true, body: duration => ({ ratio: '1280:720', duration }) },
  'veo3.1': { short: true, body: duration => ({ ratio: '1280:720', duration, audio: false }) },
  'veo3.1_fast': { short: true, body: duration => ({ ratio: '1280:720', duration, audio: false }) },
  'kling3.0_standard': { body: duration => ({ ratio: '1280:720', duration, audio: false }) },
  'kling3.0_pro': { body: duration => ({ ratio: '1920:1080', duration, audio: false }) },
  kling_4: { body: duration => ({ ratio: 'auto_720p', duration }) },
  seedance2_fast: { body: duration => ({ ratio: '1280:720', duration, audio: false }) },
  seedance2_5: { body: duration => ({ ratio: '1280:720', duration, audio: false }) },
  hailuo3: { body: duration => ({ ratio: '16:9', resolution: '768p', duration }) },
  wan3: { body: duration => ({ ratio: 'auto_720p', duration, audio: false }) },
  grok_imagine_1_5: { body: duration => ({ resolution: '720p', duration }) },
  // La relación fija el tamaño: 640:360 es 360p y 1280:720 es 720p (DA-92). Sin campo audio: Runway lo rechaza.
  'gemini_omni_flash_1.2': { body: (duration, resolution) => ({ ratio: resolution === '360p' ? '640:360' : '1280:720', duration }) },
}
/** Parámetros fijos de cada modelo de imagen (text_to_image). */
const IMAGE: Record<string, { short?: boolean; maxReferences: number; body: Record<string, unknown> }> = {
  gen4_image: { short: true, maxReferences: 3, body: { ratio: '1080:1440' } },
  'nano_banana_2.1': { maxReferences: 14, body: { ratio: '848:1264' } },
  seedream5_pro: { maxReferences: 3, body: { ratio: '896:1184' } },
  gpt_image_2_6_flare: { maxReferences: 16, body: { ratio: 'auto', quality: 'medium' } },
  grok_imagine_image_2: { maxReferences: 3, body: { ratio: '864:1152', quality: 'medium' } },
}

export function createRunwayAdapter(options: AdapterOptions = {}): AiProviderAdapter {
  const call = (method: 'GET' | 'POST' | 'DELETE', path: string, ctx: ProviderContext, body?: unknown, timeoutMs = TIMEOUT.submit) =>
    safeFetch(`${BASE}${path}`, { method, headers: body === undefined ? headers(ctx.apiKey) : jsonHeaders(headers(ctx.apiKey)), ...(body !== undefined && { body: JSON.stringify(body) }) }, { allowedHosts: RUNWAY_HOSTS, timeoutMs, maxBytes: 4 * 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })

  return {
    verifyKey: (ctx: ProviderContext): Promise<VerifyResult> => verifyWithGet(`${BASE}/organization`, headers(ctx.apiKey), RUNWAY_HOSTS, options, ctx),

    async submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult> {
      assertImageSize(request.references, MAX_IMAGE_BYTES, 'Runway')
      let path: string
      let body: Record<string, unknown>
      if (request.kind === 'video') {
        const spec = VIDEO[request.model]
        if (!spec) throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Modelo no admitido.')
        const primary = request.references[0]
        if (!primary) throw new AiMediaError('AI_INVALID_REQUEST', 'Este modelo necesita la fotografía principal como primer fotograma.')
        path = '/image_to_video'
        body = { model: request.model, promptImage: dataUri(primary), promptText: spec.short ? request.prompt.compact : promptText(request.prompt, 4_000), ...spec.body(request.durationSeconds ?? 0, request.resolution) }
      } else {
        const spec = IMAGE[request.model]
        if (!spec) throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Modelo no admitido.')
        const references = request.references.slice(0, spec.maxReferences).map(image => ({ uri: dataUri(image) }))
        path = '/text_to_image'
        body = { model: request.model, promptText: spec.short ? request.prompt.compact : promptText(request.prompt, 3_500), ...spec.body, ...(references.length > 0 && { referenceImages: references }) }
      }
      const json = requireJson(await call('POST', path, ctx, body), [200, 201])
      return { operationId: operationId(json.id) }
    },

    async poll(ctx: ProviderContext, id: string): Promise<OperationState> {
      const response = await call('GET', `/tasks/${encodeURIComponent(id)}`, ctx, undefined, TIMEOUT.poll)
      const json = response.json<Record<string, unknown>>()
      if (response.status !== 200 || !json) return pollFailure(response.status, json)
      switch (json.status) {
        case 'PENDING':
        case 'THROTTLED':
        case 'RUNNING':
          return { state: 'running' }
        case 'CANCELLED':
          return { state: 'cancelled' }
        case 'SUCCEEDED': {
          const uri = Array.isArray(json.output) ? str(json.output[0]) : null
          if (!uri) return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
          return { state: 'done', output: { mimeType: 'application/octet-stream', uri }, providerFlagged: false }
        }
        case 'FAILED': {
          const code = String(json.failureCode ?? '')
          // SAFETY.INPUT.*, SAFETY.OUTPUT.* e INPUT_PREPROCESSING.SAFETY.*: moderación de Runway.
          if (/SAFETY/.test(code)) return { state: 'blocked', category: 'provider_safety_block' }
          return { state: 'failed', code: 'AI_PROVIDER_FAILED' }
        }
        default:
          return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
      }
    },

    async cancel(ctx: ProviderContext, id: string) {
      try {
        const response = await call('DELETE', `/tasks/${encodeURIComponent(id)}`, ctx, undefined, TIMEOUT.poll)
        return response.status === 204 || response.status === 200
      } catch {
        return false
      }
    },

    // La URL de salida va firmada (?_jwt=…): no lleva la clave.
    fetchResult: (ctx: ProviderContext, uri: string, maxBytes: number) => download(uri, RUNWAY_RESULT_HOSTS, {}, maxBytes, options, ctx),

    moderate: noModeration('Runway'),
  }
}

export const RUNWAY_VIDEO_MODELS = Object.keys(VIDEO)
export const RUNWAY_IMAGE_MODELS = Object.keys(IMAGE)
