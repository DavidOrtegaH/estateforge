import { AI_COST_NOT_VERIFIABLE } from '@estateforge/shared'

import type { AIUsage } from '../ai/ai-provider.js'
import type { ModelDefinition } from './catalog-types.js'
import { activePricing } from './registry.js'

// Desglose del coste de una operación (DA-92): generación, imágenes de referencia, clasificador de seguridad y
// mínimo por petición. Solo suma importes publicados por el proveedor que factura; lo que no se puede calcular
// se dice y no se inventa. Nunca es la factura del proveedor.

export interface CostLine {
  concept: string
  /** Importe en dólares, o null si no se puede calcular por adelantado. */
  usd: number | null
  detail: string
}

export interface CostBreakdown {
  lines: CostLine[]
  /** Suma de los importes calculables. */
  knownUsd: number
  /** true si todas las partes son calculables (el total es completo). */
  complete: boolean
  /** Fecha de consulta del precio del modelo y si tiene más de MAX_PRICE_AGE_DAYS días. */
  priceConsultedAt: string | null
  priceAgeDays: number | null
  priceStale: boolean
}

export const MAX_PRICE_AGE_DAYS = 7
/** Clasificador de Gemini (gemini-3.5-flash-lite): precio publicado por millón de tokens, consultado el 15/11/2026. */
export const GEMINI_CLASSIFIER = { model: 'gemini-3.5-flash-lite', inputUsd: 0.3, outputUsd: 2.5, source: 'https://aistudio.google.com/docs/pricing', consultedAt: '2026-11-15' }

const money = (usd: number) => usd.toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const day = (value: string) => value.split('-').reverse().join('/')

export interface CostInput {
  kind: 'text' | 'poster' | 'video'
  durationSeconds?: number
  resolution?: string
  references: number
  /** Clasificador que se usará (imagen y vídeo), o null si no hace falta o no hay. */
  moderation: { provider: string; name: string } | null
}

export function costBreakdown(model: ModelDefinition, input: CostInput, now: Date = new Date()): CostBreakdown {
  const pricing = activePricing(model, now)
  const lines: CostLine[] = []
  if (!pricing) {
    lines.push({ concept: 'Generación', usd: null, detail: `${AI_COST_NOT_VERIFIABLE}: no hay un precio publicado vigente. Consulta la tarifa del proveedor.` })
  } else if (input.kind === 'text' || pricing.unit === 'million-tokens') {
    const t = pricing.tokens
    lines.push({ concept: 'Generación', usd: null, detail: t ? `Por tokens: ${money(t.inputUsd)} por millón de entrada${t.cachedInputUsd === null ? '' : ` (${money(t.cachedInputUsd)} en caché)`} y ${money(t.outputUsd)} por millón de salida. El importe depende de los tokens reales; tras la prueba se muestran los que devuelva la API.` : `Precio publicado: ${pricing.detail}. No se puede calcular un importe por adelantado.` })
  } else if (pricing.estimable === false) {
    lines.push({ concept: 'Generación', usd: null, detail: `Precio publicado: ${pricing.detail}. Depende de factores que EstateForge no controla: no se calcula un importe.` })
  } else if (pricing.unit === 'image') {
    lines.push({ concept: 'Generación (1 imagen)', usd: pricing.usd, detail: pricing.detail })
  } else {
    const option = model.video?.resolutionOptions?.find(item => item.id === input.resolution)
    const perSecond = option?.usdPerSecond ?? pricing.usd
    const seconds = input.durationSeconds ?? 0
    const raw = perSecond * seconds
    const usd = pricing.minimumUsd !== undefined ? Math.max(raw, pricing.minimumUsd) : raw
    lines.push({ concept: `Generación (${seconds} s${option ? ` a ${option.label}` : ''})`, usd, detail: `${money(perSecond)} por segundo${pricing.minimumUsd !== undefined ? `; mínimo ${money(pricing.minimumUsd)} por petición` : ''}` })
  }
  if (input.references > 0) {
    const per = pricing?.referenceUsd
    lines.push(
      per === undefined || per === null
        ? { concept: `Imágenes de referencia (${input.references})`, usd: null, detail: 'La documentación no publica el precio de la imagen de entrada.' }
        : { concept: `Imágenes de referencia (${input.references})`, usd: per * input.references, detail: per === 0 ? 'Según el proveedor, no añaden coste.' : `${money(per)} por imagen` },
    )
  }
  if (input.kind !== 'text' && input.moderation) {
    if (input.moderation.provider === 'gemini') {
      lines.push({ concept: 'Clasificador de seguridad (Google Gemini, con tu clave)', usd: null, detail: `${GEMINI_CLASSIFIER.model}: ${money(GEMINI_CLASSIFIER.inputUsd)} por millón de tokens de entrada y ${money(GEMINI_CLASSIFIER.outputUsd)} de salida (consultado el ${day(GEMINI_CLASSIFIER.consultedAt)}). La documentación no indica cuántos tokens cuenta una imagen o un segundo de vídeo: no se puede estimar. Clasifica la entrada y el resultado.` })
    } else if (input.moderation.provider === 'openai') {
      lines.push({ concept: 'Clasificador de seguridad (OpenAI, con tu clave)', usd: 0, detail: 'omni-moderation: gratuito según la documentación de OpenAI.' })
    } else if (input.moderation.provider === 'simulador') {
      lines.push({ concept: 'Clasificador de seguridad (simulador local)', usd: 0, detail: 'Sin red ni cargos.' })
    } else {
      lines.push({ concept: `Clasificador de seguridad (${input.moderation.name})`, usd: null, detail: 'Coste no publicado: no se puede estimar.' })
    }
  }
  const known = lines.reduce((sum, line) => sum + (line.usd ?? 0), 0)
  const consulted = pricing?.consultedAt ?? null
  const ageDays = consulted ? Math.floor((now.getTime() - new Date(`${consulted}T00:00:00Z`).getTime()) / 86_400_000) : null
  return { lines, knownUsd: Math.round(known * 1e6) / 1e6, complete: lines.every(line => line.usd !== null), priceConsultedAt: consulted, priceAgeDays: ageDays, priceStale: ageDays !== null && ageDays > MAX_PRICE_AGE_DAYS }
}

/** Coste de una prueba de texto a partir de los tokens que devuelve la API (estimación, no la factura). */
export function textUsageCost(model: ModelDefinition, usage: AIUsage | undefined, now: Date = new Date()) {
  const tokens = activePricing(model, now)?.tokens
  if (!usage) return { reported: false as const, note: 'El proveedor no ha devuelto los tokens consumidos: consúltalos en tu cuenta del proveedor.' }
  const usd = tokens && usage.inputTokens !== undefined && usage.outputTokens !== undefined ? (usage.inputTokens * tokens.inputUsd + usage.outputTokens * tokens.outputUsd) / 1_000_000 : null
  return { reported: true as const, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, estimatedUsd: usd === null ? null : Math.round(usd * 1e6) / 1e6, note: 'Estimación con los tokens que devuelve la API y el precio publicado (sin caché). No es la factura del proveedor.' }
}
