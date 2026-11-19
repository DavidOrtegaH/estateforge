import type { ListingLanguage } from './generation.js'
import { commercialStatusLabels, operationLabels, propertyTypeLabels } from './labels.js'
import type { PropertyCommercialStatus, PropertyCondition, PropertyOperation, PropertyType } from './property.js'

// Textos automáticos del CONTENIDO generado de un anuncio (no de la interfaz, que sigue en español):
// plantilla local sin IA, cartel y vídeo. Es la única fuente de estas traducciones: la API la usa para
// redactar el anuncio y la web para componer los archivos, así que no hay diccionarios divergentes.
//
// Solo se traducen etiquetas y frases fijas construidas a partir de datos estructurados. El texto libre
// que escribe el usuario (título u observaciones del inmueble) nunca pasa por aquí: un diccionario no lo
// traduce y no se reutiliza como si estuviera traducido.
//
// Formatos: los importes siguen en euros y las superficies en m², con los mismos dígitos que el dato
// (sin coma flotante ni redondeos); solo cambian los separadores y la posición del símbolo.

export const DEFAULT_LISTING_LANGUAGE: ListingLanguage = 'español'

/** Idioma del contenido de un anuncio. Cualquier valor desconocido o ausente (anuncios antiguos) es español. */
export function listingLanguageOf(value: unknown): ListingLanguage {
  return value === 'english' ? 'english' : DEFAULT_LISTING_LANGUAGE
}

export const LISTING_FEATURES = ['elevator', 'terrace', 'balcony', 'garage', 'storageRoom', 'pool', 'garden', 'airConditioning', 'heating'] as const
export type ListingFeature = (typeof LISTING_FEATURES)[number]

export interface ListingCopy {
  /** Etiqueta BCP 47 del idioma del contenido. */
  locale: 'es-ES' | 'en-GB'
  propertyType: Record<PropertyType, string>
  /** Etiqueta breve de la operación (rótulos del cartel y del vídeo). */
  operation: Record<PropertyOperation, string>
  /** Operación dentro de una frase: «en venta», «for sale». */
  operationPhrase: Record<PropertyOperation, string>
  commercialStatus: Record<PropertyCommercialStatus, string>
  /** Frase completa sobre el estado de conservación. */
  conditionSentence: Record<PropertyCondition, string>
  /** Extras con mayúscula inicial (destacados, rótulos). */
  feature: Record<ListingFeature, string>
  bedrooms: (count: number) => string
  bathrooms: (count: number) => string
  /** Planta como dato visible: «3.ª planta», «3rd floor», «Planta baja», «Ground floor». */
  floor: (floor: number) => string
  /** Importe exacto en euros a partir del decimal («250000.00») o de un número. */
  formatPrice: (price: string | number) => string
  formatArea: (area: number) => string
  rentSuffix: string
  /** Enumeración natural: «a, b y c», «a, b and c». */
  list: (items: string[]) => string
  callToAction: string
  footer: string
  featuresHeading: string
}

/** Ordinal inglés: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 101st, 111th, 112th... */
export function englishOrdinal(value: number): string {
  const n = Math.abs(Math.trunc(value))
  const lastTwo = n % 100
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${value < 0 ? '-' : ''}${n}${suffix}`
}

/** Parte entera y decimales exactos de un importe; null si no es un decimal no negativo con hasta 2 decimales. */
function priceParts(price: string | number): { integer: string; decimals: string } | null {
  const text = typeof price === 'number' ? (Number.isFinite(price) ? price.toFixed(2) : '') : price.trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return null
  return { integer: match[1].replace(/^0+(?=\d)/, ''), decimals: (match[2] ?? '').padEnd(2, '0') }
}

const group = (integer: string, separator: string) => integer.replace(/\B(?=(\d{3})+(?!\d))/g, separator)

function joinList(items: string[], conjunction: string): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`
}

const SPANISH: ListingCopy = {
  locale: 'es-ES',
  propertyType: propertyTypeLabels,
  operation: operationLabels,
  operationPhrase: { sale: 'en venta', rent: 'en alquiler', transfer: 'en traspaso' },
  commercialStatus: commercialStatusLabels,
  conditionSentence: {
    new: 'La vivienda es de obra nueva.',
    good: 'La vivienda está en buen estado.',
    renovated: 'La vivienda está reformada.',
    'needs-renovation': 'La vivienda necesita reforma.',
  },
  feature: {
    elevator: 'Ascensor',
    terrace: 'Terraza',
    balcony: 'Balcón',
    garage: 'Garaje',
    storageRoom: 'Trastero',
    pool: 'Piscina',
    garden: 'Jardín',
    airConditioning: 'Aire acondicionado',
    heating: 'Calefacción',
  },
  bedrooms: count => `${count} ${count === 1 ? 'habitación' : 'habitaciones'}`,
  bathrooms: count => `${count} ${count === 1 ? 'baño' : 'baños'}`,
  floor: floor => (floor === 0 ? 'Planta baja' : floor < 0 ? `Planta ${floor}` : `${floor}.ª planta`),
  formatPrice: price => {
    const parts = priceParts(price)
    if (!parts) return `${price} €`
    const integer = group(parts.integer, '.')
    return parts.decimals === '00' ? `${integer} €` : `${integer},${parts.decimals} €`
  },
  formatArea: area => `${Number.isInteger(area) ? area : area.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m²`,
  rentSuffix: '/mes',
  list: items => joinList(items, 'y'),
  callToAction: 'Contacta con nosotros para concertar una visita.',
  footer: 'Material generado con EstateForge a partir de los datos del anuncio',
  featuresHeading: 'Características',
}

const ENGLISH: ListingCopy = {
  locale: 'en-GB',
  propertyType: {
    apartment: 'Apartment',
    house: 'House',
    villa: 'Detached house',
    penthouse: 'Penthouse',
    duplex: 'Duplex',
    studio: 'Studio',
    commercial: 'Commercial premises',
    office: 'Office',
    land: 'Plot of land',
  },
  operation: { sale: 'Sale', rent: 'Rental', transfer: 'Business transfer' },
  operationPhrase: { sale: 'for sale', rent: 'for rent', transfer: 'for business transfer' },
  commercialStatus: { 'for-sale': 'For sale', sold: 'Sold', 'for-rent': 'For rent', rented: 'Rented' },
  conditionSentence: {
    new: 'It is a new build.',
    good: 'It is in good condition.',
    renovated: 'It has been renovated.',
    'needs-renovation': 'It needs renovation.',
  },
  feature: {
    elevator: 'Lift',
    terrace: 'Terrace',
    balcony: 'Balcony',
    garage: 'Garage',
    storageRoom: 'Storage room',
    pool: 'Swimming pool',
    garden: 'Garden',
    airConditioning: 'Air conditioning',
    heating: 'Heating',
  },
  bedrooms: count => `${count} ${count === 1 ? 'bedroom' : 'bedrooms'}`,
  bathrooms: count => `${count} ${count === 1 ? 'bathroom' : 'bathrooms'}`,
  floor: floor => (floor === 0 ? 'Ground floor' : floor === -1 ? 'Basement' : floor < 0 ? `Basement level ${-floor}` : `${englishOrdinal(floor)} floor`),
  formatPrice: price => {
    const parts = priceParts(price)
    if (!parts) return `€${price}`
    const integer = group(parts.integer, ',')
    return parts.decimals === '00' ? `€${integer}` : `€${integer}.${parts.decimals}`
  },
  formatArea: area => `${Number.isInteger(area) ? area : area.toLocaleString('en-GB', { maximumFractionDigits: 2 })} m²`,
  rentSuffix: '/month',
  list: items => joinList(items, 'and'),
  callToAction: 'Contact us to arrange a viewing.',
  footer: 'Material created with EstateForge from the listing data',
  featuresHeading: 'Features',
}

export const LISTING_COPY: Record<ListingLanguage, ListingCopy> = { español: SPANISH, english: ENGLISH }

/** Textos del contenido para el idioma de un anuncio (español si el valor es desconocido o falta). */
export function listingCopy(language: unknown): ListingCopy {
  return LISTING_COPY[listingLanguageOf(language)]
}

/**
 * Aviso de la plantilla local inglesa: las observaciones del inmueble son texto libre del usuario y no se
 * traducen ni se copian en el anuncio inglés. El usuario puede añadir su versión inglesa editando el
 * anuncio. Es un código estable; la interfaz decide el texto.
 */
export const FREE_TEXT_NOT_INCLUDED = 'FREE_TEXT_NOT_INCLUDED' as const
export type GenerationNotice = typeof FREE_TEXT_NOT_INCLUDED
