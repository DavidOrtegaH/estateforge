import { z } from 'zod'

import { PROPERTY_COMMERCIAL_STATUSES } from './property.js'

import {
  MAX_OTHER_PUBLICATIONS,
  OTHER_NAME_MAX_LENGTH,
  PUBLICATION_PLATFORM_IDS,
  PUBLICATION_URL_MAX_LENGTH,
  validateOtherUrl,
  validatePublicationUrl,
  type PublicationUrlResult,
} from './publications.js'

/**
 * ============================================================
 * UTILIDADES
 * ============================================================
 */

const cuidSchema = z
  .string()
  .cuid('ID inválido')

const requiredText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'El campo es obligatorio')
    .max(
      max,
      `El campo no puede superar los ${max} caracteres`,
    )

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(
      max,
      `El campo no puede superar los ${max} caracteres`,
    )

const nonNegativeNumber = (max: number) =>
  z
    .number()
    .finite('El número debe ser finito')
    .min(0, 'El número no puede ser negativo')
    .max(
      max,
      `El número no puede superar ${max}`,
    )

const nonNegativeInteger = (max: number) =>
  z
    .number()
    .int('El valor debe ser un número entero')
    .min(0, 'El valor no puede ser negativo')
    .max(
      max,
      `El valor no puede superar ${max}`,
    )

const booleanSchema = z.boolean()

/**
 * Importe exacto: número o cadena decimal, hasta 100.000.000 y 2 decimales.
 * El resultado es siempre una cadena, para no pasar por coma flotante.
 */
const moneySchema = z
  .union([z.string().trim(), z.number().finite()])
  .transform((value) =>
    typeof value === 'number' ? String(value) : value,
  )
  .refine(
    (value) =>
      /^\d{1,9}(\.\d{1,2})?$/.test(value) &&
      Number(value) <= 100_000_000,
    {
      message:
        'El importe debe ser un número positivo de hasta 100.000.000 con un máximo de 2 decimales',
    },
  )

/**
 * API key temporal proporcionada por el usuario.
 *
 * Nunca debe persistirse en base de datos ni incluirse
 * en respuestas o logs.
 */
const apiKeySchema = z
  .string()
  .trim()
  .min(1, 'La API key no puede estar vacía')
  .max(
    512,
    'La API key no puede superar los 512 caracteres',
  )

/**
 * Prisma permite floor = null.
 *
 * A nivel de API convertimos null a undefined para que
 * el objeto resultante siga siendo compatible con Property.
 */
const floorSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z
    .number()
    .int('La planta debe ser un número entero')
    .min(
      -10,
      'La planta no puede ser inferior a -10',
    )
    .max(
      200,
      'La planta no puede superar 200',
    )
    .optional(),
)

const commercialStatusSchema = z.enum(
  PROPERTY_COMMERCIAL_STATUSES,
  {
    message:
      'Selecciona el estado del inmueble: en venta, vendido, por alquilar o alquilado',
  },
)

/**
 * ============================================================
 * PROPERTY
 * ============================================================
 */

const propertyFields = {
  title: requiredText(160),

  operation: z.enum([
    'sale',
    'rent',
    'transfer',
  ]),

  type: z.enum([
    'apartment',
    'house',
    'villa',
    'penthouse',
    'duplex',
    'studio',
    'commercial',
    'office',
    'land',
  ]),

  price: moneySchema,

  address: requiredText(200),

  city: requiredText(100),

  neighborhood: optionalText(120),

  area: nonNegativeNumber(100_000),

  bedrooms: nonNegativeInteger(100),

  bathrooms: nonNegativeInteger(100),

  floor: floorSchema,

  condition: z.enum([
    'new',
    'good',
    'renovated',
    'needs-renovation',
  ]),

  commercialStatus: commercialStatusSchema,

  elevator: booleanSchema,

  terrace: booleanSchema,

  balcony: booleanSchema,

  garage: booleanSchema,

  storageRoom: booleanSchema,

  pool: booleanSchema,

  garden: booleanSchema,

  airConditioning: booleanSchema,

  heating: booleanSchema,

  additionalInformation: optionalText(2_000),
}

/**
 * Payload completo utilizado para generar un anuncio.
 */
export const PropertyInputSchema = z
  .object(propertyFields)
  .strict()

export type PropertyInput = z.infer<
  typeof PropertyInputSchema
>

/**
 * Payload parcial utilizado para actualizar un inmueble.
 *
 * Todos los campos son opcionales, pero no permitimos
 * enviar un objeto vacío.
 */
export const PropertyUpdateSchema = z
  .object({
    title: requiredText(160).optional(),

    operation: z
      .enum([
        'sale',
        'rent',
        'transfer',
      ])
      .optional(),

    type: z
      .enum([
        'apartment',
        'house',
        'villa',
        'penthouse',
        'duplex',
        'studio',
        'commercial',
        'office',
        'land',
      ])
      .optional(),

    price: moneySchema.optional(),

    address: requiredText(200).optional(),

    city: requiredText(100).optional(),

    neighborhood: optionalText(120).optional(),

    area: nonNegativeNumber(
      100_000,
    ).optional(),

    bedrooms: nonNegativeInteger(
      100,
    ).optional(),

    bathrooms: nonNegativeInteger(
      100,
    ).optional(),

    floor: floorSchema,

    condition: z
      .enum([
        'new',
        'good',
        'renovated',
        'needs-renovation',
      ])
      .optional(),

    commercialStatus:
      commercialStatusSchema.optional(),

    elevator: booleanSchema.optional(),

    terrace: booleanSchema.optional(),

    balcony: booleanSchema.optional(),

    garage: booleanSchema.optional(),

    storageRoom: booleanSchema.optional(),

    pool: booleanSchema.optional(),

    garden: booleanSchema.optional(),

    airConditioning:
      booleanSchema.optional(),

    heating: booleanSchema.optional(),

    additionalInformation:
      optionalText(2_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).length > 0,
    {
      message:
        'Debe proporcionarse al menos un campo para actualizar',
    },
  )

export type PropertyUpdate = z.infer<
  typeof PropertyUpdateSchema
>

/**
 * ============================================================
 * GENERATION
 * ============================================================
 */

export const AIProviderSchema = z.enum([
  'mock',
  'gemini',
  'openai',
])

export const ListingToneSchema = z.enum([
  'professional',
  'luxurious',
  'casual',
  'persuasive',
])

export const ListingLanguageSchema = z.enum([
  'español',
  'english',
])

/**
 * POST /api/generations
 *
 * apiKey es opcional y temporal.
 * Si no se proporciona, el backend utiliza la
 * API key configurada en el servidor.
 */
export const GenerationRequestSchema = z
  .object({
    property: PropertyInputSchema,

    provider: AIProviderSchema,

    tone: ListingToneSchema,

    language: ListingLanguageSchema,

    apiKey: apiKeySchema.optional(),
  })
  .strict()

export type ValidatedGenerationRequest =
  z.infer<
    typeof GenerationRequestSchema
  >

/**
 * POST /api/generations/from-property
 *
 * apiKey es opcional y temporal.
 * Nunca se persiste.
 */
export const ExistingPropertyGenerationSchema =
  z
    .object({
      propertyId: cuidSchema,

      provider:
        AIProviderSchema.default('mock'),

      tone: ListingToneSchema,

      language: ListingLanguageSchema,

      apiKey: apiKeySchema.optional(),
    })
    .strict()

export type ExistingPropertyGeneration =
  z.infer<
    typeof ExistingPropertyGenerationSchema
  >

/**
 * PUT /api/generations/:id
 */
export const GenerationUpdateSchema = z
  .object({
    title: requiredText(160).optional(),

    description: requiredText(5_000).optional(),

    highlights: z
      .array(
        requiredText(160),
      )
      .min(
        1,
        'Debe existir al menos una característica',
      )
      .max(
        10,
        'No puede haber más de 10 características',
      )
      .optional(),

    callToAction:
      requiredText(500).optional(),

    provider:
      AIProviderSchema.optional(),

    tone:
      ListingToneSchema.optional(),

    language:
      ListingLanguageSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).length > 0,
    {
      message:
        'Debe proporcionarse al menos un campo para actualizar',
    },
  )

export type GenerationUpdate = z.infer<
  typeof GenerationUpdateSchema
>

/**
 * ============================================================
 * CHECKLIST DE PUBLICACIÓN
 * ============================================================
 */

const linkFieldSchema = z
  .string()
  .max(
    PUBLICATION_URL_MAX_LENGTH * 2,
    `El enlace no puede superar los ${PUBLICATION_URL_MAX_LENGTH} caracteres`,
  )
  .nullable()
  .optional()

/**
 * PUT /api/generations/:id/publications
 *
 * Una fila marcada exige un enlace válido. En una fila sin marcar, omitir `url`
 * conserva el enlace guardado, null o vacío lo borra y cualquier otro valor
 * debe ser válido: nunca se guarda un enlace que no lo sea.
 *
 * `others`, si se envía, es la lista definitiva de filas «Otro/a» del anuncio.
 */
export const PublicationChecklistUpdateSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            platform: z.enum(
              PUBLICATION_PLATFORM_IDS,
              {
                message:
                  'La plataforma indicada no existe',
              },
            ),

            isPublished: booleanSchema,

            url: linkFieldSchema,
          })
          .strict(),
      )
      .max(
        PUBLICATION_PLATFORM_IDS.length,
        'Hay más plataformas de las admitidas',
      ),

    others: z
      .array(
        z
          .object({
            instanceKey: z
              .string()
              .regex(
                /^[A-Za-z0-9_-]{1,64}$/,
                'Identificador de fila no válido',
              ),

            name: z
              .string()
              .max(
                OTHER_NAME_MAX_LENGTH,
                `El nombre no puede superar los ${OTHER_NAME_MAX_LENGTH} caracteres`,
              )
              .nullable()
              .optional(),

            homeUrl: linkFieldSchema,

            isPublished: booleanSchema,

            url: linkFieldSchema,
          })
          .strict(),
      )
      .max(
        MAX_OTHER_PUBLICATIONS,
        `No puede haber más de ${MAX_OTHER_PUBLICATIONS} plataformas «Otro/a»`,
      )
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.items.length === 0 &&
      value.others === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message:
          'Debe indicarse al menos una plataforma',
      })
    }

    const checkLink = (
      item: {
        isPublished: boolean
        url?: string | null
      },
      path: (string | number)[],
      validate: (
        raw: string,
      ) => PublicationUrlResult,
    ) => {
      if (
        !item.isPublished &&
        item.url === undefined
      ) {
        return
      }

      const result = validate(item.url ?? '')

      if (
        result.status === 'valid' ||
        (result.status === 'empty' &&
          !item.isPublished)
      ) {
        return
      }

      context.addIssue({
        code: 'custom',
        path: [...path, 'url'],
        message:
          result.status === 'empty'
            ? 'El enlace de la publicación es obligatorio para marcar la plataforma'
            : result.message,
      })
    }

    const seen = new Set<string>()

    value.items.forEach((item, index) => {
      if (seen.has(item.platform)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'platform'],
          message:
            'Una plataforma no puede aparecer dos veces',
        })
      }

      seen.add(item.platform)

      checkLink(
        item,
        ['items', index],
        (raw) =>
          validatePublicationUrl(
            item.platform,
            raw,
          ),
      )
    })

    const keys = new Set<string>()

    value.others?.forEach((other, index) => {
      const path = ['others', index]

      if (keys.has(other.instanceKey)) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'instanceKey'],
          message:
            'Una fila «Otro/a» no puede aparecer dos veces',
        })
      }

      keys.add(other.instanceKey)

      checkLink(other, path, validateOtherUrl)

      const home = validateOtherUrl(
        other.homeUrl ?? '',
      )

      if (
        home.status !== 'valid' &&
        home.status !== 'empty'
      ) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'homeUrl'],
          message: home.message,
        })
      }
    })
  })

export type PublicationChecklistUpdate = z.infer<
  typeof PublicationChecklistUpdateSchema
>

/**
 * ============================================================
 * PARAMS / BULK DELETE
 * ============================================================
 */

export const IdParamsSchema = z
  .object({
    id: cuidSchema,
  })
  .strict()

export type IdParams = z.infer<
  typeof IdParamsSchema
>

export const BulkIdsSchema = z
  .object({
    ids: z
      .array(cuidSchema)
      .min(
        1,
        'Debe proporcionarse al menos un ID',
      )
      .max(
        100,
        'No se pueden eliminar más de 100 elementos a la vez',
      ),
  })
  .strict()
  .transform((val) => ({
    ids: Array.from(
      new Set(val.ids),
    ),
  }))

export type BulkIds = z.infer<
  typeof BulkIdsSchema
>