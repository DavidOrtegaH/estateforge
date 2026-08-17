import {
  GeneratedListingSchema,
  type GeneratedListing,
  type Property,
} from '@estateforge/shared'

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function listingText(listing: GeneratedListing): string {
  return normalizeText(
    [
      listing.title,
      listing.description,
      ...listing.highlights,
      listing.callToAction,
    ].join(' '),
  )
}

function assertNumberNotContradicted(
  text: string,
  value: number,
  labels: string[],
): void {
  const normalizedValue = String(value)

  const hasValue = text.includes(normalizedValue)

  if (!hasValue) {
    return
  }

  for (const label of labels) {
    const normalizedLabel = normalizeText(label)

    const index = text.indexOf(normalizedLabel)

    if (index === -1) {
      continue
    }

    const nearbyText = text.slice(
      index,
      index + 80,
    )

    if (!nearbyText.includes(normalizedValue)) {
      throw new Error(
        `La respuesta de la IA contiene un dato numérico posiblemente inconsistente: ${label}.`,
      )
    }
  }
}

function assertFeatureConsistency(
  text: string,
  property: Property,
): void {
  const features: Array<{
    enabled: boolean
    labels: string[]
  }> = [
    {
      enabled: property.elevator,
      labels: ['ascensor'],
    },
    {
      enabled: property.terrace,
      labels: ['terraza'],
    },
    {
      enabled: property.balcony,
      labels: ['balcon'],
    },
    {
      enabled: property.garage,
      labels: ['garaje', 'garage', 'plaza de garaje'],
    },
    {
      enabled: property.pool,
      labels: ['piscina'],
    },
    {
      enabled: property.garden,
      labels: ['jardin'],
    },
    {
      enabled: property.airConditioning,
      labels: [
        'aire acondicionado',
        'climatizacion',
      ],
    },
    {
      enabled: property.heating,
      labels: [
        'calefaccion',
        'calefaccion central',
        'sistema de calefaccion',
      ],
    },
  ]

  for (const feature of features) {
    if (feature.enabled) {
      continue
    }

    const mentioned = feature.labels.some(
      (label) => text.includes(normalizeText(label)),
    )

    if (mentioned) {
      throw new Error(
        `La respuesta de la IA menciona una característica no indicada en el inmueble: ${feature.labels[0]}.`,
      )
    }
  }
}

function assertPropertyDataConsistency(
  text: string,
  property: Property,
): void {
  assertNumberNotContradicted(
    text,
    property.area,
    ['m²', 'metros cuadrados', 'superficie'],
  )

  assertNumberNotContradicted(
    text,
    property.bedrooms,
    ['habitaciones', 'dormitorios'],
  )

  assertNumberNotContradicted(
    text,
    property.bathrooms,
    ['baños', 'cuartos de baño'],
  )

  assertNumberNotContradicted(
    text,
    property.price,
    ['precio', '€', 'euros'],
  )

  if (property.floor !== undefined) {
    assertNumberNotContradicted(
      text,
      property.floor,
      ['planta'],
    )
  }
}

export function validateGeneratedListing(
  value: unknown,
  property: Property,
): GeneratedListing {
  const parsed =
    GeneratedListingSchema.safeParse(value)

  if (!parsed.success) {
    throw new Error(
      'La IA devolvió un anuncio con un formato no válido.',
    )
  }

  const listing = parsed.data

  const text = listingText(listing)

  assertFeatureConsistency(text, property)

  assertPropertyDataConsistency(
    text,
    property,
  )

  return listing
}