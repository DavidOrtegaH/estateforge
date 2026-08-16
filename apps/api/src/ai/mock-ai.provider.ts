import type {
  AIProvider,
} from './ai-provider.js'

import type {
  GeneratedListing,
} from '@estateforge/shared'

interface PromptProperty {
  operation: string
  type: string
  price: number
  address: string
  city: string
  neighborhood: string
  area: number
  bedrooms: number
  bathrooms: number
  floor?: number
  condition: string
  elevator: boolean
  terrace: boolean
  balcony: boolean
  garage: boolean
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

  const jsonEnd = prompt.indexOf(
    '}\n\nDevuelve exactamente',
    jsonStart,
  )

  if (jsonEnd === -1) {
    throw new Error(
      'No se pudo determinar el final de los datos del inmueble.',
    )
  }

  const json = prompt.slice(
    jsonStart,
    jsonEnd + 1,
  )

  return JSON.parse(json) as PromptProperty
}

function getPropertyLabel(
  type: string,
): string {
  switch (type) {
    case 'apartment':
      return 'Apartamento'

    case 'house':
      return 'Casa'

    case 'villa':
      return 'Chalet'

    case 'penthouse':
      return 'Ático'

    case 'commercial':
      return 'Local comercial'

    default:
      return 'Inmueble'
  }
}

function getOperationLabel(
  operation: string,
): string {
  return operation === 'rent'
    ? 'en alquiler'
    : 'en venta'
}

function getConditionLabel(
  condition: string,
): string {
  switch (condition) {
    case 'new':
      return 'obra nueva'

    case 'renovated':
      return 'reformado'

    case 'needs-renovation':
      return 'para reformar'

    case 'good':
      return 'en buen estado'

    default:
      return ''
  }
}

function formatPrice(
  price: number,
): string {
  return `${price.toLocaleString('es-ES')} €`
}

function buildHighlights(
  property: PromptProperty,
): string[] {
  const highlights: string[] = []

  if (property.area > 0) {
    highlights.push(
      `${property.area} m²`,
    )
  }

  if (property.bedrooms > 0) {
    highlights.push(
      `${property.bedrooms} ${
        property.bedrooms === 1
          ? 'habitación'
          : 'habitaciones'
      }`,
    )
  }

  if (property.bathrooms > 0) {
    highlights.push(
      `${property.bathrooms} ${
        property.bathrooms === 1
          ? 'baño'
          : 'baños'
      }`,
    )
  }

  if (property.terrace) {
    highlights.push('Terraza')
  }

  if (property.balcony) {
    highlights.push('Balcón')
  }

  if (property.elevator) {
    highlights.push('Ascensor')
  }

  if (property.garage) {
    highlights.push('Garaje')
  }

  if (property.pool) {
    highlights.push('Piscina')
  }

  if (property.garden) {
    highlights.push('Jardín')
  }

  if (property.airConditioning) {
    highlights.push('Aire acondicionado')
  }

  if (property.heating) {
    highlights.push('Calefacción')
  }

  return highlights
}

function buildDescription(
  property: PromptProperty,
): string {
  const propertyLabel =
    getPropertyLabel(property.type)

  const operationText =
    property.operation === 'rent'
      ? 'en alquiler'
      : 'en venta'

  const location = [
    property.neighborhood,
    property.city,
  ]
    .filter(Boolean)
    .join(', ')

  const locationText = location
    ? ` situado en ${location}`
    : ''

  const areaText =
    property.area > 0
      ? ` Cuenta con ${property.area} m²`
      : ''

  const bedroomsText =
    property.bedrooms > 0
      ? ` distribuidos en ${property.bedrooms} ${
          property.bedrooms === 1
            ? 'habitación'
            : 'habitaciones'
        }`
      : ''

  const bathroomsText =
    property.bathrooms > 0
      ? ` y ${property.bathrooms} ${
          property.bathrooms === 1
            ? 'baño'
            : 'baños'
        }`
      : ''

  const floorText =
    property.floor !== undefined
      ? ` Se encuentra en una ${getFloorText(property.floor)} planta`
      : ''

  const features = buildFeatureSentence(
    property,
  )

  const conditionLabel =
    getConditionLabel(property.condition)

  const conditionText =
    conditionLabel === 'reformado'
      ? ' La vivienda está reformada.'
      : conditionLabel === 'obra nueva'
        ? ' La vivienda es de obra nueva.'
        : conditionLabel === 'para reformar'
          ? ' La vivienda necesita reforma.'
          : conditionLabel === 'en buen estado'
            ? ' La vivienda está en buen estado.'
            : ''

  const priceText =
    property.price > 0
      ? ` Precio: ${formatPrice(property.price)}.`
      : ''

  const additionalInformation =
    property.additionalInformation.trim()

  const additionalText =
    additionalInformation
      ? ` ${additionalInformation}`
      : ''

  return (
    `${propertyLabel}${operationText}${locationText}.` +
    `${areaText}${bedroomsText}${bathroomsText}.` +
    `${floorText}${features}` +
    `${conditionText}${priceText}` +
    `${additionalText}`
  ).trim()
}

function getFloorText(
  floor: number,
): string {
  if (floor === 1) {
    return 'primera'
  }

  if (floor === 2) {
    return 'segunda'
  }

  if (floor === 3) {
    return 'tercera'
  }

  return `${floor}`
}

function buildFeatureSentence(
  property: PromptProperty,
): string {
  const features: string[] = []

  if (property.terrace) {
    features.push('terraza')
  }

  if (property.balcony) {
    features.push('balcón')
  }

  if (property.elevator) {
    features.push('ascensor')
  }

  if (property.garage) {
    features.push('garaje')
  }

  if (property.pool) {
    features.push('piscina')
  }

  if (property.garden) {
    features.push('jardín')
  }

  if (property.airConditioning) {
    features.push('aire acondicionado')
  }

  if (property.heating) {
    features.push('calefacción')
  }

  if (features.length === 0) {
    return ''
  }

  if (features.length === 1) {
    return ` Dispone de ${features[0]}.`
  }

  const last = features[features.length - 1]

  const previous = features
    .slice(0, -1)
    .join(', ')

  return ` Dispone de ${previous} y ${last}.`
}

export class MockAIProvider
  implements AIProvider
{
  async generate(
    prompt: string,
  ): Promise<GeneratedListing> {
    const property =
      extractPropertyFromPrompt(prompt)

    const propertyLabel =
      getPropertyLabel(property.type)

    const operationLabel =
      getOperationLabel(property.operation)

    const conditionLabel =
      getConditionLabel(property.condition)

    const title = [
      propertyLabel,
      conditionLabel,
      operationLabel,
    ]
      .filter(Boolean)
      .join(' ')

    return {
      title,
      description:
        buildDescription(property),
      highlights:
        buildHighlights(property),
      callToAction:
        'Contacta con nosotros para concertar una visita.',
    }
  }
}