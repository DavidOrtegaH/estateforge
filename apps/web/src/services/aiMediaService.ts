import type { AiCapability, AiConnectionStatus, AiIntegrationLevel, AiJobKind, AiJobStatus, AiModelPurpose, AiModelStatus, AiModerationCategory, AiProviderKind, AiTrialKind, AiTrialStatus, AiVerificationCost } from '@estateforge/shared'

import { API_URL } from '@/lib/api'
import { fetchPrivate, MediaRequestError } from '@/services/mediaService'

// Generación con IA usando la API key del usuario (BYOK, DA-67 a DA-75). El navegador nunca llama al
// proveedor ni recibe la clave: solo habla con la API de EstateForge. La clave se envía una vez, al
// guardarla, y no se conserva en el navegador (ni en localStorage, sessionStorage ni la URL).

/** Precio publicado por el proveedor. La fuente de verdad es el registro de la API: la web no guarda precios. */
export interface AiModelPricing {
  usd: number
  unit: 'image' | 'second' | 'million-tokens'
  currency?: 'USD'
  /** confirmed: sin fecha de fin. temporary: precio publicado con fecha de fin (validUntil). */
  status?: 'confirmed' | 'temporary'
  validUntil?: string
  tokens?: { inputUsd: number; cachedInputUsd: number | null; outputUsd: number }
  /** false: depende de factores variables (calidad, megapíxeles…): no se estima un importe. */
  estimable?: boolean
  context?: string
  detail: string
  source: string
  consultedAt: string
}

export interface AiModelInfo {
  id: string
  label: string
  purpose: AiModelPurpose
  /** Fabricante del modelo (puede no ser quien sirve la API y factura). */
  maker?: string
  tier?: 'recommended' | 'alternative' | 'legacy'
  status?: AiModelStatus
  stability: string
  retiresAt?: string
  inputs?: ('text' | 'image' | 'video')[]
  outputs?: ('text' | 'image' | 'video')[]
  maxReferenceImages: number
  image?: { resolution: string; aspectRatio: string }
  video?: { durations: number[]; resolution: string; aspectRatio: string; nativeAudio: 'disabled' | 'discarded' | 'none' }
  /** false: retirado; no se puede elegir para generaciones nuevas. */
  selectable?: boolean
  pricing: AiModelPricing | null
  notes: string
}

const spanishDate = (value: string) => value.split('-').reverse().join('/')

/** Precio con su modalidad, su vigencia, su fuente y la fecha de consulta. */
export function describePricing(pricing: AiModelPricing): string {
  const validity = pricing.status === 'temporary' && pricing.validUntil ? ` Precio temporal, vigente hasta el ${spanishDate(pricing.validUntil)}.` : ''
  const context = pricing.context ? ` Modalidad: ${pricing.context}.` : ''
  return `${pricing.detail}.${validity}${context} Fuente: ${pricing.source} (consultada el ${spanishDate(pricing.consultedAt)}).`
}

export const TIER_LABELS: Record<NonNullable<AiModelInfo['tier']>, string> = { recommended: 'Recomendado', alternative: 'Alternativo', legacy: 'Heredado' }

export interface AiProviderInfo {
  id: string
  name: string
  /** direct: API del fabricante. aggregator: sirve modelos de terceros con su clave y sus tarifas. */
  kind?: AiProviderKind
  /** Cuenta a la que se factura el consumo. */
  billing?: string
  /** DA-87. free: documentada sin coste. unknown: no genera, pero la documentación no dice su coste (se pide confirmación). unsupported: no hay comprobación. */
  verificationCost?: AiVerificationCost
  /** Estado de integración (DA-88), distinto del estado documental: nunca incluye «real». */
  integration?: { contractVersion: string; levels: AiIntegrationLevel[]; realValidation: null }
  consultedAt?: string
  simulated: boolean
  description: string
  keyHelp: string
  capabilities: AiCapability[]
  models: AiModelInfo[]
  moderation: string
  links: { site?: string; docs: string; pricing: string; terms: string; privacy: string; keys: string }
  authentication?: string
  dataUse: string
  verification: string
}

export interface AiConnection {
  id: string
  provider: string
  /** Etiqueta personal; vacía en la conexión principal. */
  label: string
  keyHint: string | null
  status: AiConnectionStatus
  lastVerifiedAt: string | null
  lastErrorCode: string | null
  /** Diagnóstico de la última comprobación (DA-87), sin secretos. */
  diagnostics?: AiConnectionDiagnostics | null
  algorithm: string
  encryptionVersion: number
  createdAt: string
  updatedAt: string
}

export interface AiConnectionDiagnostics {
  checkedAt: string
  method: string
  generatesContent: false
  generationVerified: false
  capabilities: AiCapability[]
  problem?: string
  message?: string
  models?: { listedByAccount: string[]; notListedByAccount: string[]; accountTotal: number }
}

export interface AiPreference {
  provider: string
  model: string
  /** Conexión concreta, si el usuario tiene varias de ese proveedor. */
  connectionId?: string | null
  /** false: el modelo guardado ya no está en el catálogo; hay que elegir otro (no se sustituye solo). */
  available?: boolean
}

export interface AiIntegrations {
  connections: AiConnection[]
  preferences: { text: AiPreference | null; poster: AiPreference | null; video: AiPreference | null; moderation?: { provider: string; connectionId: string; available: boolean } | null; updatedAt: string | null }
  usage: { last30Days: Record<string, number>; last24Hours: number; limits: { concurrent: number; daily: number; monthly: number } }
  /** Pruebas reales superadas por el usuario, por proveedor (DA-89). */
  realTrials?: Record<string, { model: string; kind: string; completedAt: string | null; contractVersion: string }[]>
}

export interface AiJob {
  id: string
  generationId: string
  kind: AiJobKind
  provider: string
  model: string
  status: AiJobStatus
  statusLabel: string
  moderationStatus: string
  moderationCategory: AiModerationCategory | null
  message: string | null
  photoIds: string[]
  durationSeconds: number | null
  estimatedCostUsd: number | null
  resultReady: boolean
  resultContentType: string | null
  createdAt: string
  submittedAt: string | null
  completedAt: string | null
  expiresAt: string | null
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, { credentials: 'include', cache: 'no-store', ...init })
  } catch {
    throw new MediaRequestError('No se ha podido conectar con el servidor.', 0, null)
  }
  const body = (await response.json().catch(() => null)) as { message?: string; code?: string } | null
  if (!response.ok) throw new MediaRequestError(body?.message ?? 'No se ha podido completar la operación.', response.status, body?.code ?? null)
  return body as T
}

// Content-Type solo con cuerpo: Fastify rechaza (400) un JSON declarado y vacío.
const json = (method: string, body?: unknown): RequestInit => (body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const getAiProviders = async () => (await call<{ providers: AiProviderInfo[] }>('/api/ai/providers')).providers
export const getAiIntegrations = () => call<AiIntegrations>('/api/account/ai-integrations')

/** Envía la clave una sola vez (HTTPS en producción); la respuesta nunca la contiene. */
export async function saveAiKey(provider: string, apiKey: string): Promise<void> {
  await call(`/api/account/ai-keys/${encodeURIComponent(provider)}`, json('PUT', { apiKey }))
}

export const verifyAiKey = (provider: string) => call<{ provider: string; status: AiConnectionStatus; code?: string }>(`/api/account/ai-keys/${encodeURIComponent(provider)}/verify`, json('POST'))

// Conexiones por identificador (DA-83): varias cuentas del mismo proveedor, cada una con su etiqueta.
/** Envía la clave una sola vez; la respuesta nunca la contiene. */
export const createAiConnection = (provider: string, apiKey: string, label = '') => call<{ id: string; provider: string; label: string }>('/api/account/ai-connections', json('POST', { provider, label, apiKey }))
export const updateAiConnection = (id: string, changes: { apiKey?: string; label?: string }) => call<{ id: string }>(`/api/account/ai-connections/${id}`, json('PUT', changes))
export const deleteAiConnection = (id: string) => call<unknown>(`/api/account/ai-connections/${id}`, { method: 'DELETE' })
/** Comprobación sin generar contenido. acknowledgeCost: el usuario acepta hacerla aunque la documentación no indique su coste (DA-87). */
export const verifyAiConnection = (id: string, acknowledgeCost = false) =>
  call<{ provider: string; connectionId: string; status: AiConnectionStatus; code?: string; message?: string; diagnostics?: AiConnectionDiagnostics }>(`/api/account/ai-connections/${id}/verify`, json('POST', acknowledgeCost ? { acknowledgeCost: true } : undefined))

// Pruebas reales controladas (DA-89): plan, confirmación expresa y una sola operación con datos sintéticos.
export interface AiTrialTarget {
  connectionId: string
  kind: AiTrialKind
  model: string
  durationSeconds?: number
  /** Solo vídeo: resolución ofrecida por el modelo (DA-92). */
  resolution?: string
  /** Imágenes sintéticas de referencia (0 o 1). */
  references?: number
}

export interface AiCostLine {
  concept: string
  usd: number | null
  detail: string
}

export interface AiTrialPlan {
  kind: AiTrialKind
  provider: { id: string; name: string; kind: AiProviderKind; billing: string }
  model: { id: string; label: string; maker: string; status: string }
  connection: { id: string; label: string; status: AiConnectionStatus }
  durationSeconds: number | null
  resolution: string | null
  resolutionLabel: string | null
  referenceImages: number
  dataSent: string[]
  estimatedCostMicroUsd: number | null
  cost: string
  costVerifiable: boolean
  costLines: AiCostLine[]
  costKnownUsd: number
  costComplete: boolean
  priceConsultedAt: string | null
  priceStale: boolean
  moderation: { provider: string; name: string; connectionId: string; external: boolean } | null
  moderationRequired: boolean
  warnings: string[]
  contractVersion: string
}

export interface AiTrial {
  id: string
  connectionId: string | null
  provider: string
  providerName: string
  model: string
  kind: AiTrialKind
  status: AiTrialStatus
  statusLabel: string
  active: boolean
  durationSeconds: number | null
  estimatedCostUsd: number | null
  contractVersion: string
  moderationProvider: string | null
  failureCode: string | null
  message: string | null
  report: Record<string, unknown>
  createdAt: string
  submittedAt: string | null
  completedAt: string | null
}

export const planAiTrial = async (target: AiTrialTarget) => (await call<{ plan: AiTrialPlan }>('/api/account/ai-trials/plan', json('POST', target))).plan
export const createAiTrial = async (target: AiTrialTarget, plan: AiTrialPlan, idempotencyKey: string) =>
  (
    await call<{ trial: AiTrial }>(
      '/api/account/ai-trials',
      json('POST', { ...target, idempotencyKey, confirmation: { provider: plan.provider.id, model: plan.model.id, connectionId: plan.connection.id, estimatedCostMicroUsd: plan.estimatedCostMicroUsd, acceptCharges: true } }),
    )
  ).trial
export const getAiTrial = async (id: string) => (await call<{ trial: AiTrial }>(`/api/account/ai-trials/${id}`)).trial
export const cancelAiTrial = async (id: string) => (await call<{ trial: AiTrial }>(`/api/account/ai-trials/${id}/cancel`, json('POST'))).trial
export const listAiTrials = async () => (await call<{ trials: AiTrial[] }>('/api/account/ai-trials')).trials

/** Una de las seis pruebas propuestas (DA-93), con el estado de este usuario. Nunca trae claves. */
export interface AiTrialPreset {
  id: string
  title: string
  kind: AiTrialKind
  provider: string
  model: string
  capability: string
  durationSeconds?: number
  resolution?: string
  references: number
  notes: string
  providerName: string
  providerKind: AiProviderKind | null
  billing: string | null
  maker: string | null
  modelLabel: string
  modelStatus: string | null
  available: boolean
  unavailableReason: string | null
  connections: { id: string; label: string; status: AiConnectionStatus; modelNotListed: boolean }[]
  moderation: { provider: string; name: string; external: boolean } | null
  moderationRequired: boolean
  moderationMissing: boolean
  cost: { lines: AiCostLine[]; knownUsd: number; complete: boolean; priceConsultedAt: string | null; priceAgeDays: number | null; priceStale: boolean } | null
  lastTrial: AiTrial | null
}
export const getAiTrialPresets = async () => (await call<{ presets: AiTrialPreset[] }>('/api/account/ai-trials/presets')).presets

/** Consulta una prueba hasta que deja de estar en curso (el servidor sondea al proveedor como mucho cada 2 s). */
export async function pollAiTrial(id: string, onUpdate: (trial: AiTrial) => void, signal: AbortSignal, sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))): Promise<AiTrial> {
  for (;;) {
    const trial = await getAiTrial(id)
    onUpdate(trial)
    if (!trial.active || signal.aborted) return trial
    await sleep(3000)
    if (signal.aborted) return trial
  }
}

export interface AiDiscoveredModel {
  id: string
  label: string
  maker: string
  verified: false
}
/** Modelos del catálogo del agregador que la API ha validado (siempre «no verificados por EstateForge»). */
export const discoverAiModels = (connectionId: string) => call<{ provider: string; models: AiDiscoveredModel[]; note: string }>(`/api/account/ai-connections/${connectionId}/models`)
export const deleteAiKey = (provider: string) => call<unknown>(`/api/account/ai-keys/${encodeURIComponent(provider)}`, { method: 'DELETE' })
export interface AiPreferenceChoice {
  provider: string
  model: string
  connectionId?: string | null
}
export const saveAiPreferences = (preferences: { text: AiPreferenceChoice | null; poster: AiPreferenceChoice | null; video: AiPreferenceChoice | null; moderation?: { provider: string; connectionId?: string | null } | null }) =>
  call<AiIntegrations>('/api/account/ai-preferences', json('PUT', preferences))

export const listAiJobs = async (generationId: string) => (await call<{ jobs: AiJob[] }>(`/api/generations/${generationId}/ai-jobs`)).jobs
export const getAiJob = async (jobId: string) => (await call<{ job: AiJob }>(`/api/ai-jobs/${jobId}`)).job
export const cancelAiJob = async (jobId: string) => (await call<{ job: AiJob }>(`/api/ai-jobs/${jobId}/cancel`, json('POST'))).job
export const rejectAiJob = async (jobId: string) => (await call<{ job: AiJob }>(`/api/ai-jobs/${jobId}/reject`, json('POST'))).job

export interface CreateAiJobRequest {
  kind: AiJobKind
  provider: string
  model: string
  connectionId?: string
  photoIds: string[]
  durationSeconds?: number
  sourceHash: string
  expectedVersion: number
  idempotencyKey: string
  consent: true
}

export const createAiJob = async (generationId: string, request: CreateAiJobRequest) => (await call<{ job: AiJob }>(`/api/generations/${generationId}/ai-jobs`, json('POST', request))).job

/** Propuesta lista para revisión: bytes por URL firmada (sin cookies), nunca la URL del proveedor. */
export const fetchAiResult = (jobId: string, signal?: AbortSignal) => fetchPrivate(`/api/ai-jobs/${jobId}/result`, signal)

export const ACTIVE_STATUSES: readonly AiJobStatus[] = ['pending', 'submitted', 'processing', 'moderating']

/**
 * Sondea el trabajo hasta que deja de estar en curso, con espera progresiva (2 s → 10 s). No inventa
 * porcentajes: informa del estado que da la API. Se puede abandonar con signal sin cancelar el trabajo.
 */
export async function pollAiJob(jobId: string, onUpdate: (job: AiJob) => void, signal: AbortSignal, sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))): Promise<AiJob> {
  let delay = 2000
  for (;;) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const job = await getAiJob(jobId)
    onUpdate(job)
    if (!ACTIVE_STATUSES.includes(job.status)) return job
    await sleep(delay)
    delay = Math.min(10_000, Math.round(delay * 1.5))
  }
}

/** Texto de coste: precio publicado con fuente y fecha, o aviso de que no se puede estimar. */
export function describeCost(model: AiModelInfo | undefined, durationSeconds?: number): string {
  if (!model?.pricing) return 'Consultar tarifa del proveedor: no hay un precio publicado verificado para estimar el coste.'
  if (model.pricing.estimable === false) return `Precio publicado: ${model.pricing.detail} (consultado el ${model.pricing.consultedAt.split('-').reverse().join('/')}). No se puede calcular un importe por adelantado. Lo factura el proveedor en tu cuenta.`
  if (model.pricing.unit === 'million-tokens') return `Precio publicado: ${model.pricing.detail} (consultado el ${model.pricing.consultedAt.split('-').reverse().join('/')}). No se puede calcular un importe por adelantado: depende de los tokens de entrada y de salida de cada petición. Lo factura el proveedor en tu cuenta.`
  const units = model.pricing.unit === 'image' ? 1 : (durationSeconds ?? 0)
  const usd = model.pricing.usd * units
  return `Coste aproximado: ${usd.toLocaleString('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 })} (${model.pricing.detail}; consultado el ${model.pricing.consultedAt.split('-').reverse().join('/')}). Es una estimación de la generación: no incluye los tokens de entrada ni el clasificador de seguridad, que también consumen de tu cuenta. El importe definitivo lo factura el proveedor.`
}

/** Opción elegible de proveedor, modelo y conexión para un uso: solo modelos compatibles y conexiones del usuario. */
export interface AiOption {
  value: string
  provider: AiProviderInfo
  model: AiModelInfo
  connection: AiConnection
  label: string
}

export const optionValue = (provider: string, model: string, connectionId: string) => `${provider}|${model}|${connectionId}`

/**
 * Opciones para un uso (texto, cartel o vídeo). Un modelo solo aparece si GENERA ese tipo de contenido
 * (que admita imágenes de entrada no lo convierte en generador de imágenes) y sigue siendo elegible.
 */
export function aiOptions(providers: AiProviderInfo[], connections: AiConnection[], purpose: AiModelPurpose): AiOption[] {
  const output = purpose === 'poster' ? 'image' : purpose === 'video' ? 'video' : 'text'
  const options: AiOption[] = []
  for (const provider of providers) {
    const own = connections.filter(connection => connection.provider === provider.id)
    if (own.length === 0) continue
    for (const model of provider.models) {
      if (model.purpose !== purpose || model.selectable === false) continue
      if (model.outputs && !model.outputs.includes(output)) continue
      for (const connection of own) {
        const account = own.length > 1 ? ` · ${connection.label || 'principal'}` : ''
        const maker = model.maker && provider.kind === 'aggregator' ? ` · ${model.maker} vía ${provider.name}` : ` · ${provider.name}`
        options.push({ value: optionValue(provider.id, model.id, connection.id), provider, model, connection, label: `${model.label}${maker}${account}${model.tier === 'recommended' ? ' — recomendado' : model.tier === 'legacy' ? ' — heredado' : ''}` })
      }
    }
  }
  return options
}
