import type { GenerationRequest, ListingLanguage, Property } from '@estateforge/shared'
import { describe, expect, it } from 'vitest'

import { buildListingPrompt } from '../services/prompt.service.js'
import { validateGeneratedListing } from '../services/listing-validator.service.js'
import { generationNotices } from '../services/generation.service.js'
import { MockAIProvider } from './mock-ai.provider.js'

// Plantilla local (sin IA) en los dos idiomas, con el prompt real y el validador real que se aplica antes
// de guardar. Determinista: sin red, sin claves.

const base: Property = {
  title: 'Piso luminoso junto al Retiro',
  operation: 'sale',
  type: 'apartment',
  price: 250000,
  address: 'Calle Privada 7',
  city: 'Madrid',
  neighborhood: 'Chamberí',
  area: 92,
  bedrooms: 3,
  bathrooms: 2,
  floor: 3,
  condition: 'renovated',
  elevator: true,
  terrace: true,
  balcony: false,
  garage: false,
  storageRoom: false,
  pool: false,
  garden: false,
  airConditioning: true,
  heating: false,
  additionalInformation: 'Muy luminoso, orientación sur y cerca del metro.',
} as Property

async function generate(property: Partial<Property>, language: ListingLanguage) {
  const full = { ...base, ...property } as Property
  const request: GenerationRequest = { property: full, provider: 'mock', tone: 'professional', language }
  const listing = await new MockAIProvider(language).generate(buildListingPrompt(request))
  // El anuncio debe superar el mismo validador que se aplica antes de guardarlo.
  return validateGeneratedListing(listing, full)
}

const SPANISH_WORDS = /\b(habitaci[oó]n(es)?|ba[ñn]os?|planta|venta|alquiler|terraza|ascensor|calefacci[oó]n|aire acondicionado|precio|contacta|reformad[oa]|situado)\b/i

describe('plantilla local en inglés', () => {
  it('todo el contenido automático está en inglés, con título y observaciones del inmueble en español', async () => {
    const listing = await generate({}, 'english')
    expect(listing).toEqual({
      title: '3-bedroom apartment for sale in Chamberí, Madrid',
      description:
        'Apartment for sale in Chamberí, Madrid. It has 92 m², 3 bedrooms and 2 bathrooms. It is on the 3rd floor. Features: terrace, lift and air conditioning. It has been renovated. Price: €250,000.',
      highlights: ['92 m²', '3 bedrooms', '2 bathrooms', 'Terrace', 'Lift', 'Air conditioning'],
      callToAction: 'Contact us to arrange a viewing.',
    })
    const text = JSON.stringify(listing)
    // El texto libre del usuario no se copia como si estuviera traducido...
    expect(text).not.toContain('Retiro')
    expect(text).not.toContain('orientación sur')
    expect(text).not.toMatch(SPANISH_WORDS)
    // ...pero no se descarta en silencio: el servicio devuelve un aviso.
    expect(generationNotices('mock', 'english', base.additionalInformation)).toEqual(['FREE_TEXT_NOT_INCLUDED'])
    expect(generationNotices('mock', 'english', '   ')).toEqual([])
    expect(generationNotices('mock', 'español', base.additionalInformation)).toEqual([])
    expect(generationNotices('openai', 'english', base.additionalInformation)).toEqual([])
  })

  it('alquiler: sufijo mensual, importe exacto en euros con decimales, singulares y planta baja', async () => {
    const listing = await generate({ operation: 'rent', price: 1250.5, bedrooms: 1, bathrooms: 1, floor: 0, condition: 'good', elevator: false, terrace: false, airConditioning: false, heating: true }, 'english')
    expect(listing.title).toBe('1-bedroom apartment for rent in Chamberí, Madrid')
    expect(listing.description).toBe(
      'Apartment for rent in Chamberí, Madrid. It has 92 m², 1 bedroom and 1 bathroom. It is on the ground floor. Features: heating. It is in good condition. Price: €1,250.50/month.',
    )
    expect(listing.highlights).toEqual(['92 m²', '1 bedroom', '1 bathroom', 'Heating'])
  })

  it.each([
    [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [101, '101st'], [111, '111th'],
  ])('planta %i: «%s floor»', async (floor, ordinal) => {
    expect((await generate({ floor }, 'english')).description).toContain(`It is on the ${ordinal} floor.`)
  })

  it('sótanos y datos opcionales ausentes: no se menciona lo que falta', async () => {
    const basement = await generate({ floor: -1 }, 'english')
    expect(basement.description).toContain('It is on basement (level -1).')
    expect((await generate({ floor: -2 }, 'english')).description).toContain('It is on basement level 2 (level -2).')
    const minimal = await generate({ type: 'land', operation: 'transfer', area: 0, bedrooms: 0, bathrooms: 0, floor: undefined, neighborhood: '', elevator: false, terrace: false, airConditioning: false, condition: 'unknown' as Property['condition'] }, 'english')
    expect(minimal.title).toBe('Plot of land for business transfer in Madrid')
    expect(minimal.description).toBe('Plot of land for business transfer in Madrid. Price: €250,000.')
    expect(minimal.highlights).toEqual(['€250,000'])
    expect((await generate({ area: 0, bedrooms: 0, bathrooms: 0, elevator: false, terrace: false, airConditioning: false }, 'español')).highlights).toEqual(['250.000 €'])
  })

  it('tipos sin habitaciones en el título y nombres propios conservados', async () => {
    expect((await generate({ type: 'office', city: 'A Coruña', neighborhood: "Os Castros" }, 'english')).title).toBe('Office for sale in Os Castros, A Coruña')
    expect((await generate({ type: 'villa' }, 'english')).title).toBe('3-bedroom detached house for sale in Chamberí, Madrid')
    expect((await generate({ type: 'studio', bedrooms: 0 }, 'english')).title).toBe('Studio for sale in Chamberí, Madrid')
  })

  it('es determinista', async () => {
    expect(await generate({}, 'english')).toEqual(await generate({}, 'english'))
  })
})

describe('plantilla local en español (regresión)', () => {
  it('mantiene el título del inmueble, la estructura y las observaciones del usuario', async () => {
    const listing = await generate({}, 'español')
    expect(listing).toEqual({
      title: 'Piso luminoso junto al Retiro',
      description:
        'Apartamento en venta situado en Chamberí, Madrid. Cuenta con 92 m² distribuidos en 3 habitaciones y 2 baños. Se encuentra en una 3.ª planta. Dispone de terraza, ascensor y aire acondicionado. La vivienda está reformada. Precio: 250.000 €. Muy luminoso, orientación sur y cerca del metro.',
      highlights: ['92 m²', '3 habitaciones', '2 baños', 'Terraza', 'Ascensor', 'Aire acondicionado'],
      callToAction: 'Contacta con nosotros para concertar una visita.',
    })
  })

  it('español es el idioma por defecto', async () => {
    const request: GenerationRequest = { property: base, provider: 'mock', tone: 'professional', language: 'español' }
    expect(await new MockAIProvider().generate(buildListingPrompt(request))).toEqual(await generate({}, 'español'))
  })

  it('alquiler, singulares, planta baja, sótano y traspaso (antes se redactaba como venta)', async () => {
    const rent = await generate({ operation: 'rent', price: 950, bedrooms: 1, bathrooms: 1, floor: 0, additionalInformation: '' }, 'español')
    expect(rent.description).toBe(
      'Apartamento en alquiler situado en Chamberí, Madrid. Cuenta con 92 m² distribuidos en 1 habitación y 1 baño. Se encuentra en planta baja. Dispone de terraza, ascensor y aire acondicionado. La vivienda está reformada. Precio: 950 €.',
    )
    expect((await generate({ floor: -1 }, 'español')).description).toContain('Se encuentra en la planta -1.')
    expect((await generate({ operation: 'transfer', type: 'commercial' }, 'español')).description.startsWith('Local comercial en traspaso')).toBe(true)
    // Tipos que antes caían en «Inmueble».
    expect((await generate({ type: 'duplex' }, 'español')).description.startsWith('Dúplex en venta')).toBe(true)
    // Sin superficie: las estancias se mantienen en una frase completa.
    expect((await generate({ area: 0 }, 'español')).description).toContain('Cuenta con 3 habitaciones y 2 baños.')
  })
})
