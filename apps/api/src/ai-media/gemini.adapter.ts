import { AI_MODERATION_CATEGORIES, type AiModerationCategory } from '@estateforge/shared'
import { z } from 'zod'

import type { AiProviderAdapter, InputImage, ModerationRequest, ModerationVerdict, OperationState, ProviderContext, SubmitRequest, VerifyResult } from './adapter.js'
import { AiMediaError } from './errors.js'
import { buildModerationInstructions, untrustedBlock } from './prompts.js'
import { safeFetch, type FetchImpl } from './safe-fetch.js'

// Adaptador de Google Gemini (DA-70), API Interactions (documentación consultada el 11/11/2026):
//   POST {BASE}/interactions · GET {BASE}/interactions/{id} · POST {BASE}/interactions/{id}/cancel
//   GET  {BASE}/models/{model} (comprobación de la clave sin generar contenido)
// La clave va solo en la cabecera x-goog-api-key, nunca en la URL. Los filtros de seguridad se piden en
// su umbral más estricto en todas las categorías (por defecto están desactivados en los modelos 2.5 y
// posteriores). Ninguna llamada habilita herramientas, código, navegación ni funciones.
//
// IMPORTANTE: este adaptador se ha probado con respuestas simuladas que siguen la forma documentada
// (pruebas de contrato). No se ha llamado al servicio real (no autorizado): queda pendiente verificarlo
// con la API key de un usuario.

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_HOSTS = ['generativelanguage.googleapis.com'] as const
/** Versión de la API Interactions de los ejemplos oficiales. */
export const GEMINI_API_REVISION = '2026-05-20'
export const GEMINI_MODERATION_MODEL = 'gemini-3.5-flash-lite'

const SAFETY_SETTINGS = ['harassment', 'hate_speech', 'sexually_explicit', 'dangerous_content', 'jailbreak'].map(type => ({ type, threshold: 'block_low_and_above' }))
/** Códigos de error con los que el proveedor indica un bloqueo por seguridad. */
const SAFETY_CODES = new Set(['safety', 'jailbreak', 'prohibited_content', 'blocklist', 'image_safety', 'recitation'])

const TIMEOUT = { verify: 15_000, submit: 60_000, poll: 30_000, moderate: 90_000, download: 120_000 }
const JSON_MAX = 64 * 1024 * 1024

const VerdictSchema = z.object({ allowed: z.boolean(), categories: z.array(z.string()).max(20) }).strict()

export interface GeminiAdapterOptions {
  fetchImpl?: FetchImpl
}

function headers(apiKey: string, json = true): Record<string, string> {
  return { 'x-goog-api-key': apiKey, 'Api-Revision': GEMINI_API_REVISION, ...(json && { 'content-type': 'application/json' }) }
}

function imagePart(image: InputImage) {
  return { type: 'image', mime_type: image.mimeType, data: image.data.toString('base64') }
}

/** Códigos, estados y motivos de error de una interacción o de una respuesta de error (en minúsculas). */
function errorCodes(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  const errors = Array.isArray(record.errors) ? record.errors : record.error ? [record.error] : []
  const codes: string[] = []
  for (const error of errors) {
    if (!error || typeof error !== 'object') continue
    const e = error as Record<string, unknown>
    for (const field of [e.code, e.status, e.reason]) if (typeof field === 'string') codes.push(field.toLowerCase())
    if (Array.isArray(e.details)) for (const detail of e.details) if (detail && typeof (detail as Record<string, unknown>).reason === 'string') codes.push(String((detail as Record<string, unknown>).reason).toLowerCase())
    if (typeof e.message === 'string' && /^input blocked/i.test(e.message)) codes.push('safety')
  }
  return codes
}

function errorCode(body: unknown): string | null {
  const codes = errorCodes(body)
  return codes.find(code => SAFETY_CODES.has(code)) ?? codes[0] ?? null
}

function httpFailure(status: number, body: unknown): AiMediaError {
  const codes = errorCodes(body)
  if (codes.some(code => SAFETY_CODES.has(code))) return new AiMediaError('AI_PROVIDER_FAILED', 'El proveedor ha bloqueado la solicitud por sus filtros de seguridad.', 'provider_safety_block')
  if (status === 401 || codes.some(code => ['api_key_invalid', 'unauthenticated'].includes(code))) return new AiMediaError('AI_INVALID_KEY', 'El proveedor ha rechazado la API key.')
  // 403 PERMISSION_DENIED: la clave existe, pero el proyecto no tiene permiso o la API no está habilitada (DA-87).
  if (status === 403 || codes.includes('permission_denied')) return new AiMediaError('AI_PERMISSION_DENIED', 'El proveedor no permite esta operación a tu cuenta.')
  if (status === 429 || codes.includes('resource_exhausted')) return new AiMediaError('AI_PROVIDER_QUOTA', 'Sin cuota disponible en el proveedor.')
  if (status === 400 && codes.includes('invalid_argument')) return new AiMediaError('AI_PROVIDER_FAILED', 'El proveedor ha rechazado los parámetros de la solicitud.')
  return new AiMediaError('AI_PROVIDER_UNAVAILABLE', 'El proveedor no está disponible.')
}

/** Busca en la interacción el primer contenido del tipo indicado (forma REST: steps → content). */
export function findContent(interaction: unknown, type: 'image' | 'video' | 'text'): Record<string, unknown> | null {
  const seen = new Set<unknown>()
  const walk = (node: unknown): Record<string, unknown> | null => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item)
        if (found) return found
      }
      return null
    }
    const record = node as Record<string, unknown>
    if (record.type === type && (typeof record.data === 'string' || typeof record.uri === 'string' || typeof record.text === 'string')) return record
    // Solo se recorren las salidas del modelo, nunca la entrada del usuario.
    for (const key of ['output_image', 'output_video', 'output_text', 'outputs', 'steps', 'content']) {
      if (key in record) {
        const found = walk(record[key])
        if (found) return found
      }
    }
    return null
  }
  const record = interaction as Record<string, unknown>
  // Con pasos, solo cuentan los de salida del modelo (nunca la entrada del usuario).
  if (Array.isArray(record?.steps)) return walk((record.steps as Record<string, unknown>[]).filter(step => step?.type === 'model_output'))
  return walk(interaction)
}

function usageOf(interaction: Record<string, unknown>) {
  const usage = interaction.usage as Record<string, unknown> | undefined
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  return usage ? { inputTokens: num(usage.total_input_tokens ?? usage.input_tokens), outputTokens: num(usage.total_output_tokens ?? usage.output_tokens) } : undefined
}

export function createGeminiAdapter(options: GeminiAdapterOptions = {}): AiProviderAdapter {
  const call = (path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal, maxBytes = JSON_MAX) =>
    safeFetch(`${GEMINI_BASE}${path}`, init, { allowedHosts: GEMINI_HOSTS, timeoutMs, maxBytes, fetchImpl: options.fetchImpl, signal })

  return {
    async verifyKey(ctx: ProviderContext): Promise<VerifyResult> {
      try {
        const response = await call(`/models/${GEMINI_MODERATION_MODEL}`, { method: 'GET', headers: headers(ctx.apiKey, false) }, TIMEOUT.verify, ctx.signal, 256 * 1024)
        if (response.status === 200) return { ok: true }
        const failure = httpFailure(response.status, response.json())
        return { ok: false, code: failure.code === 'AI_INVALID_KEY' || failure.code === 'AI_PERMISSION_DENIED' || failure.code === 'AI_PROVIDER_QUOTA' ? failure.code : 'AI_PROVIDER_UNAVAILABLE' }
      } catch {
        return { ok: false, code: 'AI_PROVIDER_UNAVAILABLE' }
      }
    },

    async submit(ctx: ProviderContext, request: SubmitRequest) {
      const input = [{ type: 'text', text: `${request.prompt.instructions}\n\n${untrustedBlock(request.prompt.data)}` }, ...request.references.map(imagePart)]
      const responseFormat =
        request.kind === 'poster'
          ? { type: 'image', aspect_ratio: '4:5', image_size: '1K' }
          : { type: 'video', aspect_ratio: '16:9', duration: `${request.durationSeconds}s` }
      const body = { model: request.model, input, response_format: responseFormat, safety_settings: SAFETY_SETTINGS, background: true }
      const response = await call('/interactions', { method: 'POST', headers: headers(ctx.apiKey), body: JSON.stringify(body) }, TIMEOUT.submit, ctx.signal, 1024 * 1024)
      const json = response.json<Record<string, unknown>>()
      if (response.status !== 200 || !json) throw httpFailure(response.status, json)
      if (typeof json.id !== 'string' || !/^[A-Za-z0-9_.:/-]{1,256}$/.test(json.id)) throw new AiMediaError('AI_INVALID_OUTPUT', 'El proveedor no ha devuelto un identificador de operación válido.')
      return { operationId: json.id }
    },

    async poll(ctx: ProviderContext, operationId: string): Promise<OperationState> {
      const response = await call(`/interactions/${encodeURIComponent(operationId)}`, { method: 'GET', headers: headers(ctx.apiKey, false) }, TIMEOUT.poll, ctx.signal)
      const json = response.json<Record<string, unknown>>()
      if (response.status !== 200 || !json) {
        const failure = httpFailure(response.status, json)
        if (failure.category === 'provider_safety_block') return { state: 'blocked', category: 'provider_safety_block' }
        if (failure.code === 'AI_INVALID_KEY' || failure.code === 'AI_PERMISSION_DENIED') return { state: 'failed', code: failure.code }
        throw failure
      }
      switch (json.status) {
        case 'queued':
        case 'in_progress':
        case 'requires_action':
          return { state: 'running' }
        case 'cancelled':
          return { state: 'cancelled' }
        case 'completed': {
          const content = findContent(json, 'image') ?? findContent(json, 'video')
          if (!content) return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
          const mimeType = typeof content.mime_type === 'string' ? content.mime_type : content.type === 'image' ? 'image/png' : 'video/mp4'
          const data = typeof content.data === 'string' ? Buffer.from(content.data, 'base64') : undefined
          const uri = typeof content.uri === 'string' ? content.uri : undefined
          if (!data && !uri) return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
          return { state: 'done', output: { mimeType, data, uri }, providerFlagged: false, usage: usageOf(json) }
        }
        default: {
          const code = errorCode(json)
          if (code && SAFETY_CODES.has(code)) return { state: 'blocked', category: 'provider_safety_block' }
          if (code === 'resource_exhausted' || json.status === 'budget_exceeded') return { state: 'failed', code: 'AI_PROVIDER_QUOTA' }
          return { state: 'failed', code: 'AI_PROVIDER_FAILED' }
        }
      }
    },

    async cancel(ctx: ProviderContext, operationId: string) {
      try {
        const response = await call(`/interactions/${encodeURIComponent(operationId)}/cancel`, { method: 'POST', headers: headers(ctx.apiKey), body: '{}' }, TIMEOUT.poll, ctx.signal, 1024 * 1024)
        return response.status === 200
      } catch {
        return false
      }
    },

    async fetchResult(ctx: ProviderContext, uri: string, maxBytes: number) {
      // Solo hosts del registro, sin redirecciones; la clave va en la cabecera.
      const response = await safeFetch(uri, { method: 'GET', headers: headers(ctx.apiKey, false) }, { allowedHosts: GEMINI_HOSTS, timeoutMs: TIMEOUT.download, maxBytes, fetchImpl: options.fetchImpl, signal: ctx.signal })
      if (response.status !== 200) throw httpFailure(response.status, response.json())
      return response.bytes
    },

    async moderate(ctx: ProviderContext, request: ModerationRequest): Promise<ModerationVerdict> {
      const input: unknown[] = [{ type: 'text', text: untrustedBlock({ material: request.kind, ...request.text }) }]
      for (const image of request.images ?? []) input.push(imagePart(image))
      if (request.video) input.push({ type: 'video', mime_type: request.video.mimeType, data: request.video.data.toString('base64') })
      const body = {
        model: GEMINI_MODERATION_MODEL,
        system_instruction: buildModerationInstructions(request.stage, request.kind),
        input,
        response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object', properties: { allowed: { type: 'boolean' }, categories: { type: 'array', items: { type: 'string' } } }, required: ['allowed', 'categories'] } },
        safety_settings: SAFETY_SETTINGS,
      }
      let response
      try {
        response = await call('/interactions', { method: 'POST', headers: headers(ctx.apiKey), body: JSON.stringify(body) }, TIMEOUT.moderate, ctx.signal, 1024 * 1024)
      } catch {
        throw new AiMediaError('MODERATION_UNAVAILABLE', 'No se ha podido completar la comprobación de seguridad.', 'moderation_unavailable')
      }
      const json = response.json<Record<string, unknown>>()
      if (response.status !== 200 || !json) {
        // Si el filtro del propio proveedor bloquea la entrada del clasificador, el contenido no se acepta.
        const code = errorCode(json)
        if (code && SAFETY_CODES.has(code)) return { allowed: false, categories: ['provider_safety_block'] }
        throw new AiMediaError('MODERATION_UNAVAILABLE', 'No se ha podido completar la comprobación de seguridad.', 'moderation_unavailable')
      }
      const text = findContent(json, 'text')?.text
      let parsed: z.infer<typeof VerdictSchema> | null = null
      try {
        parsed = typeof text === 'string' ? VerdictSchema.parse(JSON.parse(text)) : null
      } catch {
        parsed = null
      }
      if (!parsed) throw new AiMediaError('MODERATION_UNAVAILABLE', 'La comprobación de seguridad no ha devuelto un resultado válido.', 'moderation_unavailable')
      const known = parsed.categories.filter((c): c is AiModerationCategory => (AI_MODERATION_CATEGORIES as readonly string[]).includes(c))
      // Fallo seguro: cualquier categoría (también desconocida) o allowed=false bloquea.
      if (!parsed.allowed || parsed.categories.length > 0) return { allowed: false, categories: known.length ? known : ['off_topic'] }
      return { allowed: true, categories: [] }
    },
  }
}
