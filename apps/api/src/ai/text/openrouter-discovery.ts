import { z } from 'zod'

import { safeFetch, type FetchImpl } from '../../ai-media/safe-fetch.js'

// Descubrimiento de modelos de OpenRouter (DA-86). OpenRouter publica su catálogo en GET /api/v1/models.
// Un modelo descubierto NO se usa sin más: debe pasar una lista de requisitos (solo genera texto, admite
// salida estructurada, no está caducado y su identificador tiene la forma esperada) y se muestra siempre
// como «no verificado por EstateForge». La forma de la respuesta se valida: si no es la documentada, no se
// ofrece ningún modelo descubierto (quedan los del catálogo). Se guarda en memoria una hora.

const URL = 'https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs&output_modalities=text'
const TTL_MS = 60 * 60 * 1000
const MAX_MODELS = 300
/** fabricante/modelo, con el alias «~» de OpenRouter; sin espacios ni caracteres de ruta peligrosos. */
export const OPENROUTER_ID = /^~?[a-z0-9][a-z0-9-]{0,40}\/[a-z0-9][a-z0-9._:-]{0,80}$/

const ModelSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  architecture: z.object({ output_modalities: z.array(z.string()), input_modalities: z.array(z.string()).optional() }),
  supported_parameters: z.array(z.string()),
  expiration_date: z.string().nullable().optional(),
  context_length: z.number().nullable().optional(),
})
const ResponseSchema = z.object({ data: z.array(z.unknown()).max(5000) })

export interface DiscoveredModel {
  id: string
  label: string
  /** Fabricante según el prefijo del identificador de OpenRouter. */
  maker: string
  verified: false
}

let cache: { at: number; models: DiscoveredModel[] } | null = null

/** Solo pruebas. */
export function resetOpenRouterDiscoveryCache(): void {
  cache = null
}

export function filterDiscovered(raw: unknown, now = new Date()): DiscoveredModel[] {
  const parsed = ResponseSchema.safeParse(raw)
  if (!parsed.success) throw new Error('forma no documentada')
  const models: DiscoveredModel[] = []
  let valid = 0
  for (const item of parsed.data.data) {
    const model = ModelSchema.safeParse(item)
    if (!model.success) continue
    valid += 1
    const { id, name, architecture, supported_parameters: supported, expiration_date: expires } = model.data
    if (!OPENROUTER_ID.test(id)) continue
    // Solo modelos que generan exclusivamente texto: uno que también genere imagen o audio no entra.
    if (architecture.output_modalities.length !== 1 || architecture.output_modalities[0] !== 'text') continue
    if (!supported.includes('structured_outputs')) continue
    if (expires && new Date(expires).getTime() <= now.getTime()) continue
    // Las variantes gratuitas tienen límites diarios y otras condiciones de datos: no se ofrecen.
    if (id.endsWith(':free')) continue
    models.push({ id, label: name.replace(/[<>]/g, '').slice(0, 120), maker: id.replace(/^~/, '').split('/')[0], verified: false })
    if (models.length >= MAX_MODELS) break
  }
  // Si casi nada tiene la forma documentada, la respuesta no es la esperada: no se confía en ella.
  if (parsed.data.data.length > 0 && valid === 0) throw new Error('forma no documentada')
  return models
}

/** Modelos de OpenRouter que EstateForge admite ofrecer. Lanza si el catálogo no se puede leer o validar. */
export async function discoverOpenRouterModels(apiKey: string, fetchImpl?: FetchImpl, now = new Date()): Promise<DiscoveredModel[]> {
  if (cache && now.getTime() - cache.at < TTL_MS) return cache.models
  const response = await safeFetch(URL, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } }, { allowedHosts: ['openrouter.ai'], timeoutMs: 20_000, maxBytes: 16 * 1024 * 1024, fetchImpl })
  if (response.status !== 200) throw new Error('catálogo no disponible')
  const models = filterDiscovered(response.json(), now)
  cache = { at: now.getTime(), models }
  return models
}
