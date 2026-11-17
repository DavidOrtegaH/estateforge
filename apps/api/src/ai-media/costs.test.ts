import { describe, expect, it } from 'vitest'

import { createAIProvider } from '../ai/ai-provider.factory.js'
import { fetchMock, jsonResponse } from '../test-support/fetch-mock.js'
import type { SubmitRequest } from './adapter.js'
import { createRunwayAdapter } from './adapters/runway.adapter.js'
import { REAL_PROVIDERS } from './catalog.js'
import { costBreakdown, GEMINI_CLASSIFIER, MAX_PRICE_AGE_DAYS, textUsageCost } from './costs.js'
import { buildPosterPrompt, buildVideoPrompt } from './prompts.js'
import { findProvider, withCatalogGuard } from './registry.js'
import { TRIAL_PRESETS } from './trial-presets.js'

// Desglose del coste de las pruebas reales (DA-92), presets (DA-93) y consumo de texto. Con respuestas
// simuladas: ninguna prueba llama a un proveedor real.

const KEY = 'clave-FICTICIA-de-prueba-que-no-es-real-0000'
const model = (provider: string, id: string) => findProvider(provider)!.models.find(item => item.id === id)!
const TODAY = new Date('2026-11-15T12:00:00Z')
const gemini = { provider: 'gemini', name: 'Google Gemini' }

describe('las seis pruebas propuestas', () => {
  it('cada una apunta a un modelo vigente del catálogo, del uso correcto y con lo que admite', () => {
    expect(TRIAL_PRESETS.map(preset => `${preset.provider}:${preset.model}`)).toEqual(['openai:gpt-6-luna', 'groq:openai/gpt-oss-20b', 'gemini:gemini-3.1-flash-lite-image', 'runway:nano_banana_2.1', 'xai:grok-imagine-video-1.5-lite', 'runway:gemini_omni_flash_1.2'])
    for (const preset of TRIAL_PRESETS) {
      const provider = REAL_PROVIDERS.find(item => item.id === preset.provider)!
      const m = provider.models.find(item => item.id === preset.model && item.purpose === preset.kind)
      expect(m, preset.id).toBeDefined()
      expect(m!.pricing?.consultedAt, preset.id).toBe('2026-11-15')
      if (preset.kind === 'video') {
        expect(m!.video!.durations).toContain(preset.durationSeconds)
        expect(preset.references).toBe(1)
      }
      if (preset.resolution) expect(m!.video!.resolutionOptions!.map(option => option.id)).toContain(preset.resolution)
      expect(preset.references).toBeLessThanOrEqual(m!.maxReferenceImages)
    }
    // Una API directa y un agregador por modalidad.
    for (const kind of ['text', 'poster', 'video'] as const) {
      const kinds = TRIAL_PRESETS.filter(preset => preset.kind === kind).map(preset => REAL_PROVIDERS.find(item => item.id === preset.provider)!.kind)
      expect(kinds.sort()).toEqual(['aggregator', 'direct'])
    }
  })
})

describe('desglose del coste', () => {
  it('Runway Gemini Omni Flash 1.2 a 360p, 4 s y una referencia: 0,08 $ + 0,01 $; el clasificador de Gemini no es estimable', () => {
    const cost = costBreakdown(model('runway', 'gemini_omni_flash_1.2'), { kind: 'video', durationSeconds: 4, resolution: '360p', references: 1, moderation: gemini }, TODAY)
    expect(cost.lines.map(line => [line.concept, line.usd])).toEqual([
      ['Generación (4 s a 360p (640×360))', 0.08],
      ['Imágenes de referencia (1)', 0.01],
      ['Clasificador de seguridad (Google Gemini, con tu clave)', null],
    ])
    expect(cost.knownUsd).toBe(0.09)
    expect(cost.complete).toBe(false)
    expect(cost.lines[2].detail).toContain(GEMINI_CLASSIFIER.model)
    // A 720p: 0,07 $/s.
    expect(costBreakdown(model('runway', 'gemini_omni_flash_1.2'), { kind: 'video', durationSeconds: 4, resolution: '720p', references: 1, moderation: null }, TODAY).knownUsd).toBe(0.29)
  })

  it('el mínimo por petición se aplica cuando el importe es menor', () => {
    const m = model('runway', 'gemini_omni_flash_1.2')
    const cheap = { ...m, video: { ...m.video!, durations: [2] } }
    expect(costBreakdown(cheap, { kind: 'video', durationSeconds: 2, resolution: '360p', references: 0, moderation: null }, TODAY).lines[0].usd).toBe(0.06)
  })

  it('xAI: precio de la imagen de entrada no publicado → no estimable, sin inventarlo', () => {
    const cost = costBreakdown(model('xai', 'grok-imagine-video-1.5-lite'), { kind: 'video', durationSeconds: 4, references: 1, moderation: gemini }, TODAY)
    expect(cost.lines[0].usd).toBe(0.08)
    expect(cost.lines[1]).toMatchObject({ usd: null, detail: expect.stringMatching(/no publica/) })
    expect(cost.knownUsd).toBe(0.08)
  })

  it('imágenes: Gemini a 0,0336 $; Runway Nano Banana 2.1 a 0,04 $ y sus referencias no añaden coste', () => {
    expect(costBreakdown(model('gemini', 'gemini-3.1-flash-lite-image'), { kind: 'poster', references: 0, moderation: gemini }, TODAY).lines[0].usd).toBe(0.0336)
    const runway = costBreakdown(model('runway', 'nano_banana_2.1'), { kind: 'poster', references: 1, moderation: gemini }, TODAY)
    expect(runway.lines.slice(0, 2).map(line => line.usd)).toEqual([0.04, 0])
  })

  it('texto: por tokens, no se calcula por adelantado; OpenAI como clasificador es gratuito', () => {
    const text = costBreakdown(model('openai', 'gpt-6-luna'), { kind: 'text', references: 0, moderation: null }, TODAY)
    expect(text.lines).toHaveLength(1)
    expect(text.lines[0]).toMatchObject({ usd: null, detail: expect.stringMatching(/por millón de entrada.*por millón de salida/) })
    expect(costBreakdown(model('recraft', 'recraftv4_1'), { kind: 'poster', references: 0, moderation: { provider: 'openai', name: 'OpenAI' } }, TODAY).lines[1].usd).toBe(0)
  })

  it(`un precio consultado hace más de ${MAX_PRICE_AGE_DAYS} días se marca para comprobarlo`, () => {
    const m = model('runway', 'nano_banana_2.1')
    expect(costBreakdown(m, { kind: 'poster', references: 0, moderation: null }, TODAY).priceStale).toBe(false)
    const later = costBreakdown(m, { kind: 'poster', references: 0, moderation: null }, new Date('2026-11-30T12:00:00Z'))
    expect(later).toMatchObject({ priceStale: true, priceAgeDays: 15 })
  })

  it('consumo real de texto: con los tokens que devuelve la API; sin ellos, se dice', () => {
    expect(textUsageCost(model('openai', 'gpt-6-luna'), { inputTokens: 1000, outputTokens: 500 }, TODAY)).toMatchObject({ reported: true, inputTokens: 1000, outputTokens: 500, estimatedUsd: 0.00035 })
    expect(textUsageCost(model('openai', 'gpt-6-luna'), undefined, TODAY)).toMatchObject({ reported: false })
  })
})

describe('Runway con resolución por petición', () => {
  const runway = findProvider('runway')!
  const png = { mimeType: 'image/png' as const, data: Buffer.from('89504e470d0a1a0a0000000d49484452000000080000000808020000004b6d29dc0000000c4944415478da63f8ffff3f0005fe02fe0dc4a2a40000000049454e44ae426082', 'hex') }
  const video = (resolution?: string): SubmitRequest => ({ kind: 'video', model: 'gemini_omni_flash_1.2', prompt: buildVideoPrompt({ type: 'apartment', operation: 'sale' }, 4, 1), references: [png], durationSeconds: 4, ...(resolution && { resolution }) })

  it('360p pide la relación 640:360 y 720p (o sin indicar) la 1280:720; sin campo de audio', async () => {
    for (const [resolution, ratio] of [['360p', '640:360'], ['720p', '1280:720'], [undefined, '1280:720']] as const) {
      const mock = fetchMock(() => jsonResponse({ id: 'task_1' }))
      await withCatalogGuard(runway, createRunwayAdapter({ fetchImpl: mock.impl })).submit({ apiKey: KEY }, video(resolution))
      expect(mock.calls[0].url).toBe('https://api.dev.runwayml.com/v1/image_to_video')
      expect(mock.calls[0].body).toMatchObject({ model: 'gemini_omni_flash_1.2', ratio, duration: 4 })
      expect(mock.calls[0].body).not.toHaveProperty('audio')
    }
  })

  it('una resolución que el modelo no ofrece, o una resolución en un cartel, se rechaza sin llamar', async () => {
    const mock = fetchMock(() => {
      throw new Error('no debe llamar')
    })
    const adapter = withCatalogGuard(runway, createRunwayAdapter({ fetchImpl: mock.impl }))
    await expect(adapter.submit({ apiKey: KEY }, video('1080p'))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
    await expect(adapter.submit({ apiKey: KEY }, { ...video('360p'), model: 'gen4.5' })).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
    await expect(adapter.submit({ apiKey: KEY }, { kind: 'poster', model: 'nano_banana_2.1', prompt: buildPosterPrompt({ type: 'apartment', operation: 'sale' }), references: [], resolution: '360p' })).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
    expect(mock.calls).toHaveLength(0)
  })
})

describe('consumo de texto devuelto por la API', () => {
  const listing = { title: 'Piso de prueba', description: 'Inmueble ficticio.', highlights: ['Ascensor'], callToAction: 'Prueba' }

  it('API de chat (Groq): lee usage.prompt_tokens y completion_tokens', async () => {
    const mock = fetchMock(() => jsonResponse({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(listing) } }], usage: { prompt_tokens: 812, completion_tokens: 230 } }))
    const provider = createAIProvider('groq', { apiKey: KEY, model: 'openai/gpt-oss-20b', fetchImpl: mock.impl })
    await provider.generate('x')
    expect(provider.lastUsage).toEqual({ inputTokens: 812, outputTokens: 230 })
  })

  it('sin usage, o con valores que no son enteros, no se inventa nada', async () => {
    for (const usage of [undefined, { prompt_tokens: 'mucho', completion_tokens: -1 }]) {
      const mock = fetchMock(() => jsonResponse({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(listing) } }], ...(usage && { usage }) }))
      const provider = createAIProvider('groq', { apiKey: KEY, model: 'openai/gpt-oss-20b', fetchImpl: mock.impl })
      await provider.generate('x')
      expect(provider.lastUsage).toBeUndefined()
    }
  })
})
