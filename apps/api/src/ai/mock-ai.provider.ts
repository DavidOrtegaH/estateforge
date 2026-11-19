import {
  GeneratedListingSchema,
  listingCopy,
  listingLanguageOf,
  type GeneratedListing,
  type ListingCopy,
  type ListingFeature,
  type ListingLanguage,
  type PropertyCondition,
  type PropertyOperation,
  type PropertyType,
} from '@estateforge/shared'
import type { AIProvider } from './ai-provider.js'
import { AIProviderError } from './ai-provider.error.js'

// Plantilla local (sin IA): compone el anuncio de forma determinista a partir de los datos estructurados
// del inmueble, sin llamadas externas ni claves. Las etiquetas salen de @estateforge/shared
// (listing-copy.ts), la misma fuente que usan el cartel y el vídeo.
//
// Idioma: el del anuncio (español por defecto).
// - Español: título del inmueble (lo escribió el usuario en el idioma de la interfaz), descripción con
//   las observaciones del usuario al final, destacados y llamada a la acción.
// - Inglés: todo el contenido automático se construye en inglés con los datos estructurados. El título y
//   las observaciones del inmueble son texto libre del usuario: no se traducen ni se copian como si
//   estuvieran traducidos. El título se compone con los datos; las observaciones quedan fuera y el
//   servicio de generación devuelve el aviso FREE_TEXT_NOT_INCLUDED para que el usuario añada su versión
//   inglesa editando el anuncio. Los nombres propios (barrio, ciudad) se conservan tal cual.

interface PromptProperty {
  title: string
  operation: string
  type: string
  price: number
  address: string
  city: string
  neighborhood: string
  area: number
  bedrooms: number
  bathrooms: number
  floor?: number | null
  condition: string
  elevator: boolean
  terrace: boolean
  balcony: boolean
  garage: boolean
  storageRoom: boolean
  pool: boolean
  garden: boolean
  airConditioning: boolean
  heating: boolean
  additionalInformation: string
}

function extractPropertyFromPrompt(
  prompt: string,
): PromptProperty {
  const marker = 'DATOS DEL INMUEBLE:'
  const start = prompt.indexOf(marker)

  if (start === -1) {
    throw new Error(
      'No se encontraron los datos del inmueble en el prompt.',
    )
  }

  const jsonStart = prompt.indexOf('{', start)

  if (jsonStart === -1) {
    throw new Error(
      'No se encontró el JSON del inmueble en el prompt.',
    )
  }

  // Buscamos la última llave de cierre del JSON a partir de jsonStart
  let braceCount = 0
  let jsonEnd = -1

  for (let i = jsonStart; i < prompt.length; i++) {
    if (prompt[i] === '{') {
      braceCount++
    } else if (prompt[i] === '}') {
      braceCount--
      if (braceCount === 0) {
        jsonEnd = i
        break
      }
    }
  }

  if (jsonEnd === -1) {
    throw new Error(
      'No se pudo determinar el final de los datos del inmueble.',
    )
  }

  return JSON.parse(prompt.slice(jsonStart, jsonEnd + 1)) as PromptProperty
}

// Orden de los extras en los destacados y en la frase de la descripción (el de la plantilla original).
const FEATURE_ORDER: ListingFeature[] = ['terrace', 'balcony', 'elevator', 'garage', 'storageRoom', 'pool', 'garden', 'airConditioning', 'heating']

const typeLabel = (copy: ListingCopy, type: string, fallback: string) => copy.propertyType[type as PropertyType] ?? fallback
const operationOf = (operation: string): PropertyOperation => (operation === 'rent' || operation === 'transfer' ? operation : 'sale')
const featuresOf = (property: PromptProperty, copy: ListingCopy) => FEATURE_ORDER.filter(key => property[key] === true).map(key => copy.feature[key])
const hasFloor = (floor: number | null | undefined): floor is number => typeof floor === 'number' && Number.isInteger(floor)
const locationOf = (property: PromptProperty) => [property.neighborhood, property.city].map(part => part?.trim()).filter(Boolean).join(', ')
const conditionOf = (copy: ListingCopy, condition: string) => copy.conditionSentence[condition as PropertyCondition] ?? ''

function buildHighlights(property: PromptProperty, copy: ListingCopy): string[] {
  const highlights: string[] = []
  if (property.area > 0) highlights.push(copy.formatArea(property.area))
  if (property.bedrooms > 0) highlights.push(copy.bedrooms(property.bedrooms))
  if (property.bathrooms > 0) highlights.push(copy.bathrooms(property.bathrooms))
  const all = [...highlights, ...featuresOf(property, copy)]
  if (all.length > 0) return all
  // Sin superficie, estancias ni extras (por ejemplo, un terreno con pocos datos) el anuncio necesita al
  // menos un destacado: el precio exacto o, si tampoco lo hay, el tipo. Antes la plantilla fallaba aquí.
  if (property.price > 0) return [`${copy.formatPrice(property.price)}${operationOf(property.operation) === 'rent' ? copy.rentSuffix : ''}`]
  return [typeLabel(copy, property.type, copy.propertyType.apartment)]
}

// ------------------------------------------------------------------------------------------ Español

function spanishFloorSentence(floor: number): string {
  if (floor === 0) return ' Se encuentra en planta baja.'
  if (floor < 0) return ` Se encuentra en la planta ${floor}.`
  return ` Se encuentra en una ${floor}.ª planta.`
}

function buildSpanishDescription(property: PromptProperty, copy: ListingCopy): string {
  const location = locationOf(property)
  const rooms = [property.bedrooms > 0 ? copy.bedrooms(property.bedrooms) : '', property.bathrooms > 0 ? copy.bathrooms(property.bathrooms) : ''].filter(Boolean)
  // «Cuenta con 92 m² distribuidos en 3 habitaciones y 2 baños.»; sin superficie, solo las estancias.
  const sizeSentence =
    property.area > 0
      ? ` Cuenta con ${copy.formatArea(property.area)}${property.bedrooms > 0 ? ` distribuidos en ${copy.bedrooms(property.bedrooms)}` : ''}${property.bathrooms > 0 ? ` y ${copy.bathrooms(property.bathrooms)}` : ''}.`
      : rooms.length > 0
        ? ` Cuenta con ${copy.list(rooms)}.`
        : ''
  const features = featuresOf(property, copy).map(label => label.toLowerCase())
  const condition = conditionOf(copy, property.condition)
  const additional = property.additionalInformation?.trim() ?? ''

  return (
    `${typeLabel(copy, property.type, 'Inmueble')} ${copy.operationPhrase[operationOf(property.operation)]}${location ? ` situado en ${location}` : ''}.` +
    sizeSentence +
    (hasFloor(property.floor) ? spanishFloorSentence(property.floor) : '') +
    (features.length > 0 ? ` Dispone de ${copy.list(features)}.` : '') +
    (condition ? ` ${condition}` : '') +
    (property.price > 0 ? ` Precio: ${copy.formatPrice(property.price)}.` : '') +
    (additional ? ` ${additional}` : '')
  ).trim()
}

// ------------------------------------------------------------------------------------------- Inglés

function englishFloorSentence(floor: number, copy: ListingCopy): string {
  if (floor === 0) return ' It is on the ground floor.'
  if (floor < 0) return ` It is on ${copy.floor(floor).toLowerCase()} (level ${floor}).`
  return ` It is on the ${copy.floor(floor)}.`
}

// Tipos en los que «3-bedroom» tiene sentido como parte del título.
const RESIDENTIAL = new Set(['apartment', 'house', 'villa', 'penthouse', 'duplex'])

function buildEnglishTitle(property: PromptProperty, copy: ListingCopy): string {
  const type = typeLabel(copy, property.type, 'Property')
  const bedrooms = RESIDENTIAL.has(property.type) && property.bedrooms > 0 ? `${property.bedrooms}-bedroom ${type.toLowerCase()}` : type
  const location = locationOf(property)
  const title = `${bedrooms} ${copy.operationPhrase[operationOf(property.operation)]}${location ? ` in ${location}` : ''}`
  return title.charAt(0).toUpperCase() + title.slice(1)
}

function buildEnglishDescription(property: PromptProperty, copy: ListingCopy): string {
  const location = locationOf(property)
  const size = [
    property.area > 0 ? copy.formatArea(property.area) : '',
    property.bedrooms > 0 ? copy.bedrooms(property.bedrooms) : '',
    property.bathrooms > 0 ? copy.bathrooms(property.bathrooms) : '',
  ].filter(Boolean)
  const features = featuresOf(property, copy).map(label => label.toLowerCase())
  const condition = conditionOf(copy, property.condition)
  const operation = operationOf(property.operation)
  const price = property.price > 0 ? `${copy.formatPrice(property.price)}${operation === 'rent' ? copy.rentSuffix : ''}` : ''

  return (
    `${typeLabel(copy, property.type, 'Property')} ${copy.operationPhrase[operation]}${location ? ` in ${location}` : ''}.` +
    (size.length > 0 ? ` It has ${copy.list(size)}.` : '') +
    (hasFloor(property.floor) ? englishFloorSentence(property.floor, copy) : '') +
    (features.length > 0 ? ` Features: ${copy.list(features)}.` : '') +
    (condition ? ` ${condition}` : '') +
    (price ? ` Price: ${price}.` : '')
  ).trim()
}

export class MockAIProvider
  implements AIProvider
{
  private readonly language: ListingLanguage

  constructor(language?: ListingLanguage) {
    this.language = listingLanguageOf(language)
  }

  async generate(
    prompt: string,
  ): Promise<GeneratedListing> {
    const property =
      extractPropertyFromPrompt(prompt)

    const copy = listingCopy(this.language)
    const english = this.language === 'english'

    const result = {
      title: english ? buildEnglishTitle(property, copy) : property.title,
      description: english ? buildEnglishDescription(property, copy) : buildSpanishDescription(property, copy),
      highlights: buildHighlights(property, copy),
      callToAction: copy.callToAction,
    }

    const validation =
      GeneratedListingSchema.safeParse(result)

    if (!validation.success) {
      throw new AIProviderError(
        'AI_PROVIDER_ERROR',
        'El proveedor Mock generó un anuncio con un formato inválido.',
      )
    }

    return validation.data
  }
}
