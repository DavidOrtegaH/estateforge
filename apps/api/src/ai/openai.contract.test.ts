import { beforeEach, describe, expect, it, vi } from 'vitest'

// Pruebas de CONTRATO del texto con OpenAI (MD-35). El SDK está simulado: ninguna prueba llama a OpenAI
// ni usa una clave real. Comprueban la forma de la petición y de la respuesta que EstateForge espera de
// la API Responses, según la documentación oficial consultada el 12/11/2026. No sustituyen a una prueba
// contra el servicio real, que sigue pendiente.

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  constructed: [] as Record<string, unknown>[],
}))

vi.mock('openai', () => {
  const OpenAI = vi.fn().mockImplementation(function (options: Record<string, unknown>) {
    sdk.constructed.push(options)
    return { responses: { create: sdk.create } }
  })
  // El proveedor usa el export nombrado; se mantiene `default` como en el SDK real.
  return { OpenAI, default: OpenAI }
})

import { createOpenAIAdapter } from '../ai-media/adapters/openai.adapter.js'
import { findProvider, publicProvider, resolveModel } from '../ai-media/registry.js'
import { OpenAIProvider } from './openai.provider.js'

const KEY = 'sk-FAKE-clave-de-prueba-que-no-es-real-000000'
const listing = { title: 'Piso luminoso', description: 'Exterior y reformado.', highlights: ['Exterior'], callToAction: 'Pide visita' }
const openai = findProvider('openai', {})!
const textModels = openai.models.filter(model => model.purpose === 'text')
const apiError = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code })

beforeEach(() => {
  sdk.create.mockReset()
  sdk.constructed.length = 0
})

describe('catálogo de OpenAI (registro único)', () => {
  it('ofrece GPT-6.1 Terra (recomendado), GPT-6 Luna, GPT-6.1 Sol y GPT-5.5 (heredado), solo para texto', () => {
    expect(textModels.map(model => [model.id, model.tier])).toEqual([
      ['gpt-6.1-terra', 'recommended'],
      ['gpt-6-luna', 'alternative'],
      ['gpt-6.1-sol', 'alternative'],
      ['gpt-5.5', 'legacy'],
    ])
    // Que un modelo de texto admita imágenes de entrada no lo convierte en generador de imágenes: para
    // carteles solo valen los modelos GPT Image, y OpenAI no tiene vídeo (Sora se cerró el 24/09/2026).
    expect(openai.capabilities).toEqual(['text', 'image', 'image-reference', 'moderation'])
    expect(textModels.every(model => model.outputs.join() === 'text')).toBe(true)
    expect(() => resolveModel('openai', 'gpt-6.1-terra', 'poster')).toThrow(/no está admitido/)
    expect(() => resolveModel('openai', 'gpt-6.1-sol', 'video')).toThrow(/no admite este tipo/)
    expect(openai.models.filter(model => model.purpose === 'poster').map(model => model.id)).toEqual(['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])
  })

  it('precios por millón de tokens: entrada, entrada en caché y salida, con fuente oficial, fecha y modalidad', () => {
    const prices = Object.fromEntries(textModels.map(model => [model.id, model.pricing!.tokens]))
    expect(prices).toEqual({
      'gpt-6.1-terra': { inputUsd: 1, cachedInputUsd: 0.05, outputUsd: 5 },
      'gpt-6-luna': { inputUsd: 0.1, cachedInputUsd: 0.01, outputUsd: 0.5 },
      'gpt-6.1-sol': { inputUsd: 2, cachedInputUsd: 0.1, outputUsd: 10 },
      'gpt-5.5': { inputUsd: 5, cachedInputUsd: 0.5, outputUsd: 30 },
    })
    for (const model of textModels) {
      const pricing = model.pricing!
      // gpt-6-luna se volvió a verificar el 15/11/2026 para las pruebas reales propuestas (DA-93).
      expect(pricing).toMatchObject({ unit: 'million-tokens', currency: 'USD', status: 'confirmed', consultedAt: model.id === 'gpt-6-luna' ? '2026-11-15' : '2026-11-12' })
      expect(pricing.usd).toBe(pricing.tokens!.inputUsd)
      expect(pricing.source).toBe(`https://developers.openai.com/api/docs/models/${model.id}`)
      expect(pricing.context).toMatch(/estándar/i)
      expect(pricing.validUntil).toBeUndefined()
    }
  })

  it('un modelo fuera del catálogo o retirado no se puede elegir', () => {
    expect(() => resolveModel('openai', 'gpt-4o', 'text')).toThrow(/no está admitido/)
    expect(() => resolveModel('openai', 'gpt-5.6-sol', 'text')).toThrow(/no está admitido/)
    expect(() => resolveModel('openai', 'gpt-6-astra', 'text')).toThrow(/no está admitido/)
    expect(() => resolveModel('gemini', 'gpt-6.1-terra', 'text')).toThrow(/no está admitido/)
  })

  it('la información pública no contiene patrones de clave ni hosts, y distingue la comprobación de la generación', () => {
    const info = publicProvider(openai)
    expect(JSON.stringify(info)).not.toMatch(/keyPattern|allowedHosts|api\.openai\.com/)
    expect(info.verification).toMatch(/no genera contenido/)
    // La comprobación sin coste no convierte a ningún modelo en gratuito: todos tienen precio.
    expect(info.models.every(model => model.pricing && model.pricing.tokens!.outputUsd > 0)).toBe(true)
  })
})

describe('petición a la API Responses', () => {
  it.each(textModels.map(model => model.id))('%s: modelo exacto, salida estructurada estricta y ningún parámetro no documentado', async model => {
    sdk.create.mockResolvedValue({ output_text: JSON.stringify(listing) })
    await expect(new OpenAIProvider(KEY, model).generate('PROMPT DEL ANUNCIO')).resolves.toEqual(listing)

    // Sin reintentos del SDK (MD-51): un reintento podría repetir y cobrar dos veces una petición ya procesada.
    expect(sdk.constructed).toEqual([{ apiKey: KEY, timeout: 40_000, maxRetries: 0 }])
    expect(sdk.create).toHaveBeenCalledTimes(1)
    const request = sdk.create.mock.calls[0][0]
    expect(Object.keys(request).sort()).toEqual(['input', 'model', 'text'])
    expect(request.model).toBe(model)
    expect(request.input).toBe('PROMPT DEL ANUNCIO')
    expect(request.text.format).toMatchObject({ type: 'json_schema', name: 'generated_listing', strict: true })
    expect(request.text.format.schema).toMatchObject({
      type: 'object',
      required: ['title', 'description', 'highlights', 'callToAction'],
      additionalProperties: false,
    })
    // Sin herramientas, sin imágenes y sin parámetros de muestreo (temperature, top_p): los modelos de
    // razonamiento pueden rechazarlos y la documentación consultada no los menciona.
    for (const key of ['tools', 'temperature', 'top_p', 'store', 'reasoning', 'previous_response_id']) expect(request).not.toHaveProperty(key)
    // La clave va solo al cliente del SDK, nunca en el cuerpo.
    expect(JSON.stringify(request)).not.toContain(KEY)
  })

  it('sin clave no se construye el cliente', () => {
    expect(() => new OpenAIProvider('', 'gpt-6.1-terra')).toThrow(/API key/)
    expect(() => new OpenAIProvider('   ', 'gpt-6.1-terra')).toThrow(/API key/)
    expect(sdk.constructed).toEqual([])
  })
})

describe('respuesta de la API Responses', () => {
  const generate = () => new OpenAIProvider(KEY, 'gpt-6.1-terra').generate('p')

  it('acepta output_text con el JSON del anuncio, con espacios alrededor', async () => {
    sdk.create.mockResolvedValue({ output_text: `\n ${JSON.stringify(listing)} \n` })
    await expect(generate()).resolves.toEqual(listing)
  })

  it.each([
    ['sin contenido', { output_text: '' }, /no devolvió contenido/],
    ['sin el campo output_text', {}, /no devolvió contenido/],
    ['texto que no es JSON', { output_text: 'Lo siento, no puedo ayudar con eso.' }, /no es JSON válido/],
    ['JSON con otra forma', { output_text: JSON.stringify({ titulo: 'x' }) }, /formato inválido/],
    ['JSON con un tipo incorrecto', { output_text: JSON.stringify({ ...listing, highlights: 'Exterior' }) }, /formato inválido/],
  ])('%s: error controlado, sin reintento', async (_label, response, message) => {
    sdk.create.mockResolvedValue(response)
    await expect(generate()).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', message: expect.stringMatching(message) })
    expect(sdk.create).toHaveBeenCalledTimes(1)
  })
})

describe('errores del proveedor: se informan y no hay fallback', () => {
  it.each([
    ['clave rechazada (401)', apiError(401, 'invalid_api_key', 'Incorrect API key provided'), 'AI_INVALID_API_KEY'],
    ['modelo inexistente (404)', apiError(404, 'model_not_found', 'The model `gpt-9` does not exist or you do not have access to it.'), 'AI_MODEL_NOT_ALLOWED'],
    ['modelo retirado', apiError(404, 'model_not_found', 'The model `gpt-5.5` has been deprecated'), 'AI_MODEL_NOT_ALLOWED'],
    ['cuenta sin acceso al modelo', apiError(403, 'model_not_found', 'Project does not have access to model gpt-6.1-sol'), 'AI_MODEL_NOT_ALLOWED'],
    ['límite de peticiones (429)', apiError(429, 'rate_limit_exceeded', 'Rate limit reached for requests'), 'AI_RATE_LIMITED'],
    ['cuota agotada (429)', apiError(429, 'insufficient_quota', 'You exceeded your current quota, please check your plan and billing details.'), 'AI_QUOTA_EXCEEDED'],
    ['error interno (500)', apiError(500, 'server_error', 'The server had an error'), 'AI_PROVIDER_ERROR'],
    ['tiempo agotado', Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }), 'AI_TIMEOUT'],
  ])('%s → %s, una sola llamada, con el modelo elegido', async (_label, error, code) => {
    sdk.create.mockRejectedValue(error)
    await expect(new OpenAIProvider(KEY, 'gpt-6.1-sol').generate('p')).rejects.toMatchObject({ code, provider: 'OpenAI' })
    // Sin reintento, sin otro modelo y sin otro cliente (otra clave).
    expect(sdk.create).toHaveBeenCalledTimes(1)
    expect(sdk.create.mock.calls[0][0].model).toBe('gpt-6.1-sol')
    expect(sdk.constructed).toHaveLength(1)
  })

  it('el mensaje al usuario no contiene la clave ni el texto del proveedor', async () => {
    sdk.create.mockRejectedValue(apiError(401, 'invalid_api_key', `Incorrect API key provided: ${KEY}`))
    const error = await new OpenAIProvider(KEY, 'gpt-6-luna').generate('p').catch(e => e)
    expect(error.message).not.toContain(KEY)
    expect(error.message).not.toContain('Incorrect API key')
  })
})

describe('comprobación de la clave (no genera contenido)', () => {
  const adapterWith = (status: number) => {
    const fetchImpl = vi.fn(async () => new Response('{"object":"list","data":[]}', { status }))
    return { adapter: createOpenAIAdapter({ fetchImpl: fetchImpl as never }), fetchImpl }
  }

  it('GET /v1/models con Authorization: Bearer; no depende de un modelo concreto', async () => {
    const { adapter, fetchImpl } = adapterWith(200)
    // La lista (vacía en este simulador) se devuelve para el diagnóstico de modelos accesibles (DA-87).
    await expect(adapter.verifyKey({ apiKey: KEY })).resolves.toEqual({ ok: true, models: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('https://api.openai.com/v1/models')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(init.body).toBeUndefined()
    expect(String(url)).not.toContain(KEY)
  })

  it.each([
    [401, 'AI_INVALID_KEY'],
    // 403: clave reconocida sin permiso (proyecto, organización o región), no clave inválida (DA-87).
    [403, 'AI_PERMISSION_DENIED'],
    [429, 'AI_PROVIDER_QUOTA'],
    [500, 'AI_PROVIDER_UNAVAILABLE'],
    [404, 'AI_PROVIDER_UNAVAILABLE'],
  ])('HTTP %s → %s', async (status, code) => {
    const { adapter } = adapterWith(status)
    await expect(adapter.verifyKey({ apiKey: KEY })).resolves.toEqual({ ok: false, code })
  })

  it('un fallo de red no se confunde con una clave inválida', async () => {
    const adapter = createOpenAIAdapter({ fetchImpl: (async () => { throw new Error('ECONNRESET') }) as never })
    await expect(adapter.verifyKey({ apiKey: KEY })).resolves.toEqual({ ok: false, code: 'AI_PROVIDER_UNAVAILABLE' })
  })

  it('OpenAI no genera vídeo ni clasifica vídeo: cualquier intento se rechaza', async () => {
    const adapter = createOpenAIAdapter()
    await expect(adapter.submit({ apiKey: KEY }, { kind: 'video', model: 'sora-2', prompt: { instructions: '', data: {}, compact: '' }, references: [], durationSeconds: 6 })).rejects.toMatchObject({ code: 'AI_CAPABILITY_MISSING' })
    await expect(adapter.moderate({ apiKey: KEY }, { stage: 'output', kind: 'video', video: { mimeType: 'video/mp4', data: Buffer.from('x') } })).rejects.toMatchObject({ code: 'MODERATION_UNAVAILABLE' })
  })
})
