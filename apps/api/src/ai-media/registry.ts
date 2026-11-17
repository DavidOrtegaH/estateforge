import type { AiModelPurpose } from '@estateforge/shared'

import type { AiProviderAdapter, SubmitRequest } from './adapter.js'
import { publicIntegration } from './integration.js'
import { createBflAdapter } from './adapters/bfl.adapter.js'
import { createFalAdapter } from './adapters/fal.adapter.js'
import { createIdeogramAdapter } from './adapters/ideogram.adapter.js'
import { createOpenAIAdapter } from './adapters/openai.adapter.js'
import { createRecraftAdapter } from './adapters/recraft.adapter.js'
import { createReplicateAdapter } from './adapters/replicate.adapter.js'
import { createRunwayAdapter } from './adapters/runway.adapter.js'
import { createStabilityAdapter } from './adapters/stability.adapter.js'
import { createVerifyOnlyAdapter } from './adapters/verify-only.adapter.js'
import { createXaiAdapter } from './adapters/xai.adapter.js'
import { REAL_PROVIDERS, SIMULATOR } from './catalog.js'
import { CONSULTED_AT, type ModelDefinition, type ProviderDefinition } from './catalog-types.js'
import { AiMediaError } from './errors.js'
import { createGeminiAdapter } from './gemini.adapter.js'
import { createSimulatorAdapter } from './simulator.adapter.js'

// Registro de proveedores de IA (DA-70, DA-77, DA-82): texto, carteles y vídeos. El catálogo está en
// catalog.ts; aquí se resuelven proveedores, modelos y adaptadores. No contiene ninguna clave: todas las
// operaciones usan la API key del usuario autenticado (BYOK obligatorio). No se admiten endpoints, baseURL
// ni modelos del usuario: cada adaptador llama solo a los hosts fijos de su proveedor.

export type { ModelDefinition, ModelPricing, ModelTier, ProviderDefinition, TextProtocol } from './catalog-types.js'
export const PRICING_CONSULTED_AT = CONSULTED_AT

export function simulatorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_MEDIA_SIMULATOR === '1' && env.NODE_ENV !== 'production' && env.VERCEL !== '1'
}

const adapters = new Map<string, AiProviderAdapter>()
const testAdapters = new Map<string, AiProviderAdapter>()

/** Solo pruebas: sustituye el adaptador de un proveedor (p. ej., Gemini con fetch simulado). */
export function setAdapterForTests(providerId: string, adapter: AiProviderAdapter | null): void {
  if (adapter) testAdapters.set(providerId, adapter)
  else testAdapters.delete(providerId)
}

export function listProviders(env: NodeJS.ProcessEnv = process.env): ProviderDefinition[] {
  return simulatorEnabled(env) ? [...REAL_PROVIDERS, SIMULATOR] : [...REAL_PROVIDERS]
}

export function findProvider(id: unknown, env: NodeJS.ProcessEnv = process.env): ProviderDefinition | null {
  return listProviders(env).find(provider => provider.id === id) ?? null
}

/** Proveedores de solo texto: su adaptador de medios únicamente comprueba la clave. */
const VERIFY_ONLY: Record<string, { url: string; header: 'bearer' | 'x-api-key'; extraHeaders?: Record<string, string>; listModels?: boolean } | null> = {
  anthropic: { url: 'https://api.anthropic.com/v1/models', header: 'x-api-key', extraHeaders: { 'anthropic-version': '2026-10-21' }, listModels: true },
  mistral: { url: 'https://api.mistral.ai/v1/models', header: 'bearer', listModels: true },
  deepseek: { url: 'https://api.deepseek.com/models', header: 'bearer', listModels: true },
  groq: { url: 'https://api.groq.com/openai/v1/models', header: 'bearer', listModels: true },
  // OpenRouter no documenta ninguna comprobación de una clave normal sin generar.
  openrouter: null,
}

function build(provider: ProviderDefinition): AiProviderAdapter {
  switch (provider.id) {
    case 'gemini':
      return createGeminiAdapter()
    case 'openai':
      return createOpenAIAdapter()
    case 'xai':
      return createXaiAdapter()
    case 'bfl':
      return createBflAdapter()
    case 'stability':
      return createStabilityAdapter()
    case 'ideogram':
      return createIdeogramAdapter()
    case 'recraft':
      return createRecraftAdapter()
    case 'runway':
      return createRunwayAdapter()
    case 'fal':
      return createFalAdapter()
    case 'replicate':
      return createReplicateAdapter()
    case 'simulador':
      return createSimulatorAdapter()
    default:
      return createVerifyOnlyAdapter({ name: provider.name, hosts: provider.allowedHosts, verify: VERIFY_ONLY[provider.id] ?? null })
  }
}

/**
 * Rechaza de forma explícita, antes de cualquier llamada, una petición que el catálogo no admite para ese
 * modelo (DA-88): modelo de otro uso o retirado, más referencias de las admitidas, duración no admitida o
 * duración en un cartel. Así un cambio en el catálogo o una llamada mal formada no llega al proveedor.
 */
export function assertSubmitCompatible(provider: ProviderDefinition, request: SubmitRequest): void {
  const model = provider.models.find(item => item.id === request.model && item.purpose === request.kind)
  if (!model || !isSelectable(model)) throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Ese modelo no está admitido para este uso.')
  if (request.references.length > model.maxReferenceImages) throw new AiMediaError('AI_INVALID_REQUEST', `Este modelo admite como máximo ${model.maxReferenceImages} imágenes de referencia.`)
  if (request.kind === 'video') {
    if (!model.video || !model.video.durations.includes(request.durationSeconds ?? -1)) throw new AiMediaError('AI_INVALID_REQUEST', `Duración no admitida por este modelo. Elige ${(model.video?.durations ?? []).join(', ')} segundos.`)
    if (request.resolution !== undefined && !model.video.resolutionOptions?.some(option => option.id === request.resolution)) throw new AiMediaError('AI_INVALID_REQUEST', 'Resolución no admitida por este modelo.')
  } else if (request.durationSeconds !== undefined || request.resolution !== undefined) {
    throw new AiMediaError('AI_INVALID_REQUEST', 'Un cartel no tiene duración ni resolución de vídeo.')
  }
}

/** Adaptador con la comprobación del catálogo delante de cada envío. */
export function withCatalogGuard(provider: ProviderDefinition, adapter: AiProviderAdapter): AiProviderAdapter {
  return {
    ...adapter,
    submit: async (ctx, request) => {
      assertSubmitCompatible(provider, request)
      return adapter.submit(ctx, request)
    },
  }
}

export function adapterFor(provider: ProviderDefinition): AiProviderAdapter {
  const injected = testAdapters.get(provider.id)
  if (injected) return withCatalogGuard(provider, injected)
  let adapter = adapters.get(provider.id)
  if (!adapter) {
    adapter = withCatalogGuard(provider, build(provider))
    adapters.set(provider.id, adapter)
  }
  return adapter
}

/** Capacidad que debe declarar el proveedor para un uso. */
export function capabilityFor(purpose: AiModelPurpose) {
  return purpose === 'poster' ? 'image' : purpose === 'video' ? 'video' : 'text'
}

/** Un modelo retirado o con fecha de retirada vencida no se puede elegir para generaciones nuevas. */
export function isSelectable(model: ModelDefinition, now = new Date()): boolean {
  if (model.status === 'retired') return false
  return !model.retiresAt || new Date(`${model.retiresAt}T23:59:59Z`).getTime() >= now.getTime()
}

/** Proveedor y modelo admitidos para un uso; lanza si no lo están. */
export function resolveModel(providerId: unknown, modelId: unknown, purpose: AiModelPurpose): { provider: ProviderDefinition; model: ModelDefinition } {
  const provider = findProvider(providerId)
  if (!provider) throw new AiMediaError('AI_PROVIDER_UNKNOWN', 'Proveedor de IA no disponible.')
  if (!provider.capabilities.includes(capabilityFor(purpose))) throw new AiMediaError('AI_CAPABILITY_MISSING', 'El proveedor no admite este tipo de generación.')
  const model = provider.models.find(item => item.id === modelId && item.purpose === purpose)
  if (!model) throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Ese modelo no está admitido para este uso.')
  // Un modelo que solo analiza imágenes o vídeo no genera imágenes ni vídeo.
  const output = purpose === 'poster' ? 'image' : purpose === 'video' ? 'video' : 'text'
  if (!model.outputs.includes(output)) throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Ese modelo no genera este tipo de contenido.')
  if (!isSelectable(model)) throw new AiMediaError('AI_MODEL_NOT_ALLOWED', 'Ese modelo se ha retirado. Elige otro.')
  return { provider, model }
}

/** Coste estimado en micro-dólares (null si no hay precio publicado o no se puede calcular). */
/**
 * Precio vigente de un modelo. Un precio temporal deja de valer al día siguiente de su fecha de fin:
 * desde entonces no se muestra ni se usa para estimar (se indica «Consultar tarifa del proveedor»).
 */
export function activePricing(model: ModelDefinition, now: Date = new Date()): ModelDefinition['pricing'] {
  const pricing = model.pricing
  if (!pricing) return null
  if (pricing.status === 'temporary' && pricing.validUntil && now.toISOString().slice(0, 10) > pricing.validUntil) return null
  return pricing
}

export function estimateCostMicroUsd(model: ModelDefinition, durationSeconds?: number, now: Date = new Date()): number | null {
  const pricing = activePricing(model, now)
  if (!pricing || pricing.estimable === false) return null
  if (pricing.unit === 'million-tokens') return null
  const units = pricing.unit === 'image' ? 1 : (durationSeconds ?? 0)
  return Math.round(pricing.usd * units * 1_000_000)
}

/** Información pública del registro (sin patrones de clave, hosts ni protocolos internos). */
export function publicProvider(provider: ProviderDefinition, now: Date = new Date()) {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    billing: provider.billing,
    simulated: provider.simulated,
    description: provider.description,
    keyHelp: provider.keyHelp,
    authentication: provider.authentication,
    capabilities: provider.capabilities,
    models: provider.models.map(model => ({ ...model, pricing: activePricing(model, now), selectable: isSelectable(model) })),
    moderation: provider.moderation,
    links: provider.links,
    dataUse: provider.dataUse,
    verification: provider.verification,
    verificationCost: provider.verificationCost,
    consultedAt: provider.consultedAt,
    integration: publicIntegration(provider),
  }
}
