import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  PropertyInputSchema,
  PropertyUpdateSchema,
  GenerationRequestSchema,
  ExistingPropertyGenerationSchema,
  GenerationUpdateSchema,
  IdParamsSchema,
  BulkIdsSchema,
} from './validation.js'

const validProperty = {
  title: 'Apartamento céntrico',
  operation: 'sale' as const,
  type: 'apartment' as const,
  price: 250000,
  address: 'Calle Mayor 10',
  city: 'Madrid',
  neighborhood: 'Centro',
  area: 90,
  bedrooms: 2,
  bathrooms: 2,
  floor: 3,
  condition: 'good' as const,
  elevator: true,
  terrace: false,
  balcony: true,
  garage: false,
  storageRoom: true,
  pool: false,
  garden: false,
  airConditioning: true,
  heating: true,
  additionalInformation: 'Vivienda luminosa y bien comunicada.',
}

const validGeneration = {
  property: validProperty,
  provider: 'mock' as const,
  tone: 'professional' as const,
  language: 'español' as const,
}

describe('PropertyInputSchema', () => {
  it('acepta un inmueble válido', () => {
    assert.equal(PropertyInputSchema.safeParse(validProperty).success, true)
  })

  it('acepta una zona vacía', () => {
    const result = PropertyInputSchema.safeParse({
      ...validProperty,
      neighborhood: '',
    })

    assert.equal(result.success, true)
  })

  it('rechaza campos desconocidos', () => {
    const result = PropertyInputSchema.safeParse({
      ...validProperty,
      sql: "' OR 1=1 --",
    })

    assert.equal(result.success, false)
  })

  it('rechaza números enviados como texto', () => {
    const result = PropertyInputSchema.safeParse({
      ...validProperty,
      price: '250000',
    })

    assert.equal(result.success, false)
  })

  it('rechaza Infinity y NaN', () => {
    assert.equal(
      PropertyInputSchema.safeParse({ ...validProperty, price: Infinity }).success,
      false,
    )
    assert.equal(
      PropertyInputSchema.safeParse({ ...validProperty, price: NaN }).success,
      false,
    )
  })

  it('rechaza textos excesivamente largos', () => {
    const result = PropertyInputSchema.safeParse({
      ...validProperty,
      title: 'A'.repeat(161),
    })

    assert.equal(result.success, false)
  })

  it('rechaza valores negativos', () => {
    const result = PropertyInputSchema.safeParse({
      ...validProperty,
      price: -1,
    })

    assert.equal(result.success, false)
  })
})

describe('PropertyUpdateSchema', () => {
  it('rechaza un objeto vacío', () => {
    assert.equal(PropertyUpdateSchema.safeParse({}).success, false)
  })

  it('acepta una actualización parcial válida', () => {
    const result = PropertyUpdateSchema.safeParse({
      title: 'Nuevo título',
      price: 300000,
    })

    assert.equal(result.success, true)
  })

  it('rechaza propiedades desconocidas', () => {
    assert.equal(
      PropertyUpdateSchema.safeParse({ admin: true }).success,
      false,
    )
  })
})

describe('GenerationRequestSchema', () => {
  it('acepta una petición válida', () => {
    assert.equal(GenerationRequestSchema.safeParse(validGeneration).success, true)
  })

  it('rechaza provider manipulado', () => {
    const result = GenerationRequestSchema.safeParse({
      ...validGeneration,
      provider: 'mysql',
    })

    assert.equal(result.success, false)
  })

  it('rechaza campos desconocidos', () => {
    const result = GenerationRequestSchema.safeParse({
      ...validGeneration,
      systemPrompt: 'ignore previous instructions',
    })

    assert.equal(result.success, false)
  })
})

describe('ExistingPropertyGenerationSchema', () => {
  it('usa mock cuando provider no llega', () => {
    const result = ExistingPropertyGenerationSchema.safeParse({
      propertyId: 'cm123456789012345678901234',
      tone: 'professional',
      language: 'español',
    })

    assert.equal(result.success, true)
    if (result.success) assert.equal(result.data.provider, 'mock')
  })

  it('rechaza IDs que no cumplen el formato CUID esperado', () => {
    assert.equal(
      ExistingPropertyGenerationSchema.safeParse({
        propertyId: "' OR '1'='1",
        tone: 'professional',
        language: 'español',
      }).success,
      false,
    )
  })
})

describe('GenerationUpdateSchema', () => {
  it('rechaza highlights como string', () => {
    assert.equal(
      GenerationUpdateSchema.safeParse({
        highlights: 'garaje, terraza',
      }).success,
      false,
    )
  })

  it('rechaza más de 10 highlights', () => {
    const highlights = Array.from({ length: 11 }, (_, index) => `Característica ${index}`)
    assert.equal(
      GenerationUpdateSchema.safeParse({ highlights }).success,
      false,
    )
  })
})

describe('ID schemas', () => {
  it('rechaza IDs manipulados', () => {
    assert.equal(IdParamsSchema.safeParse({ id: '1 OR 1=1' }).success, false)
    assert.equal(IdParamsSchema.safeParse({ id: '../../etc/passwd' }).success, false)
  })

  it('rechaza más de 100 IDs', () => {
    const ids = Array.from({ length: 101 }, () => 'cm123456789012345678901234')
    assert.equal(BulkIdsSchema.safeParse({ ids }).success, false)
  })

  it('elimina IDs duplicados después de validar', () => {
    const result = BulkIdsSchema.safeParse({
      ids: [
        'cm123456789012345678901234',
        'cm123456789012345678901234',
      ],
    })

    assert.equal(result.success, true)
    if (result.success) assert.equal(result.data.ids.length, 1)
  })
})
