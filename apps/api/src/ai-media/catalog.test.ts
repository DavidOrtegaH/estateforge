import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { AI_MEDIA_ONLY_PROVIDER_IDS, AI_PROVIDER_IDS, AI_TEXT_GENERATION_PROVIDERS, AI_TEXT_PROVIDER_IDS, AI_VIDEO_DURATIONS } from '@estateforge/shared'
import { describe, expect, it } from 'vitest'

import { REAL_PROVIDERS, SIMULATOR } from './catalog.js'
import { AiMediaError } from './errors.js'
import { activePricing, adapterFor, estimateCostMicroUsd, isSelectable, listProviders, publicProvider, resolveModel } from './registry.js'
import { assertAllowedUrl } from './safe-fetch.js'

// Invariantes del catálogo de proveedores (DA-82): lo que debe cumplirse para cualquier proveedor o modelo
// que se añada. El catálogo es la única fuente de proveedores, modelos y precios.

const all = [...REAL_PROVIDERS, SIMULATOR]
const models = REAL_PROVIDERS.flatMap(provider => provider.models.map(model => ({ provider, model })))
const OUTPUT = { text: 'text', poster: 'image', video: 'video' } as const

describe('catálogo: proveedores', () => {
  it('los identificadores coinciden con los tipos compartidos y son únicos', () => {
    expect(all.map(provider => provider.id).sort()).toEqual([...AI_PROVIDER_IDS].sort())
    expect(new Set(all.map(provider => provider.id)).size).toBe(all.length)
    // Todo proveedor con texto es elegible en la generación de anuncios, y solo esos.
    const withText = all.filter(provider => provider.capabilities.includes('text')).map(provider => provider.id)
    expect(withText.sort()).toEqual([...AI_TEXT_PROVIDER_IDS, 'simulador'].sort())
    expect(AI_TEXT_GENERATION_PROVIDERS).toEqual(['mock', ...AI_TEXT_PROVIDER_IDS, 'simulador'])
    for (const id of AI_MEDIA_ONLY_PROVIDER_IDS) expect(all.find(provider => provider.id === id)!.text).toBeUndefined()
  })

  it.each(REAL_PROVIDERS.map(provider => [provider.id, provider] as const))('%s: datos completos, hosts fijos y enlaces https', (_id, provider) => {
    expect(['direct', 'aggregator']).toContain(provider.kind)
    expect(provider.billing.length).toBeGreaterThan(10)
    expect(provider.description.length).toBeGreaterThan(20)
    expect(provider.consultedAt).toMatch(/^2026-11-\d\d$/)
    expect(provider.allowedHosts.length).toBeGreaterThan(0)
    // Hosts de la API: nombres exactos (sin comodines, IP ni esquema). Solo los de entrega admiten sufijo.
    for (const host of provider.allowedHosts) expect(host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
    for (const host of provider.resultHosts ?? []) expect(host).toMatch(/^\.?[a-z0-9.-]+\.[a-z]{2,}$/)
    for (const link of Object.values(provider.links)) expect(link).toMatch(/^https:\/\//)
    expect(provider.models.length).toBeGreaterThan(0)
    expect(provider.keyPattern.test('corta')).toBe(false)
    expect(provider.keyPattern.test('con espacios dentro de la clave')).toBe(false)
    // La URL de texto, si existe, apunta a un host permitido del propio proveedor.
    if (provider.text && 'url' in provider.text) expect(() => assertAllowedUrl(provider.text && 'url' in provider.text ? provider.text.url : '', provider.allowedHosts)).not.toThrow()
    // Un adaptador real para cada proveedor.
    expect(adapterFor(provider)).toBeTruthy()
  })

  it('las capacidades declaradas corresponden a modelos reales', () => {
    for (const provider of all) {
      for (const [capability, purpose] of [['text', 'text'], ['image', 'poster'], ['video', 'video']] as const) {
        expect(provider.capabilities.includes(capability), `${provider.id} ${capability}`).toBe(provider.models.some(model => model.purpose === purpose))
      }
      if (provider.capabilities.includes('image-reference')) expect(provider.models.some(model => model.purpose === 'poster' && model.maxReferenceImages > 0)).toBe(true)
      if (provider.capabilities.includes('moderation-video')) expect(provider.capabilities).toContain('moderation')
    }
    // Solo Gemini y OpenAI (y el simulador) ofrecen un clasificador; solo Gemini clasifica vídeo.
    expect(REAL_PROVIDERS.filter(provider => provider.capabilities.includes('moderation')).map(provider => provider.id)).toEqual(['gemini', 'openai'])
    expect(REAL_PROVIDERS.filter(provider => provider.capabilities.includes('moderation-video')).map(provider => provider.id)).toEqual(['gemini'])
  })

  it('agregadores: declaran que la factura es suya y sus modelos de terceros indican el fabricante', () => {
    const aggregators = REAL_PROVIDERS.filter(provider => provider.kind === 'aggregator')
    expect(aggregators.map(provider => provider.id)).toEqual(['openrouter', 'groq', 'runway', 'fal', 'replicate'])
    for (const provider of aggregators) {
      expect(provider.billing).toMatch(/no la del fabricante/)
      for (const model of provider.models) {
        if (model.maker === provider.name) continue
        // Modelo de un tercero: la nota dice a quién se factura.
        expect(model.notes, `${provider.id}/${model.id}`).toMatch(/se factura a tu cuenta de|Servido por/i)
      }
    }
  })

  it('el simulador nunca aparece en producción ni en Vercel', () => {
    expect(listProviders({ NODE_ENV: 'production', AI_MEDIA_SIMULATOR: '1' }).some(provider => provider.simulated)).toBe(false)
    expect(listProviders({ VERCEL: '1', AI_MEDIA_SIMULATOR: '1' }).some(provider => provider.simulated)).toBe(false)
    expect(listProviders({ NODE_ENV: 'development', AI_MEDIA_SIMULATOR: '1' }).at(-1)!.id).toBe('simulador')
  })
})

describe('catálogo: modelos', () => {
  it.each(models.map(({ provider, model }) => [`${provider.id}/${model.id}`, provider, model] as const))('%s', (_name, provider, model) => {
    expect(model.maker.length).toBeGreaterThan(1)
    expect(model.label.length).toBeGreaterThan(2)
    // Un modelo solo figura en un uso si GENERA ese contenido.
    expect(model.outputs).toEqual([OUTPUT[model.purpose]])
    expect(model.inputs).toContain('text')
    expect(model.inputs.includes('image')).toBe(model.maxReferenceImages > 0)
    expect(['stable', 'preview', 'beta', 'experimental', 'deprecated', 'unknown']).toContain(model.status)
    expect(isSelectable(model)).toBe(true)
    expect(resolveModel(provider.id, model.id, model.purpose).model).toBe(model)
    if (model.purpose === 'video') {
      expect(model.video).toBeDefined()
      expect(model.video!.durations.length).toBeGreaterThan(0)
      for (const seconds of model.video!.durations) expect(AI_VIDEO_DURATIONS as readonly number[]).toContain(seconds)
      expect(model.maxReferenceImages).toBeGreaterThan(0)
      expect(['disabled', 'discarded', 'none']).toContain(model.video!.nativeAudio)
    } else {
      expect(model.video).toBeUndefined()
    }
    if (model.purpose === 'poster') expect(model.image).toBeDefined()
    if (model.pricing) {
      expect(model.pricing.currency).toBe('USD')
      expect(model.pricing.usd).toBeGreaterThan(0)
      expect(model.pricing.source).toMatch(/^https:\/\//)
      expect(model.pricing.consultedAt).toMatch(/^2026-11-\d\d$/)
      expect(model.pricing.context.length).toBeGreaterThan(5)
      expect(model.pricing.unit).toBe(model.purpose === 'text' ? 'million-tokens' : model.pricing.unit)
      if (model.purpose === 'video') expect(model.pricing.unit).toBe('second')
      // Un precio temporal siempre dice hasta cuándo vale.
      expect(model.pricing.status === 'temporary').toBe(Boolean(model.pricing.validUntil))
      if (model.pricing.validUntil) expect(model.pricing.detail).toContain(model.pricing.validUntil.split('-').reverse().join('/'))
      // Nunca se presenta como gratuito un modelo de pago (sí se puede decir si el proveedor tiene o no nivel gratuito).
      expect(model.pricing.detail).not.toMatch(/gratis|es gratuito|sin coste/i)
    } else {
      // Sin precio verificado: se dice, no se inventa.
      expect(model.notes).toMatch(/[Cc]onsulta la tarifa del proveedor/)
      expect(estimateCostMicroUsd(model, 6)).toBeNull()
    }
  })

  it('ningún modelo retirado o cerrado figura en el catálogo', () => {
    const ids = models.map(({ model }) => model.id)
    for (const retired of [
      'sora-2', 'sora-2-pro', 'gpt-image-1', 'gpt-image-2', 'gpt-image-1.5', 'dall-e-3',
      'veo-3.1-generate-preview', 'veo-3.0-generate-001', 'imagen-4.0-generate-001', 'gemini-omni-1.1-flash', 'gemini-2.5-flash-image', 'gemini-2.0-flash',
      'claude-3-opus-20240229', 'claude-sonnet-4-5-20250929', 'llama-3.3-70b-versatile', 'gen3a_turbo', 'gen4_aleph', 'ray-2', 'recraftv3',
    ]) expect(ids).not.toContain(retired)
    // Sora y Veo ya no existen como API directa: no hay vídeo en OpenAI ni Veo en Gemini.
    expect(REAL_PROVIDERS.find(provider => provider.id === 'openai')!.models.some(model => model.purpose === 'video')).toBe(false)
    expect(REAL_PROVIDERS.find(provider => provider.id === 'gemini')!.models.some(model => /veo/i.test(model.id))).toBe(false)
    // Luma no está integrado (exige URL públicas para las fotografías).
    expect(all.some(provider => /luma/i.test(provider.id))).toBe(false)
  })

  it('un modelo con fecha de retirada vencida deja de ser elegible, sin sustituirse por otro', () => {
    const { provider, model } = models[0]
    const retired = { ...model, retiresAt: '2026-01-01' }
    expect(isSelectable(retired, new Date('2026-11-12T00:00:00Z'))).toBe(false)
    expect(isSelectable({ ...model, retiresAt: '2027-01-01' }, new Date('2026-11-12T00:00:00Z'))).toBe(true)
    expect(isSelectable({ ...model, status: 'retired' })).toBe(false)
    expect(() => resolveModel(provider.id, 'modelo-inexistente', model.purpose)).toThrow(AiMediaError)
  })

  it('estimación de coste: solo cuando el precio lo permite', () => {
    const find = (provider: string, id: string) => models.find(item => item.provider.id === provider && item.model.id === id)!.model
    expect(estimateCostMicroUsd(find('xai', 'grok-imagine-image-2.0'))).toBe(40_000)
    expect(estimateCostMicroUsd(find('runway', 'gen4.5'), 6)).toBe(720_000)
    expect(estimateCostMicroUsd(find('runway', 'veo3.1'), 8)).toBe(1_600_000)
    expect(estimateCostMicroUsd(find('fal', 'bytedance/seedance-2.0/fast/image-to-video'), 4)).toBe(967_600)
    // Por tokens, por megapíxel o por calidad: no se estima un importe.
    expect(estimateCostMicroUsd(find('openai', 'gpt-image-2.6-flare'))).toBeNull()
    expect(estimateCostMicroUsd(find('fal', 'fal-ai/flux-2'))).toBeNull()
    expect(estimateCostMicroUsd(find('runway', 'gpt_image_2_6_flare'))).toBeNull()
    expect(estimateCostMicroUsd(find('anthropic', 'claude-sonnet-5-5'))).toBeNull()
    // El mismo modelo cuesta distinto en el agregador que en el fabricante: no se copia el precio directo.
    expect(find('runway', 'grok_imagine_1_5').pricing!.usd).not.toBe(find('xai', 'grok-imagine-video-1.5').pricing!.usd)
    expect(find('runway', 'grok_imagine_1_5').pricing!.source).toMatch(/runwayml/)
  })

  it('un precio temporal caducado no se muestra ni se usa para estimar', () => {
    const temporary = models.filter(item => item.model.pricing?.status === 'temporary')
    expect(temporary.map(item => item.model.id)).toEqual(expect.arrayContaining(['gemini-4-carbon', 'kling_4', 'minimax/h3-max/image-to-video']))
    for (const { provider, model } of temporary) {
      const until = model.pricing!.validUntil!
      const lastDay = new Date(`${until}T23:59:59Z`)
      const nextDay = new Date(lastDay.getTime() + 1000)
      // Vale hasta el final de su último día (los precios por tokens no se estiman nunca).
      expect(activePricing(model, lastDay)).toBe(model.pricing)
      expect(estimateCostMicroUsd(model, 6, lastDay)).toBe(model.pricing!.unit === 'second' ? Math.round(model.pricing!.usd * 6_000_000) : null)
      // Al día siguiente: sin precio (la web indica «Consultar tarifa del proveedor») y sin estimación.
      expect(activePricing(model, nextDay)).toBeNull()
      expect(estimateCostMicroUsd(model, 6, nextDay)).toBeNull()
      expect(publicProvider(provider, nextDay).models.find(item => item.id === model.id)!.pricing).toBeNull()
      expect(publicProvider(provider, lastDay).models.find(item => item.id === model.id)!.pricing).toBe(model.pricing)
    }
    // Un precio sin fecha de fin no caduca.
    const confirmed = models.find(item => item.model.pricing?.status === 'confirmed')!.model
    expect(activePricing(confirmed, new Date('2030-01-01T00:00:00Z'))).toBe(confirmed.pricing)
  })
})

describe('catálogo: información pública y código', () => {
  it('la información pública no incluye patrones de clave, hosts ni protocolos', () => {
    for (const provider of all) {
      const info = publicProvider(provider)
      expect(Object.keys(info)).not.toEqual(expect.arrayContaining(['keyPattern', 'allowedHosts', 'resultHosts', 'text']))
      expect(info.models.every(model => model.selectable)).toBe(true)
    }
  })

  it('ningún adaptador admite una URL, un host o un endpoint del usuario', () => {
    const dir = resolve(import.meta.dirname, 'adapters')
    for (const file of readdirSync(dir).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(/baseURL|base_url|webhook_url|callback_url|process\.env/)
      // Toda llamada de red pasa por el cliente con lista de hosts.
      expect(source, file).not.toMatch(/[^.\w]fetch\(/)
    }
  })
})
