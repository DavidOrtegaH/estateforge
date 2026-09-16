import { z } from 'zod'

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

  price: nonNegativeNumber(100_000_000),

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

    price: nonNegativeNumber(
      100_000_000,
    ).optional(),

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