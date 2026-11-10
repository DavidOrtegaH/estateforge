import {
  describe,
  expect,
  it,
} from 'vitest'

import type {
  Property,
} from '@estateforge/shared'

import {
  validateGeneratedListing,
} from './listing-validator.service.js'

import { isAIProviderError } from '../ai/ai-provider.error.js'

/**
 * Inmueble base reutilizado por los tests.
 *
 * Tiene `floor: 4` a propósito: así el test de "anuncio coherente"
 * cubre el caso que provocaba el falso positivo de `planta`
 * (comparar contra "plantas" o contra números que pertenecen a
 * otra parte de la frase).
 */
const baseProperty: Property = {
  title: 'Piso en el centro',
  operation: 'sale',
  type: 'apartment',
  price: 250000,
  address: 'Calle Mayor 10',
  city: 'Madrid',
  neighborhood: 'Centro',
  area: 90,
  bedrooms: 3,
  bathrooms: 2,
  floor: 4,
  condition: 'good',
  elevator: true,
  terrace: true,
  balcony: false,
  garage: false,
  storageRoom: false,
  pool: false,
  garden: false,
  airConditioning: true,
  heating: true,
  additionalInformation: '',
}

describe('validateGeneratedListing', () => {
  it('acepta un anuncio coherente con el inmueble', () => {
    const listing = {
      title: 'Piso de 90 m² en el centro',
      description:
        'Edificio de 5 plantas con ascensor. El piso se encuentra en la 4ª planta. Dispone de 3 habitaciones, 2 baños y 90 m². Precio 250000 €.',
      highlights: [
        '90 m²',
        '3 habitaciones',
        '2 baños',
      ],
      callToAction:
        'Contacta con nosotros para más información.',
    }

    const result = validateGeneratedListing(
      listing,
      baseProperty,
    )

    expect(result.title).toBe(listing.title)
    expect(result.highlights).toEqual(
      listing.highlights,
    )
    expect(result.callToAction).toBe(
      listing.callToAction,
    )
  })

  it('rechaza una característica no existente', () => {
    const listing = {
      title: 'Piso con piscina',
      description:
        'Piso en venta con piscina comunitaria.',
      highlights: [
        '90 m²',
        '3 habitaciones',
      ],
      callToAction: 'Contacta con nosotros.',
    }

    expect(() =>
      validateGeneratedListing(
        listing,
        baseProperty,
      ),
    ).toThrow(/característica no indicada/)
  })

  it('rechaza un dato numérico contradictorio cuando aparece junto a su etiqueta', () => {
    const listing = {
      title: 'Piso en venta',
      description:
        'Piso con 5 habitaciones y 2 baños.',
      highlights: ['90 m²'],
      callToAction: 'Contacta.',
    }

    expect(() =>
      validateGeneratedListing(
        listing,
        baseProperty,
      ),
    ).toThrow(
      /dato numérico posiblemente inconsistente/,
    )
  })

  describe('números escritos con formato', () => {
    const withText = (description: string) => ({
      title: 'Piso en venta',
      description,
      highlights: ['Luminoso'],
      callToAction: 'Contacta.',
    })

    const check = (
      description: string,
      patch: Partial<Property>,
    ) =>
      validateGeneratedListing(withText(description), {
        ...baseProperty,
        ...patch,
      })

    it.each([
      [900, '900'],
      [10000, '10.000'],
      [100000, '100.000'],
      [250000, '250.000'],
      [500000, '500.000'],
      [1000000, '1.000.000'],
      [100000000, '100.000.000'],
      [250000.5, '250.000,5'],
      [250000.75, '250.000,75'],
      [1234.5, '1234,5'],
    ])('acepta el precio %d escrito como %s €', (price, text) => {
      expect(() => check(`Precio: ${text} €.`, { price })).not.toThrow()
    })

    it.each(['250000', '250.000', '250,000', '250 000', '250\u00a0000', '250.000,00'])('acepta %s como 250000', (text) => {
      expect(() => check(`Cuesta ${text} euros.`, { price: 250000 })).not.toThrow()
    })

    it('el precio coherente con una frase posterior no se confunde', () => {
      expect(() =>
        check('Precio: 250.000 €. 3 habitaciones.', { price: 250000 }),
      ).not.toThrow()
    })

    it.each([
      ['300.000 €', 'otro importe'],
      ['25.000 €', 'diez veces menor'],
      ['2.500.000 €', 'diez veces mayor'],
      ['250.001 €', 'una unidad'],
      ['250 €', 'sin los miles'],
    ])('rechaza %s (%s) para 250000', (text) => {
      expect(() => check(`Precio: ${text}.`, { price: 250000 })).toThrow(
        /posiblemente inconsistente: €/,
      )
    })

    it('no lee 250.000 como 250 cuando el precio es 250', () => {
      expect(() => check('Por 250.000 €.', { price: 250 })).toThrow(
        /posiblemente inconsistente/,
      )
      expect(() => check('Por 250 €.', { price: 250 })).not.toThrow()
    })

    it.each([
      ['90.5 m²', 90.5],
      ['90,5 m²', 90.5],
      ['1.200 m²', 1200],
      ['90 m²', 90],
    ])('acepta la superficie %s', (text, area) => {
      expect(() => check(`Tiene ${text}.`, { area })).not.toThrow()
    })

    it('rechaza una superficie decimal distinta', () => {
      expect(() => check('Tiene 90,5 m².', { area: 91.5 })).toThrow(
        /inconsistente: m²/,
      )
    })

    it('el punto final de una frase sigue separando datos', () => {
      expect(() =>
        check('Tiene 90 m². 3 habitaciones.', { area: 90, bedrooms: 3 }),
      ).not.toThrow()
    })

    it.each([
      [-1, 'Situado en la -1ª planta.'],
      [0, 'Situado en la 0ª planta.'],
    ])('acepta la planta %d', (floor, text) => {
      expect(() => check(text, { floor })).not.toThrow()
    })

    it('rechaza una planta de signo contrario', () => {
      expect(() => check('Situado en la 1ª planta.', { floor: -1 })).toThrow(
        /inconsistente: planta/,
      )
    })
  })

  describe('tipo de error', () => {
    const invalid = (value: unknown) => {
      try {
        validateGeneratedListing(value, baseProperty)
      } catch (error) {
        return error
      }

      throw new Error('debía rechazarse')
    }

    it.each([
      ['contradictoria', { title: 'Piso', description: 'Con 5 habitaciones.', highlights: ['Luz'], callToAction: 'Llama.' }],
      ['con característica inventada', { title: 'Piso', description: 'Con piscina.', highlights: ['Luz'], callToAction: 'Llama.' }],
      ['malformada', { title: '' }],
      ['vacía', null],
    ])('una respuesta %s es un error controlado del proveedor', (_name, value) => {
      const error = invalid(value)

      expect(isAIProviderError(error)).toBe(true)
      expect(error).toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    })

    it('el mensaje no incluye el texto generado', () => {
      const error = invalid({ title: 'Piso', description: 'SECRETO con 5 habitaciones.', highlights: ['Luz'], callToAction: 'Llama.' }) as Error

      expect(error.message).not.toContain('SECRETO')
    })
  })

  it('rechaza una respuesta con formato inválido', () => {
    const listing = {
      title: '',
      description: 'Descripción',
      highlights: ['Algo'],
      callToAction: 'Contacta',
    }

    expect(() =>
      validateGeneratedListing(
        listing,
        baseProperty,
      ),
    ).toThrow(/formato no válido/)
  })
})