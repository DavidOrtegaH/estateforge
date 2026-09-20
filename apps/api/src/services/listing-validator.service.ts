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

/**
 * Comprueba si un carácter es una letra ASCII.
 *
 * Se utiliza para exigir límites de palabra al buscar etiquetas
 * como "planta", evitando que "plantas" se interprete como
 * "planta".
 */
function isLetter(char: string | undefined): boolean {
  return char !== undefined && /[a-z]/i.test(char)
}

/**
 * Devuelve todos los índices en los que aparece `label` dentro
 * de `segment`, exigiendo límites de palabra.
 *
 * El límite de palabra solo se exige en los extremos que son
 * letras, de modo que etiquetas como "m2" o "€" siguen
 * funcionando aunque no empiecen o terminen en letra.
 */
function findWholeWordOccurrences(
  segment: string,
  label: string,
): number[] {
  const indices: number[] = []
  const labelLength = label.length

  let from = 0

  while (true) {
    const index = segment.indexOf(label, from)

    if (index === -1) {
      break
    }

    const leftOk = !isLetter(segment[index - 1])
    const rightOk = !isLetter(
      segment[index + labelLength],
    )

    if (leftOk && rightOk) {
      indices.push(index)
    }

    from = index + 1
  }

  return indices
}

/**
 * Número máximo de caracteres que se permiten entre una etiqueta
 * y el número que se le asocia.
 *
 * Si la separación es mayor, se asume que el número pertenece a
 * otra información y no se compara. Esto evita falsos positivos
 * como asociar "5" a "planta" en "edificio de 5 plantas, piso
 * en la planta 3".
 */
const MAX_LABEL_NUMBER_GAP = 5

/**
 * Comprueba únicamente números que aparecen en la misma unidad
 * de contexto que la etiqueta.
 *
 * No se utiliza una ventana grande alrededor de la etiqueta porque
 * puede asociar, por ejemplo, "superficie" con el número de
 * "habitaciones" o "precio" que aparece unas palabras antes.
 *
 * Se divide el texto en fragmentos cortos usando puntuación y
 * saltos de línea. Dentro de cada fragmento se busca el número
 * asociado a la etiqueta, antes o después de ella, siempre que
 * esté pegado a la etiqueta.
 */
function assertNumberNotContradicted(
  text: string,
  value: number,
  labels: string[],
): void {
  const expectedValue = String(value)

  const segments = text.split(/[.!?;:\n]+/)

  const numberRegex = /\d+(?:[.,]\d+)?/g

  for (const label of labels) {
    const normalizedLabel = normalizeText(label)

    for (const segment of segments) {
      const occurrences = findWholeWordOccurrences(
        segment,
        normalizedLabel,
      )

      for (const labelIndex of occurrences) {
        const after = segment.slice(
          labelIndex + normalizedLabel.length,
        )

        /*
         * "Planta baja" y "planta bajo" no llevan asociado un
         * número de planta, por lo que no se validan.
         */
        if (
          normalizedLabel === 'planta' &&
          /^\s+(baja|bajo)\b/.test(after)
        ) {
          continue
        }

        const before = segment.slice(0, labelIndex)

        const beforeMatches = [
          ...before.matchAll(numberRegex),
        ]

        const afterMatches = [
          ...after.matchAll(numberRegex),
        ]

        const lastBefore =
          beforeMatches[beforeMatches.length - 1]

        const firstAfter = afterMatches[0]

        /*
         * `matchAll` siempre devuelve `index` definido, aunque
         * el tipo lo marque como opcional.
         */
        const beforeEnd =
          lastBefore !== undefined
            ? lastBefore.index! +
              lastBefore[0].length
            : undefined

        const beforeGap =
          beforeEnd !== undefined
            ? labelIndex - beforeEnd
            : Infinity

        const afterGap =
          firstAfter !== undefined
            ? firstAfter.index!
            : Infinity

        let candidate: string | undefined

        if (beforeGap <= MAX_LABEL_NUMBER_GAP) {
          candidate = lastBefore![0]
        } else if (
          afterGap <= MAX_LABEL_NUMBER_GAP
        ) {
          candidate = firstAfter![0]
        }

        if (
          candidate !== undefined &&
          candidate !== expectedValue
        ) {
          throw new Error(
            `La respuesta de la IA contiene un dato numérico posiblemente inconsistente: ${label}.`,
          )
        }

        /*
         * Si hay una etiqueta pero no hay ningún número pegado
         * a ella, no afirmamos que exista una contradicción.
         * La IA puede omitir ese dato sin inventarlo.
         */
      }
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
      labels: [
        'garaje',
        'garage',
        'plaza de garaje',
      ],
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
      (label) =>
        text.includes(normalizeText(label)),
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
    [
      'm²',
      'm2',
      'metros cuadrados',
      'superficie',
    ],
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