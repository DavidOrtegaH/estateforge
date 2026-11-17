import type { AiProviderAdapter, ProviderContext, SubmitRequest, SubmitResult, VerifyResult } from '../adapter.js'
import { AiMediaError } from '../errors.js'
import { safeFetch } from '../safe-fetch.js'
import { download, jsonHeaders, noModeration, promptText, requireJson, str, TIMEOUT, unsupported, verifyResult, type AdapterOptions } from './common.js'

// Ideogram (DA-82), documentación consultada el 12/11/2026 (developer.ideogram.ai, API v2):
//   · imagen: POST /v2/image/generate/ideogram-4-5 {prompt, size, num_images, magic_prompt}. Síncrono:
//     data[] {url (nula si no es segura), is_image_safe}. Los enlaces caducan;
//   · comprobación: la misma ruta con ?dry_run=true, que devuelve un presupuesto sin generar ni cobrar
//     (no existe un endpoint de cuenta).
// Cabecera Api-Key. Solo texto a imagen. El host de las URL de resultado no consta para la v2: solo se
// descarga de ideogram.ai y sus subdominios. Probado solo con respuestas simuladas.

export const IDEOGRAM_HOSTS = ['api.ideogram.ai'] as const
export const IDEOGRAM_RESULT_HOSTS = ['ideogram.ai', '.ideogram.ai'] as const
const URL = 'https://api.ideogram.ai/v2/image/generate/ideogram-4-5'
const key = (apiKey: string) => ({ 'Api-Key': apiKey })

export function createIdeogramAdapter(options: AdapterOptions = {}): AiProviderAdapter {
  const post = (url: string, body: unknown, timeoutMs: number, ctx: ProviderContext) =>
    safeFetch(url, { method: 'POST', headers: jsonHeaders(key(ctx.apiKey)), body: JSON.stringify(body) }, { allowedHosts: IDEOGRAM_HOSTS, timeoutMs, maxBytes: 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })

  return {
    async verifyKey(ctx: ProviderContext): Promise<VerifyResult> {
      try {
        const response = await post(`${URL}?dry_run=true`, { prompt: 'abstract background', size: '1024x1024', num_images: 1, magic_prompt: 'off' }, TIMEOUT.verify, ctx)
        return verifyResult(response.status)
      } catch {
        return { ok: false, code: 'AI_PROVIDER_UNAVAILABLE' }
      }
    },

    async submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult> {
      if (request.kind !== 'poster') return unsupported('Ideogram', 'vídeo')
      if (request.model !== 'ideogram-4-5') throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Modelo no admitido.')
      const response = await post(URL, { prompt: promptText(request.prompt, 8_000), size: '1024x1024', num_images: 1, magic_prompt: 'off' }, TIMEOUT.sync, ctx)
      // 422: el prompt no ha pasado la comprobación de seguridad.
      const json = requireJson(response, [200], [422])
      const first = Array.isArray(json.data) ? (json.data[0] as Record<string, unknown> | undefined) : undefined
      if (!first) return { operationId: 'sync', immediate: { state: 'failed', code: 'AI_INVALID_OUTPUT' } }
      if (first.is_image_safe === false) return { operationId: 'sync', immediate: { state: 'blocked', category: 'provider_safety_block' } }
      const uri = str(first.url)
      if (!uri) return { operationId: 'sync', immediate: { state: 'failed', code: 'AI_INVALID_OUTPUT' } }
      return { operationId: 'sync', immediate: { state: 'done', output: { mimeType: 'application/octet-stream', uri }, providerFlagged: false } }
    },

    poll: async () => unsupported('Ideogram', 'operaciones asíncronas'),
    cancel: async () => false,
    fetchResult: (ctx: ProviderContext, uri: string, maxBytes: number) => download(uri, IDEOGRAM_RESULT_HOSTS, {}, maxBytes, options, ctx),
    moderate: noModeration('Ideogram'),
  }
}
