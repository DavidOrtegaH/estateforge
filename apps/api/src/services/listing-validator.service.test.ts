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