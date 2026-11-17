import { GeneratedListingSchema, type GeneratedListing } from '@estateforge/shared'

import type { TextProtocol } from '../../ai-media/catalog-types.js'
import { isAiMediaError } from '../../ai-media/errors.js'
import { safeFetch, type FetchImpl } from '../../ai-media/safe-fetch.js'
import { AIProviderError, classifyAIProviderError } from '../ai-provider.error.js'
import { usageFrom, type AIProvider, type AIUsage } from '../ai-provider.js'

// Proveedores de texto por HTTP (DA-82): Anthropic (API Messages) y los que hablan «chat completions»
// (xAI, Mistral, DeepSeek, OpenRouter y Groq). Cada uno tiene su URL fija en el catálogo (nunca la indica
// el usuario), su autenticación y su forma de pedir JSON; la respuesta se valida siempre con el esquema del
// anuncio. Sin herramientas, sin funciones, sin navegación y sin parámetros de muestreo. Una sola llamada:
// si falla, se informa (sin otro modelo, otra clave ni otro proveedor).
// Probados solo con respuestas simuladas que siguen la forma documentada (12/11/2026).

const REQUEST_TIMEOUT_MS = 40_000
const MAX_OUTPUT_TOKENS = 4_000

/** Esquema JSON del anuncio. Solo usa lo que admiten los modos estrictos de todos los proveedores. */
export const LISTING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    callToAction: { type: 'string' },
  },
  required: ['title', 'description', 'highlights', 'callToAction'],
  additionalProperties: false,
} as const

/** Para el modo JSON sin esquema: se describe la forma en el mensaje (DeepSeek exige la palabra «json»). */
export const JSON_INSTRUCTIONS =
  'Responde únicamente con un objeto JSON válido (json), sin texto antes ni después y sin bloques de código, con exactamente estas claves: "title" (string), "description" (string), "highlights" (array de strings) y "callToAction" (string). Ejemplo de forma: {"title":"…","description":"…","highlights":["…","…"],"callToAction":"…"}'

export interface TextProviderOptions {
  name: string
  apiKey: string
  model: string
  hosts: readonly string[]
  fetchImpl?: FetchImpl
}

function requireKey(name: string, apiKey: string): string {
  const key = apiKey?.trim()
  if (!key) throw new AIProviderError('AI_KEY_REQUIRED', `Configura tu API key de ${name} en Ajustes para generar con este proveedor.`)
  return key
}

/** Lo que el proveedor devolvió, reducido a lo necesario para clasificar el error (nunca se muestra). */
function failureOf(status: number, body: unknown): { status: number; code?: string; message: string } {
  const error = body && typeof body === 'object' ? ((body as Record<string, unknown>).error ?? body) : null
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {}
  const code = typeof record.code === 'string' ? record.code : typeof record.type === 'string' ? record.type : undefined
  // 402: sin saldo (DeepSeek, OpenRouter, Anthropic billing_error) → cuota agotada, no límite transitorio.
  if (status === 402) return { status, code: 'insufficient_quota', message: 'insufficient quota' }
  return { status, code, message: typeof record.message === 'string' ? record.message.slice(0, 300) : '' }
}

function parseListing(name: string, text: string | null | undefined): GeneratedListing {
  const raw = text?.trim()
  if (!raw) throw new AIProviderError('AI_PROVIDER_ERROR', `${name} no devolvió contenido.`, name)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AIProviderError('AI_PROVIDER_ERROR', `${name} devolvió una respuesta que no es JSON válido.`, name)
  }
  const validation = GeneratedListingSchema.safeParse(parsed)
  if (!validation.success) throw new AIProviderError('AI_PROVIDER_ERROR', `${name} devolvió un anuncio con un formato inválido.`, name)
  return validation.data
}

async function postJson(options: TextProviderOptions, url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  let response
  try {
    response = await safeFetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }, { allowedHosts: options.hosts, timeoutMs: REQUEST_TIMEOUT_MS, maxBytes: 2 * 1024 * 1024, fetchImpl: options.fetchImpl })
  } catch (error) {
    if (isAiMediaError(error) && error.code === 'AI_PROVIDER_UNCERTAIN') throw classifyAIProviderError(options.name, new Error('Request timed out.'))
    if (isAiMediaError(error) && error.code === 'AI_SSRF_BLOCKED') throw new AIProviderError('AI_PROVIDER_ERROR', `Destino no permitido para ${options.name}.`, options.name)
    throw new AIProviderError('AI_PROVIDER_ERROR', `No se ha podido conectar con ${options.name}.`, options.name)
  }
  const json = response.json<Record<string, unknown>>()
  if (response.status !== 200 || !json) throw classifyAIProviderError(options.name, failureOf(response.status, json))
  return json
}

export class ChatCompletionsProvider implements AIProvider {
  lastUsage?: AIUsage
  private readonly apiKey: string
  constructor(
    private readonly options: TextProviderOptions,
    private readonly protocol: Extract<TextProtocol, { protocol: 'chat-completions' }>,
  ) {
    this.apiKey = requireKey(options.name, options.apiKey)
  }

  async generate(prompt: string): Promise<GeneratedListing> {
    const { name, model } = this.options
    const strict = this.protocol.jsonMode === 'json_schema'
    const body = {
      model,
      messages: strict ? [{ role: 'user', content: prompt }] : [{ role: 'system', content: JSON_INSTRUCTIONS }, { role: 'user', content: prompt }],
      response_format: strict ? { type: 'json_schema', json_schema: { name: 'generated_listing', strict: true, schema: LISTING_JSON_SCHEMA } } : { type: 'json_object' },
      [this.protocol.maxTokensField]: MAX_OUTPUT_TOKENS,
      ...this.protocol.extraBody,
    }
    const json = await postJson(this.options, this.protocol.url, { Authorization: `Bearer ${this.apiKey}` }, body)
    const usage = json.usage as Record<string, unknown> | undefined
    this.lastUsage = usageFrom(usage?.prompt_tokens, usage?.completion_tokens)
    const choice = Array.isArray(json.choices) ? (json.choices[0] as Record<string, unknown> | undefined) : undefined
    const message = choice?.message as Record<string, unknown> | undefined
    if (choice?.finish_reason === 'content_filter' || (typeof message?.refusal === 'string' && message.refusal.length > 0)) {
      throw new AIProviderError('AI_PROVIDER_ERROR', `${name} ha rechazado generar este contenido por sus filtros de seguridad.`, name)
    }
    if (choice?.finish_reason === 'length') throw new AIProviderError('AI_PROVIDER_ERROR', `${name} ha cortado la respuesta antes de terminar.`, name)
    return parseListing(name, typeof message?.content === 'string' ? message.content : null)
  }
}

export class AnthropicProvider implements AIProvider {
  lastUsage?: AIUsage
  private readonly apiKey: string
  constructor(
    private readonly options: TextProviderOptions,
    private readonly protocol: Extract<TextProtocol, { protocol: 'anthropic-messages' }>,
  ) {
    this.apiKey = requireKey(options.name, options.apiKey)
  }

  async generate(prompt: string): Promise<GeneratedListing> {
    const { name, model } = this.options
    // Sin temperature, top_p ni top_k: la versión 2026-10-21 de la API los rechaza.
    const body = { model, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: 'user', content: prompt }], output_config: { format: { type: 'json_schema', schema: LISTING_JSON_SCHEMA } } }
    const json = await postJson(this.options, this.protocol.url, { 'x-api-key': this.apiKey, 'anthropic-version': this.protocol.version }, body)
    const usage = json.usage as Record<string, unknown> | undefined
    this.lastUsage = usageFrom(usage?.input_tokens, usage?.output_tokens)
    if (json.stop_reason === 'refusal') throw new AIProviderError('AI_PROVIDER_ERROR', `${name} ha rechazado generar este contenido por sus filtros de seguridad.`, name)
    if (json.stop_reason === 'max_tokens') throw new AIProviderError('AI_PROVIDER_ERROR', `${name} ha cortado la respuesta antes de terminar.`, name)
    const block = Array.isArray(json.content) ? (json.content as Record<string, unknown>[]).find(item => item?.type === 'text') : undefined
    return parseListing(name, typeof block?.text === 'string' ? block.text : null)
  }
}
