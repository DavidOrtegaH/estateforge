import type { AiCapability, AiModelPurpose, AiModelStatus, AiProviderId, AiProviderKind, AiVerificationCost } from '@estateforge/shared'

// Tipos del catálogo de proveedores de IA (DA-70, DA-78, DA-82). El catálogo vive solo en la API.

export interface ModelPricing {
  /** Dólares por unidad, según la página oficial de precios. En tokens, el precio de entrada. */
  usd: number
  unit: 'image' | 'second' | 'million-tokens'
  currency: 'USD'
  /** confirmed: precio publicado sin fecha de fin. temporary: precio publicado con fecha de fin (validUntil). */
  status: 'confirmed' | 'temporary'
  /** Último día de un precio temporal (AAAA-MM-DD). */
  validUntil?: string
  /** Solo para precios por tokens. cachedInputUsd es null si la página no lo publica. */
  tokens?: { inputUsd: number; cachedInputUsd: number | null; outputUsd: number }
  /** false: el precio depende de factores que EstateForge no controla (calidad, megapíxeles…); no se estima un importe. */
  estimable?: boolean
  /** Modalidad a la que corresponde el precio (plan, tipo de proceso, resolución). */
  context: string
  detail: string
  source: string
  /** Fecha en que se consultó la fuente (AAAA-MM-DD). */
  consultedAt: string
  /** Coste adicional por imagen de referencia enviada (0: el proveedor dice que no añade nada; null o ausente: no publicado). */
  referenceUsd?: number | null
  /** Importe mínimo que cobra el proveedor por petición, si lo publica. */
  minimumUsd?: number
}

/** recommended: opción propuesta por EstateForge. alternative: otra opción válida. legacy: se conserva por compatibilidad. */
export type ModelTier = 'recommended' | 'alternative' | 'legacy'
export type Modality = 'text' | 'image' | 'video'

export interface ModelDefinition {
  /** Identificador exacto que se envía a la API del proveedor (y el que guarda EstateForge). */
  id: string
  label: string
  /** Fabricante del modelo; puede no coincidir con el proveedor que sirve la API y factura. */
  maker: string
  purpose: AiModelPurpose
  tier: ModelTier
  /** Estado según la documentación del proveedor. «unknown» si no lo indica: nunca se presume estable. */
  status: AiModelStatus
  stability: string
  /** Fecha de retirada anunciada (AAAA-MM-DD), si existe. */
  retiresAt?: string
  /** Modalidades de entrada que EstateForge envía a este modelo. */
  inputs: Modality[]
  /** Lo que genera. Un modelo que solo analiza imágenes no figura como generador de imágenes. */
  outputs: Modality[]
  /** Fotografías de referencia que EstateForge puede enviar. 0: solo texto. */
  maxReferenceImages: number
  /** Solo carteles. */
  image?: { resolution: string; aspectRatio: string }
  /** Solo vídeo. nativeAudio: disabled (se pide sin audio) o discarded (el modelo siempre genera audio y EstateForge lo descarta). */
  video?: {
    durations: number[]
    resolution: string
    aspectRatio: string
    nativeAudio: 'disabled' | 'discarded' | 'none'
    /** Resoluciones que se pueden pedir con su precio por segundo publicado (DA-92). Sin ellas, solo `resolution`. */
    resolutionOptions?: { id: string; label: string; usdPerSecond: number }[]
  }
  pricing: ModelPricing | null
  notes: string
}

export type TextProtocol =
  | { protocol: 'openai-responses' }
  | { protocol: 'gemini-sdk' }
  | { protocol: 'anthropic-messages'; url: string; version: string }
  | {
      protocol: 'chat-completions'
      url: string
      /** json_schema: salida estructurada estricta. json_object: modo JSON; el esquema se describe en el mensaje y se valida en la API. */
      jsonMode: 'json_schema' | 'json_object'
      maxTokensField: 'max_tokens' | 'max_completion_tokens'
      /** Campos fijos adicionales del cuerpo (definidos por el servidor, nunca por el usuario). */
      extraBody?: Record<string, unknown>
    }
  | { protocol: 'local' }

export interface ProviderDefinition {
  id: AiProviderId
  name: string
  /** direct: el fabricante sirve su propia API. aggregator: sirve modelos de terceros con su propia clave y sus tarifas. */
  kind: AiProviderKind
  /** A qué cuenta se factura el consumo. */
  billing: string
  simulated: boolean
  description: string
  /** Cómo se autentica cada llamada (siempre con la clave del usuario, nunca en la URL). */
  authentication: string
  keyPattern: RegExp
  keyHelp: string
  capabilities: AiCapability[]
  models: ModelDefinition[]
  /** Medidas de seguridad nativas del proveedor. */
  moderation: string
  /** Hosts de la API. Lista cerrada: el usuario no puede indicar otros. */
  allowedHosts: readonly string[]
  /** Hosts (o sufijos «.dominio») desde los que el proveedor entrega resultados por URL. */
  resultHosts?: readonly string[]
  links: { site: string; docs: string; pricing: string; terms: string; privacy: string; keys: string }
  dataUse: string
  verification: string
  /**
   * Coste de la comprobación (DA-87). free: la documentación dice expresamente que no cobra. unknown: no genera
   * contenido, pero la documentación no indica su coste; solo se hace con la confirmación del usuario.
   * unsupported: no hay comprobación sin generar.
   */
  verificationCost: AiVerificationCost
  /** Fecha de la última verificación documental del proveedor (AAAA-MM-DD). */
  consultedAt: string
  text?: TextProtocol
}

export const CONSULTED_AT = '2026-11-12'

const base = { currency: 'USD' as const, consultedAt: CONSULTED_AT }

export function tokenPrice(input: number, cached: number | null, output: number, source: string, extra: Partial<ModelPricing> = {}): ModelPricing {
  const money = (value: number) => value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
  return {
    usd: input,
    unit: 'million-tokens',
    status: 'confirmed',
    tokens: { inputUsd: input, cachedInputUsd: cached, outputUsd: output },
    context: 'Proceso estándar',
    detail: `${money(input)} $ por millón de tokens de entrada${cached === null ? '' : `, ${money(cached)} $ de entrada en caché`} y ${money(output)} $ de salida`,
    source,
    ...base,
    ...extra,
  }
}

export function imagePrice(usd: number, detail: string, source: string, extra: Partial<ModelPricing> = {}): ModelPricing {
  return { usd, unit: 'image', status: 'confirmed', context: 'Por imagen generada', detail, source, ...base, ...extra }
}

export function secondPrice(usd: number, detail: string, source: string, extra: Partial<ModelPricing> = {}): ModelPricing {
  return { usd, unit: 'second', status: 'confirmed', context: 'Por segundo de vídeo generado', detail, source, ...base, ...extra }
}
