import {
  COMMERCIAL_STATUS_NOT_SET_LABEL,
  LISTING_COPY,
  listingCopy,
  listingLanguageOf,
  type ListingFeature,
  type ListingLanguage,
  type PropertyCommercialStatus,
  type PropertyOperation,
  type PropertyType,
} from '@estateforge/shared'

// Textos del cartel y del vídeo a partir de la fuente que entrega la API (DA-47). Solo se usan datos
// reales del inmueble y del anuncio: si un dato falta (por ejemplo, la planta), no aparece; nunca se
// inventa. La dirección exacta no se muestra: el material indica barrio y ciudad.
//
// Idioma: el guardado en el anuncio (generation.language), no el del selector de generación. Todas las
// etiquetas automáticas (tipo, operación, estado, extras, estancias, planta, sufijo del alquiler, rótulos
// y pie) salen de @estateforge/shared (listing-copy.ts), la misma fuente que usa la plantilla local de la
// API. Los textos del anuncio (título, descripción, destacados y llamada a la acción) se dibujan tal como
// están guardados, incluida cualquier edición manual; barrio y ciudad se conservan como nombres propios.

export interface MediaSourceData {
  sourceHash: string
  /** language falta en respuestas anteriores al campo: se trata como español. */
  generation: { id: string; title: string; description: string; highlights: string[]; callToAction: string | null; language?: string | null }
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
  /** Idioma del contenido: el del anuncio. */
  language: ListingLanguage
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
  /** Rótulo de la lista de características del vídeo. */
  featuresHeading: string
  /** Pie del cartel y del vídeo. */
  footer: string
}

// Orden de los extras en el material (el de siempre).
const FEATURE_ORDER: ListingFeature[] = ['elevator', 'terrace', 'balcony', 'garage', 'storageRoom', 'pool', 'garden', 'airConditioning', 'heating']

/**
 * Importe exacto a partir del decimal («250000.00»), sin pasar por coma flotante: «250.000 €» en español y
 * «€250,000» en inglés. Siempre en euros.
 */
export function formatPrice(price: string, language: ListingLanguage = 'español'): string {
  return LISTING_COPY[language].formatPrice(price)
}

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

export function buildPromoContent(source: MediaSourceData): PromoContent {
  const p = source.property
  const g = source.generation
  const language = listingLanguageOf(g.language)
  const copy = listingCopy(language)
  const facts = [copy.formatArea(p.area), copy.bedrooms(p.bedrooms), copy.bathrooms(p.bathrooms)]
  if (p.floor !== null && p.floor !== undefined) facts.push(copy.floor(p.floor))
  const location = [p.neighborhood.trim(), p.city.trim()].filter(Boolean).join(', ')
  const features = FEATURE_ORDER.filter(key => p[key] === true).map(key => copy.feature[key])
  // Los destacados del anuncio que repiten un dato ya visible (superficie, habitaciones, extras) no se duplican.
  const known = new Set([...facts, ...features].map(normalize))
  const highlights = g.highlights.map(item => item.trim()).filter(item => item && !known.has(normalize(item))).slice(0, 3)
  const status = p.commercialStatus ? (copy.commercialStatus[p.commercialStatus as PropertyCommercialStatus] ?? (language === 'español' ? COMMERCIAL_STATUS_NOT_SET_LABEL : null)) : null
  return {
    language,
    // El título del inmueble es texto libre del usuario: solo sirve de respaldo en el idioma por defecto.
    headline: g.title.trim() || (language === 'español' ? p.title.trim() : ''),
    slogan: g.callToAction?.trim() || null,
    price: copy.formatPrice(p.price),
    priceSuffix: p.operation === 'rent' ? copy.rentSuffix : '',
    operation: copy.operation[p.operation as PropertyOperation] ?? p.operation,
    type: copy.propertyType[p.type as PropertyType] ?? p.type,
    location,
    facts,
    features,
    highlights,
    status,
    excerpt: excerptOf(g.description),
    featuresHeading: copy.featuresHeading,
    footer: copy.footer,
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
