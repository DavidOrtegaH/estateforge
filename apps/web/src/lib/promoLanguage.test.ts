import { describe, expect, it } from 'vitest'

import { POSTER_TEMPLATES, type PosterTemplateId } from '@estateforge/shared'

import { drawPoster, MODERNO_EXTRAS_LIMIT, type PosterContext } from './posterRenderer'
import { buildPromoContent, formatPrice, type MediaSourceData } from './promoContent'
import { buildTimeline, drawAiVideoFrame, drawVideoFrame, AI_INTRO_SECONDS } from './videoRenderer'

// Idioma del cartel y del vídeo: el guardado en el anuncio (generation.language). Se dibuja sobre un
// contexto que registra los textos, igual que en media.test.ts, para comprobar lo que acaba en el archivo.

function recorder() {
  const texts: string[] = []
  const placed: { text: string; y: number }[] = []
  const ctx = new Proxy({ font: '', fillStyle: '', strokeStyle: '', textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1, globalAlpha: 1 } as Record<string, unknown>, {
    get(target, key) {
      if (key in target) return target[key as string]
      if (key === 'fillText') return (text: string, _x: number, y: number) => { texts.push(text); placed.push({ text, y }) }
      if (key === 'measureText') return (text: string) => ({ width: text.length * 14 })
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} })
      return () => undefined
    },
    set(target, key, value) {
      target[key as string] = value
      return true
    },
  }) as unknown as PosterContext
  return { ctx, texts, placed }
}

const englishListing = {
  id: 'g-en',
  title: '3-bedroom apartment for sale in Chamberí, Madrid',
  description: 'Apartment for sale in Chamberí, Madrid. It has 85 m², 3 bedrooms and 1 bathroom. It is on the 4th floor. Features: terrace, lift and air conditioning. It is in good condition. Price: €325,000.',
  highlights: ['85 m²', '3 bedrooms', '1 bathroom', 'Terrace', 'Lift', 'Air conditioning'],
  callToAction: 'Contact us to arrange a viewing.',
}

function source(language: string | undefined, property: Partial<MediaSourceData['property']> = {}, generation: Partial<MediaSourceData['generation']> = {}): MediaSourceData {
  return {
    sourceHash: 'b'.repeat(64),
    generation: { ...englishListing, ...(language !== undefined && { language }), ...generation },
    property: {
      id: 'p1',
      // Título del inmueble escrito por el usuario en español: no debe aparecer en el material inglés.
      title: 'Piso precioso junto al parque',
      operation: 'sale',
      type: 'apartment',
      price: '325000.00',
      city: 'Madrid',
      neighborhood: 'Chamberí',
      area: 85,
      bedrooms: 3,
      bathrooms: 1,
      floor: 4,
      condition: 'good',
      commercialStatus: 'for-sale',
      elevator: true,
      terrace: true,
      balcony: false,
      garage: false,
      storageRoom: false,
      pool: false,
      garden: false,
      airConditioning: true,
      heating: false,
      ...property,
    },
    photos: Array.from({ length: 5 }, (_, i) => ({ id: `ph${i}`, position: i, isPrimary: i === 0, width: 1600, height: 1200, url: `/p/${i}`, thumbUrl: null })),
  }
}

const images = Array.from({ length: 5 }, (_, i) => ({ width: 1600 + i, height: 1200 }))
const TEMPLATE_IDS = POSTER_TEMPLATES.map(template => template.id) as PosterTemplateId[]

// Etiquetas automáticas españolas que no pueden aparecer en un archivo inglés.
const SPANISH_LABELS = /Material generado|Características|habitaci[oó]n|\bba[ñn]os?\b|\bplanta\b|\bVenta\b|\bAlquiler\b|\bTraspaso\b|En venta|Por alquilar|\bAscensor\b|\bTerraza\b|Aire acondicionado|\/mes|325\.000 €|Apartamento|Piso precioso/i

describe('cartel en inglés', () => {
  it('el contenido toma el idioma del anuncio y localiza las etiquetas automáticas', () => {
    const content = buildPromoContent(source('english'))
    expect(content).toMatchObject({
      language: 'english',
      price: '€325,000',
      priceSuffix: '',
      operation: 'Sale',
      type: 'Apartment',
      status: 'For sale',
      location: 'Chamberí, Madrid',
      facts: ['85 m²', '3 bedrooms', '1 bathroom', '4th floor'],
      features: ['Lift', 'Terrace', 'Air conditioning'],
      featuresHeading: 'Features',
      footer: 'Material created with EstateForge from the listing data',
      headline: englishListing.title,
      slogan: englishListing.callToAction,
    })
    // Los destacados que repiten datos visibles no se duplican también en inglés.
    expect(content.highlights).toEqual([])
  })

  it.each(TEMPLATE_IDS)('%s: todos los textos automáticos del archivo están en inglés', templateId => {
    const { ctx, texts } = recorder()
    drawPoster(ctx, buildPromoContent(source('english')), images, templateId)
    const all = texts.join('\n')
    expect(all).toContain('Material created with EstateForge from the listing data')
    expect(all).toContain('€325,000')
    expect(all).toContain('Chamberí')
    expect(all).not.toMatch(SPANISH_LABELS)
    expect(all).not.toMatch(/undefined|null|NaN/)
  })

  it.each(TEMPLATE_IDS)('%s: alquiler con sufijo mensual, planta baja y estado en inglés', templateId => {
    const { ctx, texts } = recorder()
    drawPoster(ctx, buildPromoContent(source('english', { operation: 'rent', price: '1250.50', floor: 0, commercialStatus: 'for-rent', bedrooms: 1 }, { title: 'Bright 1-bedroom apartment for rent' })), images, templateId)
    const all = texts.join('\n')
    expect(all).toMatch(/€1,250\.50 \/month/)
    expect(all).not.toMatch(SPANISH_LABELS)
  })
})

describe('vídeo en inglés', () => {
  it('cada parte del vídeo clásico (presentación, fotos, características y cierre) está en inglés', () => {
    const content = buildPromoContent(source('english', { operation: 'rent', price: '1200.00', floor: 13 }))
    const timeline = buildTimeline(3, 0)
    const at = (kind: string) => {
      const segment = timeline.segments.find(item => item.kind === kind)!
      const { ctx } = recorder()
      return drawVideoFrame(ctx, content, i => images[i], timeline, 0, segment.start + 0.6).join('\n')
    }
    expect(at('intro')).toContain('RENTAL · APARTMENT')
    expect(at('intro')).toContain('€1,200 /month')
    expect(at('photo')).toContain('3 bedrooms')
    expect(at('photo')).toContain('13th floor')
    expect(at('features')).toContain('Features')
    expect(at('features')).toContain('• Lift')
    expect(at('outro')).toContain('Contact us to arrange a viewing.')
    expect(at('outro')).toContain('Material created with EstateForge from the listing data')
    for (const kind of ['intro', 'photo', 'features', 'outro']) expect(at(kind), kind).not.toMatch(SPANISH_LABELS)
  })

  it('el cierre del vídeo con IA usa también el pie del idioma del anuncio', () => {
    const { ctx } = recorder()
    const texts = drawAiVideoFrame(ctx, buildPromoContent(source('english')), null, 6, AI_INTRO_SECONDS + 6 + 0.5)
    expect(texts).toContain('Material created with EstateForge from the listing data')
  })
})

describe('español (regresión) y anuncios anteriores al campo', () => {
  const spanishListing = { title: 'Piso luminoso con terraza', description: 'Vivienda exterior en Chamberí.', highlights: ['Muy luminoso'], callToAction: 'Pide tu visita hoy' }

  it.each(TEMPLATE_IDS)('%s: el cartel español mantiene sus etiquetas y su pie', templateId => {
    const { ctx, texts } = recorder()
    drawPoster(ctx, buildPromoContent(source('español', {}, spanishListing)), images, templateId)
    const all = texts.join('\n')
    expect(all).toContain('Material generado con EstateForge a partir de los datos del anuncio')
    expect(all).toContain('325.000 €')
    expect(all).not.toMatch(/Material created|€325,000|bedroom|Features/)
  })

  it('sin idioma en la fuente (respuesta anterior) el material sale en español, como antes', () => {
    const legacy = buildPromoContent(source(undefined, { commercialStatus: null }, spanishListing))
    const current = buildPromoContent(source('español', { commercialStatus: null }, spanishListing))
    expect(legacy).toEqual(current)
    expect(legacy).toMatchObject({ language: 'español', price: '325.000 €', operation: 'Venta', type: 'Apartamento', facts: ['85 m²', '3 habitaciones', '1 baño', '4.ª planta'], features: ['Ascensor', 'Terraza', 'Aire acondicionado'], featuresHeading: 'Características' })
    const timeline = buildTimeline(3, 0)
    const features = timeline.segments.find(item => item.kind === 'features')!
    expect(drawVideoFrame(recorder().ctx, legacy, i => images[i], timeline, 0, features.start + 0.6)).toContain('Características')
  })

  it('el formateo del precio conserva la firma anterior (español por defecto)', () => {
    expect(formatPrice('325000.00')).toBe('325.000 €')
    expect(formatPrice('325000.00', 'english')).toBe('€325,000')
  })

  it('cambiar el idioma de otro anuncio no afecta a este: cada fuente lleva el suyo', () => {
    expect(buildPromoContent(source('english')).footer).not.toBe(buildPromoContent(source('español', {}, spanishListing)).footer)
  })
})

describe('plantilla «Moderno»: los extras no se superponen a la llamada a la acción', () => {
  it.each(['english', 'español'])('%s: titular de dos líneas, ubicación y cuatro extras', language => {
    const { ctx, placed } = recorder()
    const content = buildPromoContent(source(language, { balcony: true, heating: true }, language === 'español' ? { title: 'Piso precioso y muy luminoso junto al parque del Retiro', callToAction: 'Contacta con nosotros para concertar una visita.' } : {}))
    drawPoster(ctx, content, images, 'moderno')
    const slogan = placed.find(item => item.text === content.slogan)!
    expect(slogan).toBeDefined()
    const extras = placed.filter(item => [...content.features, ...content.highlights].includes(item.text))
    expect(extras.length).toBeGreaterThan(0)
    for (const item of extras) {
      expect(item.y, item.text).toBeLessThanOrEqual(MODERNO_EXTRAS_LIMIT)
      expect(slogan.y - item.y, item.text).toBeGreaterThanOrEqual(40)
    }
  })
})
