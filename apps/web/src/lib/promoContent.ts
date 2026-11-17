import {
  getCommercialStatusLabel,
  operationLabels,
  propertyTypeLabels,
  type PropertyOperation,
  type PropertyType,
} from '@estateforge/shared'

// Textos del cartel y del vídeo a partir de la fuente que entrega la API (DA-47). Solo se usan datos
// reales del inmueble y del anuncio: si un dato falta (por ejemplo, la planta), no aparece; nunca se
// inventa. La dirección exacta no se muestra: el material indica barrio y ciudad.

export interface MediaSourceData {
  sourceHash: string
  generation: { id: string; title: string; description: string; highlights: string[]; callToAction: string | null }
  property: {
    id: string
    title: string
    operation: string
    type: string
    price: string
    city: string
    neighborhood: string
    area: number
    bedrooms: number
    bathrooms: number
    floor: number | null
    condition: string
    commercialStatus: string | null
    elevator: boolean
    terrace: boolean
    balcony: boolean
    garage: boolean
    storageRoom: boolean
    pool: boolean
    garden: boolean
    airConditioning: boolean
    heating: boolean
  }
  photos: { id: string; position: number; isPrimary: boolean; width: number; height: number; url: string; thumbUrl: string | null }[]
  limits?: { videoMaxPhotos: number }
}

export interface PromoContent {
  headline: string
  slogan: string | null
  price: string
  priceSuffix: string
  operation: string
  type: string
  location: string
  facts: string[]
  features: string[]
  highlights: string[]
  status: string | null
  /** Primeras frases de la descripción del anuncio (texto real, recortado por frases). */
  excerpt: string
}

const FEATURE_LABELS: [keyof MediaSourceData['property'], string][] = [
  ['elevator', 'Ascensor'],
  ['terrace', 'Terraza'],
  ['balcony', 'Balcón'],
  ['garage', 'Garaje'],
  ['storageRoom', 'Trastero'],
  ['pool', 'Piscina'],
  ['garden', 'Jardín'],
  ['airConditioning', 'Aire acondicionado'],
  ['heating', 'Calefacción'],
]

/** «250.000 €» a partir del decimal exacto («250000.00»), sin pasar por coma flotante. */
export function formatPrice(price: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(price.trim())
  if (!match) return `${price} €`
  const integer = match[1].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const decimals = (match[2] ?? '').padEnd(2, '0')
  return decimals === '00' ? `${integer} €` : `${integer},${decimals} €`
}

function formatArea(area: number): string {
  return `${Number.isInteger(area) ? area : area.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m²`
}

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function buildPromoContent(source: MediaSourceData): PromoContent {
  const p = source.property
  const g = source.generation
  const facts = [formatArea(p.area), plural(p.bedrooms, 'habitación', 'habitaciones'), plural(p.bathrooms, 'baño', 'baños')]
  if (p.floor !== null && p.floor !== undefined) facts.push(p.floor === 0 ? 'Planta baja' : p.floor < 0 ? `Planta ${p.floor}` : `${p.floor}.ª planta`)
  const location = [p.neighborhood.trim(), p.city.trim()].filter(Boolean).join(', ')
  const features = FEATURE_LABELS.filter(([key]) => p[key] === true).map(([, label]) => label)
  // Los destacados del anuncio que repiten un dato ya visible (superficie, habitaciones, extras) no se duplican.
  const known = new Set([...facts, ...features].map(normalize))
  const highlights = g.highlights.map(item => item.trim()).filter(item => item && !known.has(normalize(item))).slice(0, 3)
  return {
    headline: g.title.trim() || p.title.trim(),
    slogan: g.callToAction?.trim() || null,
    price: formatPrice(p.price),
    priceSuffix: p.operation === 'rent' ? '/mes' : '',
    operation: operationLabels[p.operation as PropertyOperation] ?? p.operation,
    type: propertyTypeLabels[p.type as PropertyType] ?? p.type,
    location,
    facts,
    features,
    highlights,
    status: p.commercialStatus ? getCommercialStatusLabel(p.commercialStatus) : null,
    excerpt: excerptOf(g.description),
  }
}

/** Frases completas de la descripción hasta unos 260 caracteres; si la primera ya es más larga, se recorta. */
export function excerptOf(description: string, max = 260): string {
  const text = description.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  // Fin de frase: signo seguido de espacio y mayúscula (así «489.000 €» no se parte).
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/)
  let out = ''
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence
    if (next.length > max) break
    out = next
  }
  return out || `${text.slice(0, max - 1).trimEnd()}…`
}

/** Fotografías en el orden de la galería, con la principal primero. */
export function orderedPhotos<T extends { isPrimary: boolean; position: number }>(photos: T[]): T[] {
  return [...photos].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.position - b.position)
}

/**
 * Variante nueva al regenerar: cambia siempre la composición (variante % 3) para que el resultado
 * sea distinto de verdad; la paleta y el movimiento del vídeo dependen del resto de la variante.
 */
export function nextVariant(current: number | null | undefined, random: () => number = Math.random): number {
  const variant = Math.floor(random() * 999_999)
  if (current === null || current === undefined || variant % 3 !== current % 3) return variant
  return variant + 1
}
