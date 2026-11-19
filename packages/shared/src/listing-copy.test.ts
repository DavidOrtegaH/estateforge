import { describe, expect, it } from 'vitest'

import { commercialStatusLabels, operationLabels, propertyTypeLabels } from './labels.js'
import { englishOrdinal, LISTING_COPY, LISTING_FEATURES, listingCopy, listingLanguageOf } from './listing-copy.js'

// Fuente única de las etiquetas del contenido generado (plantilla local, cartel y vídeo).

const es = LISTING_COPY['español']
const en = LISTING_COPY.english

describe('idioma del contenido', () => {
  it('español por defecto para valores ausentes o desconocidos (anuncios antiguos)', () => {
    expect(listingLanguageOf('english')).toBe('english')
    for (const value of ['español', undefined, null, '', 'English', 'en', 'fr']) expect(listingLanguageOf(value)).toBe('español')
    expect(listingCopy(undefined)).toBe(es)
  })

  it('el español reutiliza las etiquetas compartidas de la interfaz (no hay un segundo diccionario)', () => {
    expect(es.propertyType).toBe(propertyTypeLabels)
    expect(es.operation).toBe(operationLabels)
    expect(es.commercialStatus).toBe(commercialStatusLabels)
  })

  it('los dos idiomas cubren las mismas claves', () => {
    for (const field of ['propertyType', 'operation', 'operationPhrase', 'commercialStatus', 'conditionSentence', 'feature'] as const) {
      expect(Object.keys(en[field]).sort(), field).toEqual(Object.keys(es[field]).sort())
    }
    expect(Object.keys(en.feature).sort()).toEqual([...LISTING_FEATURES].sort())
  })
})

describe('formatos', () => {
  it('importes exactos en euros: separadores y símbolo según el idioma, sin coma flotante', () => {
    expect(es.formatPrice('250000.00')).toBe('250.000 €')
    expect(en.formatPrice('250000.00')).toBe('€250,000')
    expect(es.formatPrice('1250.5')).toBe('1.250,50 €')
    expect(en.formatPrice('1250.5')).toBe('€1,250.50')
    expect(en.formatPrice('99999999.99')).toBe('€99,999,999.99')
    expect(en.formatPrice(1250.5)).toBe('€1,250.50')
    expect(en.formatPrice('0007')).toBe('€7')
    expect(en.formatPrice('no es un número')).toBe('€no es un número')
  })

  it('superficie en m² con los decimales del dato', () => {
    expect(es.formatArea(92)).toBe('92 m²')
    expect(en.formatArea(92)).toBe('92 m²')
    expect(es.formatArea(92.5)).toBe('92,5 m²')
    expect(en.formatArea(92.5)).toBe('92.5 m²')
    expect(en.formatArea(1234.75)).toBe('1,234.75 m²')
  })

  it('plurales', () => {
    expect([es.bedrooms(1), es.bedrooms(0), es.bedrooms(3)]).toEqual(['1 habitación', '0 habitaciones', '3 habitaciones'])
    expect([en.bedrooms(1), en.bedrooms(0), en.bedrooms(3)]).toEqual(['1 bedroom', '0 bedrooms', '3 bedrooms'])
    expect([es.bathrooms(1), es.bathrooms(2)]).toEqual(['1 baño', '2 baños'])
    expect([en.bathrooms(1), en.bathrooms(2)]).toEqual(['1 bathroom', '2 bathrooms'])
  })

  it('plantas: baja, sótanos y ordinales (incluidos 11th, 12th y 13th)', () => {
    expect([es.floor(0), es.floor(-1), es.floor(3)]).toEqual(['Planta baja', 'Planta -1', '3.ª planta'])
    expect([en.floor(0), en.floor(-1), en.floor(-2), en.floor(1), en.floor(2), en.floor(3)]).toEqual(['Ground floor', 'Basement', 'Basement level 2', '1st floor', '2nd floor', '3rd floor'])
    const ordinals = [1, 2, 3, 4, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 100, 101, 102, 103, 111, 112, 113, 121].map(englishOrdinal)
    expect(ordinals).toEqual(['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '14th', '20th', '21st', '22nd', '23rd', '24th', '100th', '101st', '102nd', '103rd', '111th', '112th', '113th', '121st'])
  })

  it('enumeraciones, sufijo del alquiler, pie y rótulos', () => {
    expect([es.list(['a']), es.list(['a', 'b']), es.list(['a', 'b', 'c'])]).toEqual(['a', 'a y b', 'a, b y c'])
    expect(en.list(['a', 'b', 'c'])).toBe('a, b and c')
    expect([es.rentSuffix, en.rentSuffix]).toEqual(['/mes', '/month'])
    expect(es.footer).toBe('Material generado con EstateForge a partir de los datos del anuncio')
    expect(en.footer).toBe('Material created with EstateForge from the listing data')
    expect([es.featuresHeading, en.featuresHeading]).toEqual(['Características', 'Features'])
  })

  it('ninguna etiqueta inglesa contiene palabras españolas', () => {
    const english = JSON.stringify([en.propertyType, en.operation, en.operationPhrase, en.commercialStatus, en.conditionSentence, en.feature, en.callToAction, en.footer, en.featuresHeading])
    expect(english).not.toMatch(/[áéíóúñ]|\b(venta|alquiler|planta|habitaci|baño|terraza|ascensor|traspaso|vivienda)\b/i)
  })
})
