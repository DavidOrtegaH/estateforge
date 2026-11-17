import type { AiProviderAdapter, OperationState, ProviderContext, SubmitRequest, SubmitResult, VerifyResult } from '../adapter.js'
import { AiMediaError } from '../errors.js'
import { assertAllowedUrl, safeFetch } from '../safe-fetch.js'
import { download, jsonHeaders, noModeration, pollFailure, promptText, requireJson, str, TIMEOUT, verifyWithGet, type AdapterOptions } from './common.js'

// Black Forest Labs, FLUX (DA-82), documentación consultada el 12/11/2026 (docs.bfl.ml):
//   · comprobación: GET /v1/credits (saldo; no genera);
//   · imagen: POST /v1/flux-3-image {prompt, images (base64), aspect_ratio, resolution}
//             POST /v1/flux-2-pro {prompt, input_image, input_image_2…, width, height, output_format};
//   · vídeo: POST /v1/flux-3-video {mode:'i2v', prompt, keyframes (base64), aspect_ratio, duration,
//            resolution, generate_audio:false};
//   · todas devuelven {id, polling_url}; se sondea polling_url (hay que usar la URL devuelta) hasta
//     status Ready, con result.sample: una URL en delivery.*.bfl.ai que caduca a los 10 minutos.
// Cabecera x-key. No hay cancelación. Probado solo con respuestas simuladas.

export const BFL_HOSTS = ['api.bfl.ai', 'api.eu.bfl.ai', 'api.us.bfl.ai'] as const
/** Sondeo y entrega: BFL indica que el subdominio puede cambiar y que se admita *.bfl.ai. */
export const BFL_RESULT_HOSTS = ['.bfl.ai'] as const
const BASE = 'https://api.bfl.ai/v1'
const key = (apiKey: string) => ({ 'x-key': apiKey })

const RUNNING = new Set(['pending', 'reasoning', 'generating'])
const MODERATED = new Set(['request moderated', 'content moderated'])

export function createBflAdapter(options: AdapterOptions = {}): AiProviderAdapter {
  return {
    verifyKey: (ctx: ProviderContext): Promise<VerifyResult> => verifyWithGet(`${BASE}/credits`, key(ctx.apiKey), BFL_HOSTS, options, ctx),

    async submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult> {
      const prompt = promptText(request.prompt, 8_000)
      const images = request.references.map(image => image.data.toString('base64'))
      let path: string
      let body: Record<string, unknown>
      if (request.model === 'flux-3-image') {
        path = '/flux-3-image'
        body = { prompt, aspect_ratio: '4:5', resolution: '1k', ...(images.length > 0 && { images }) }
      } else if (request.model === 'flux-2-pro') {
        path = '/flux-2-pro'
        body = { prompt, width: 1024, height: 1280, output_format: 'png' }
        images.slice(0, 8).forEach((image, index) => {
          body[index === 0 ? 'input_image' : `input_image_${index + 1}`] = image
        })
      } else if (request.model === 'flux-3-video') {
        if (images.length === 0) throw new AiMediaError('AI_INVALID_REQUEST', 'Este modelo necesita al menos una fotografía.')
        path = '/flux-3-video'
        body = { mode: 'i2v', prompt, keyframes: images, aspect_ratio: '16:9', duration: request.durationSeconds, resolution: 'hd', generate_audio: false }
      } else {
        throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Modelo no admitido.')
      }
      const response = await safeFetch(`${BASE}${path}`, { method: 'POST', headers: jsonHeaders(key(ctx.apiKey)), body: JSON.stringify(body) }, { allowedHosts: BFL_HOSTS, timeoutMs: TIMEOUT.submit, maxBytes: 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })
      const json = requireJson(response, [200])
      const pollingUrl = str(json.polling_url)
      if (!pollingUrl || !str(json.id)) throw new AiMediaError('AI_INVALID_OUTPUT', 'El proveedor no ha devuelto un identificador de operación válido.')
      // La URL de sondeo la da el proveedor: solo se acepta si es https y de un host de BFL.
      assertAllowedUrl(pollingUrl, BFL_RESULT_HOSTS)
      return { operationId: pollingUrl }
    },

    async poll(ctx: ProviderContext, pollingUrl: string): Promise<OperationState> {
      const response = await safeFetch(pollingUrl, { method: 'GET', headers: key(ctx.apiKey) }, { allowedHosts: BFL_RESULT_HOSTS, timeoutMs: TIMEOUT.poll, maxBytes: 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })
      const json = response.json<Record<string, unknown>>()
      if (response.status !== 200 || !json) return pollFailure(response.status, json)
      const status = String(json.status ?? '').toLowerCase()
      if (RUNNING.has(status)) return { state: 'running' }
      if (MODERATED.has(status)) return { state: 'blocked', category: 'provider_safety_block' }
      if (status === 'ready') {
        const uri = str((json.result as Record<string, unknown> | undefined)?.sample)
        if (!uri) return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
        return { state: 'done', output: { mimeType: 'application/octet-stream', uri }, providerFlagged: false }
      }
      return { state: 'failed', code: 'AI_PROVIDER_FAILED' }
    },

    cancel: async () => false,

    // La entrega no lleva la clave: es una URL firmada de corta duración.
    fetchResult: (ctx: ProviderContext, uri: string, maxBytes: number) => download(uri, BFL_RESULT_HOSTS, {}, maxBytes, options, ctx),

    moderate: noModeration('Black Forest Labs'),
  }
}
