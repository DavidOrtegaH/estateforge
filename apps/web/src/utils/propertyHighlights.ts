export interface PropertyHighlightSource {
  area?: number | null
  bedrooms?: number | null
  bathrooms?: number | null
  floor?: string | number | null
  condition?: string | null
  elevator?: boolean | null
  terrace?: boolean | null
  balcony?: boolean | null
  garage?: boolean | null
  storageRoom?: boolean | null
  pool?: boolean | null
  garden?: boolean | null
  airConditioning?: boolean | null
  heating?: boolean | null
}

const conditionLabels: Record<string, string> = {
  new: 'Obra nueva',
  good: 'Buen estado',
  renovated: 'Reformado',
  'to_renovate': 'A reformar',
  'needs_renovation': 'Necesita reforma',
  'needs-renovation': 'Necesita reforma',
}

function addUnique(
  highlights: string[],
  value: string,
) {
  if (
    value.trim() &&
    !highlights.includes(value)
  ) {
    highlights.push(value)
  }
}

/**
 * Construye highlights cortos para representar los
 * datos estructurados del inmueble en tarjetas/listados.
 *
 * No utiliza Generation.highlights, por lo que no se ve
 * afectado por las frases largas generadas por Gemini.
 */
export function buildPropertyHighlights(
  property: PropertyHighlightSource,
): string[] {
  const highlights: string[] = []

  if (
    typeof property.area === 'number' &&
    Number.isFinite(property.area)
  ) {
    addUnique(
      highlights,
      `${property.area} m²`,
    )
  }

  if (
    typeof property.bedrooms === 'number' &&
    Number.isFinite(property.bedrooms)
  ) {
    addUnique(
      highlights,
      `${property.bedrooms} ${property.bedrooms === 1
        ? 'habitación'
        : 'habitaciones'
      }`,
    )
  }

  if (
    typeof property.bathrooms === 'number' &&
    Number.isFinite(property.bathrooms)
  ) {
    addUnique(
      highlights,
      `${property.bathrooms} ${property.bathrooms === 1
        ? 'baño'
        : 'baños'
      }`,
    )
  }

  if (
    property.floor !== undefined &&
    property.floor !== null &&
    String(property.floor).trim() !== ''
  ) {
    addUnique(
      highlights,
      `Planta ${property.floor}`,
    )
  }

  if (property.terrace) {
    addUnique(highlights, 'Terraza')
  }

  if (property.balcony) {
    addUnique(highlights, 'Balcón')
  }

  if (property.garage) {
    addUnique(highlights, 'Garaje')
  }

  if (property.storageRoom) {
    addUnique(highlights, 'Trastero')
  }

  if (property.pool) {
    addUnique(highlights, 'Piscina')
  }

  if (property.garden) {
    addUnique(highlights, 'Jardín')
  }

  if (property.elevator) {
    addUnique(highlights, 'Ascensor')
  }

  if (property.airConditioning) {
    addUnique(
      highlights,
      'Aire acondicionado',
    )
  }

  if (property.heating) {
    addUnique(
      highlights,
      'Calefacción',
    )
  }

  if (property.condition) {
    const condition =
      conditionLabels[
      property.condition
        .toLowerCase()
        .replace(/-/g, '_')
      ] ||
      property.condition

    addUnique(highlights, condition)
  }

  return highlights
}