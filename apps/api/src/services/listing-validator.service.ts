import {
  GeneratedListingSchema,
  type GeneratedListing,
  type Property,
} from '@estateforge/shared'

import { AIProviderError } from '../ai/ai-provider.error.js'

/**
 * El proveedor ha respondido, pero su anuncio no se puede usar. No es un fallo
 * interno: la API lo trata como una respuesta inválida del proveedor y, al
 * lanzarse dentro de la transacción, no se guarda nada.
 */
function invalidProviderResponse(
  detail: string,
): AIProviderError {
  return new AIProviderError(
    'AI_PROVIDER_ERROR',
    `${detail} Vuelve a generar el anuncio.`,
  )
}

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
 * Número tal como se escribe en un anuncio: con separadores de miles
 * (250.000, 250,000, 250 000), decimales (90,5 o 90.5) y signo (-1ª).
 */
const NUMBER_PATTERN =
  /(?:(?<![\p{L}\d])-)?(?:\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/gu

const NUMBER_SEPARATOR = /[.,\u00a0\u202f ]/g

interface ReadNumber {
  value: number
  decimals: number
}

/**
 * Valores posibles de un número escrito. Solo hay ambigüedad en casos
 * como "1.250", que puede ser 1250 o 1,25 según el idioma. "250.000" nunca
 * se lee como 250: admitirlo aceptaría un importe mil veces mayor.
 */
function readNumber(token: string): ReadNumber[] {
  const negative = token.startsWith('-')
  const body = negative ? token.slice(1) : token
  const sign = negative ? -1 : 1

  const read = (
    digits: string,
    decimals = '',
  ): ReadNumber => ({
    value:
      sign *
      Number(
        decimals
          ? `${digits}.${decimals}`
          : digits,
      ),
    decimals: decimals.length,
  })

  const separators =
    body.match(NUMBER_SEPARATOR) ?? []

  if (separators.length === 0) {
    return [read(body)]
  }

  const parts = body.split(NUMBER_SEPARATOR)
  const last = parts[parts.length - 1]
  const lastSeparator =
    separators[separators.length - 1]

  if (lastSeparator !== '.' && lastSeparator !== ',') {
    // Con un espacio normal, "3 120 m²" puede ser 120 precedido de otro número.
    return lastSeparator === ' '
      ? [read(parts.join('')), read(last)]
      : [read(parts.join(''))]
  }

  if (separators.length > 1) {
    return new Set(separators).size === 1
      ? [read(parts.join(''))]
      : [read(parts.slice(0, -1).join(''), last)]
  }

  const asDecimal = read(parts[0], last)

  if (last.length !== 3) {
    return [asDecimal]
  }

  const asThousands = read(parts.join(''))

  return last === '000'
    ? [asThousands]
    : [asThousands, asDecimal]
}

/**
 * Un número con decimales coincide si es el valor esperado redondeado a
 * esos decimales; uno sin decimales debe ser exactamente el esperado.
 */
function numberMatches(
  token: string,
  expected: number,
): boolean {
  return readNumber(token).some(
    ({ value, decimals }) =>
      decimals === 0
        ? value === expected
        : Number(expected.toFixed(decimals)) ===
          value,
  )
}

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
  // Un punto entre dígitos es parte del número, no el final de una frase.
  const segments = text.split(
    /(?<!\d)\.|\.(?!\d)|[!?;:\n]+/,
  )

  const numberRegex = NUMBER_PATTERN

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
          !numberMatches(candidate, value)
        ) {
          throw invalidProviderResponse(
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
      throw invalidProviderResponse(
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
    throw invalidProviderResponse(
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