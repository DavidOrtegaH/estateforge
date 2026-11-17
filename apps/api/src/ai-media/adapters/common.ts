import type { BuiltPrompt, InputImage, ModerationVerdict, OperationState, ProviderContext, VerifyResult } from '../adapter.js'
import { AiMediaError } from '../errors.js'
import { untrustedBlock } from '../prompts.js'
import { safeFetch, type FetchImpl, type SafeResponse } from '../safe-fetch.js'

// Piezas comunes de los adaptadores de proveedores (DA-82). Cada adaptador fija sus hosts, su cabecera de
// autenticación, sus rutas y la forma de sus peticiones y respuestas según la documentación oficial; aquí
// solo está lo que se repite: límites, traducción de errores HTTP y validaciones de seguridad.

export interface AdapterOptions {
  fetchImpl?: FetchImpl
}

export const TIMEOUT = { verify: 15_000, submit: 60_000, sync: 110_000, poll: 30_000, download: 120_000 }
export const JSON_MAX = 64 * 1024 * 1024

export const bearer = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` })
export const jsonHeaders = (auth: Record<string, string>) => ({ ...auth, 'content-type': 'application/json' })

/** Texto del prompt: instrucciones del sistema y, aparte y marcados, los datos no confiables. */
export function promptText(prompt: BuiltPrompt, maxLength: number): string {
  const full = `${prompt.instructions}\n\n${untrustedBlock(prompt.data)}`
  if (full.length <= maxLength) return full
  // Si no cabe, se conservan las instrucciones (reglas de seguridad) y se recortan los datos.
  return prompt.instructions.slice(0, maxLength)
}

export function dataUri(image: InputImage): string {
  return `data:${image.mimeType};base64,${image.data.toString('base64')}`
}

/** Tamaño máximo que el proveedor admite para una imagen enviada como data URI. */
export function assertImageSize(images: InputImage[], maxBytes: number, providerName: string): void {
  if (images.some(image => image.data.length > maxBytes)) {
    throw new AiMediaError('AI_INVALID_REQUEST', `Una fotografía supera el tamaño que admite ${providerName} (${(maxBytes / 1024 / 1024).toFixed(1)} MB). Elige otra o usa otro proveedor.`)
  }
}

const SAFE_ID = /^[A-Za-z0-9_.:/=~-]{1,900}$/
export function operationId(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new AiMediaError('AI_INVALID_OUTPUT', 'El proveedor no ha devuelto un identificador de operación válido.')
  return value
}

/** Texto en minúsculas de los campos de error habituales (para clasificarlo; nunca se muestra). */
export function errorText(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const parts: string[] = []
  const visit = (node: unknown, depth: number) => {
    if (depth > 3 || node === null || node === undefined) return
    if (typeof node === 'string') parts.push(node)
    else if (Array.isArray(node)) node.slice(0, 5).forEach(item => visit(item, depth + 1))
    else if (typeof node === 'object') for (const key of ['error', 'code', 'type', 'name', 'message', 'detail', 'errors', 'reject_reason', 'failureCode', 'status']) if (key in (node as object)) visit((node as Record<string, unknown>)[key], depth + 1)
  }
  visit(body, 0)
  return parts.join(' ').toLowerCase().slice(0, 2000)
}

const SAFETY_WORDS = /moderat|safety|content[_ ]policy|content_filter|policy_violation|nsfw|public_figure/

/** Traduce un error HTTP del proveedor a un error controlado, sin incluir su respuesta. */
export function httpFailure(status: number, body: unknown, safetyStatuses: number[] = []): AiMediaError {
  const text = errorText(body)
  if (safetyStatuses.includes(status) || (status >= 400 && status < 500 && status !== 401 && status !== 429 && SAFETY_WORDS.test(text))) {
    return new AiMediaError('AI_PROVIDER_FAILED', 'El proveedor ha bloqueado la solicitud por sus filtros de seguridad.', 'provider_safety_block')
  }
  if (status === 401) return new AiMediaError('AI_INVALID_KEY', 'El proveedor ha rechazado la API key.')
  // 403: la clave se reconoce, pero la cuenta, el proyecto o la región no tienen permiso (DA-87).
  if (status === 403) return new AiMediaError('AI_PERMISSION_DENIED', 'El proveedor no permite esta operación a tu cuenta.')
  if (status === 402 || status === 429) return new AiMediaError('AI_PROVIDER_QUOTA', 'Sin saldo o cuota disponible en el proveedor.')
  if (status >= 400 && status < 500) return new AiMediaError('AI_PROVIDER_FAILED', 'El proveedor ha rechazado la solicitud.')
  return new AiMediaError('AI_PROVIDER_UNAVAILABLE', 'El proveedor no está disponible.')
}

/** Estado de un sondeo a partir de un error HTTP: clave rechazada o bloqueo se cierran; lo demás se reintenta. */
export function pollFailure(status: number, body: unknown, safetyStatuses: number[] = []): OperationState {
  const failure = httpFailure(status, body, safetyStatuses)
  if (failure.category === 'provider_safety_block') return { state: 'blocked', category: 'provider_safety_block' }
  if (failure.code === 'AI_INVALID_KEY' || failure.code === 'AI_PERMISSION_DENIED') return { state: 'failed', code: failure.code }
  if (status === 404) return { state: 'failed', code: 'AI_PROVIDER_FAILED' }
  throw failure
}

export function verifyResult(status: number): VerifyResult {
  if (status === 200) return { ok: true }
  if (status === 401) return { ok: false, code: 'AI_INVALID_KEY' }
  if (status === 403) return { ok: false, code: 'AI_PERMISSION_DENIED' }
  if (status === 402 || status === 429) return { ok: false, code: 'AI_PROVIDER_QUOTA' }
  return { ok: false, code: 'AI_PROVIDER_UNAVAILABLE' }
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/~-]{0,159}$/

/**
 * Identificadores de una lista de modelos ({data:[{id}]} o [{id}]). Solo identificadores con formato seguro y
 * como mucho 2000; null si la respuesta no tiene esa forma (entonces no se informa de modelos).
 */
export function modelIds(json: unknown): string[] | null {
  const data = Array.isArray(json) ? json : json && typeof json === 'object' ? (json as { data?: unknown }).data : null
  if (!Array.isArray(data)) return null
  const ids = data.slice(0, 2000).map(item => (item && typeof item === 'object' ? (item as { id?: unknown }).id : null)).filter((id): id is string => typeof id === 'string' && MODEL_ID.test(id))
  return [...new Set(ids)]
}

/**
 * Comprobación de la clave con un GET que no genera contenido. Con listModels, además, se leen los modelos
 * que la cuenta tiene disponibles (para el diagnóstico); nunca se guarda la respuesta.
 */
export async function verifyWithGet(url: string, headers: Record<string, string>, hosts: readonly string[], options: AdapterOptions, ctx: ProviderContext, listModels = false): Promise<VerifyResult> {
  try {
    const response = await safeFetch(url, { method: 'GET', headers }, { allowedHosts: hosts, timeoutMs: TIMEOUT.verify, maxBytes: 4 * 1024 * 1024, fetchImpl: options.fetchImpl, signal: ctx.signal })
    const result = verifyResult(response.status)
    if (!result.ok || !listModels) return result
    const models = modelIds(response.json())
    return models ? { ok: true, models } : result
  } catch {
    return { ok: false, code: 'AI_PROVIDER_UNAVAILABLE' }
  }
}

/** Descarga de un resultado entregado por URL: solo desde los hosts de entrega del proveedor. */
export async function download(uri: string, hosts: readonly string[], headers: Record<string, string>, maxBytes: number, options: AdapterOptions, ctx: ProviderContext): Promise<Buffer> {
  const response = await safeFetch(uri, { method: 'GET', headers }, { allowedHosts: hosts, timeoutMs: TIMEOUT.download, maxBytes, fetchImpl: options.fetchImpl, signal: ctx.signal })
  if (response.status !== 200) throw httpFailure(response.status, null)
  return response.bytes
}

export function requireJson(response: SafeResponse, okStatuses: number[], safetyStatuses: number[] = []): Record<string, unknown> {
  const json = response.json<Record<string, unknown>>()
  if (!okStatuses.includes(response.status) || !json || typeof json !== 'object') throw httpFailure(response.status, json, safetyStatuses)
  return json
}

/** Imagen en base64 devuelta por el proveedor. */
export function base64Image(value: unknown, mimeType = 'image/png'): OperationState {
  if (typeof value !== 'string' || value.length < 64) return { state: 'failed', code: 'AI_INVALID_OUTPUT' }
  return { state: 'done', output: { mimeType, data: Buffer.from(value, 'base64') }, providerFlagged: false }
}

export function noModeration(name: string): () => Promise<ModerationVerdict> {
  return async () => {
    throw new AiMediaError('MODERATION_UNAVAILABLE', `${name} no ofrece un clasificador de seguridad.`, 'moderation_unavailable')
  }
}

export function unsupported(name: string, what: string): never {
  throw new AiMediaError('AI_CAPABILITY_MISSING', `${name} no está disponible para ${what} en EstateForge.`)
}

export const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
