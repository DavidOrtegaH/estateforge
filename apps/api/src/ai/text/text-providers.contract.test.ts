import { beforeEach, describe, expect, it } from 'vitest'

import { findProvider } from '../../ai-media/registry.js'
import { fetchMock, jsonResponse, serialized } from '../../test-support/fetch-mock.js'
import { createAIProvider } from '../ai-provider.factory.js'
import { discoverOpenRouterModels, filterDiscovered, OPENROUTER_ID, resetOpenRouterDiscoveryCache } from './openrouter-discovery.js'
import { JSON_INSTRUCTIONS, LISTING_JSON_SCHEMA } from './text-providers.js'

// Pruebas de CONTRATO de los proveedores de texto por HTTP (DA-82): Anthropic, xAI, Mistral, DeepSeek,
// OpenRouter y Groq. fetch está simulado: ninguna prueba llama a un proveedor ni usa una clave real.
// Comprueban la petición que EstateForge envía y la respuesta que espera, según la documentación oficial
// consultada el 12/11/2026. No sustituyen a una prueba contra el servicio real, que sigue pendiente.

const KEY = 'clave-FICTICIA-de-prueba-que-no-es-real-0000'
const listing = { title: 'Piso luminoso', description: 'Exterior y reformado.', highlights: ['Exterior'], callToAction: 'Pide visita' }
const chat = (content: string, extra: Record<string, unknown> = {}) => jsonResponse({ id: 'x', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content }, ...extra }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })

interface Case {
  provider: 'xai' | 'mistral' | 'deepseek' | 'openrouter' | 'groq'
  model: string
  url: string
  strict: boolean
  maxTokens: 'max_tokens' | 'max_completion_tokens'
  extra?: Record<string, unknown>
}
const CASES: Case[] = [
  { provider: 'xai', model: 'grok-4.3', url: 'https://api.x.ai/v1/chat/completions', strict: true, maxTokens: 'max_completion_tokens' },
  { provider: 'mistral', model: 'mistral-large-latest', url: 'https://api.mistral.ai/v1/chat/completions', strict: false, maxTokens: 'max_tokens' },
  { provider: 'deepseek', model: 'deepseek-flash', url: 'https://api.deepseek.com/chat/completions', strict: false, maxTokens: 'max_tokens', extra: { thinking: { type: 'disabled' } } },
  { provider: 'openrouter', model: '~anthropic/claude-sonnet-latest', url: 'https://openrouter.ai/api/v1/chat/completions', strict: true, maxTokens: 'max_tokens', extra: { provider: { require_parameters: true } } },
  { provider: 'groq', model: 'openai/gpt-oss-120b', url: 'https://api.groq.com/openai/v1/chat/completions', strict: true, maxTokens: 'max_completion_tokens' },
]

describe.each(CASES)('$provider: API de chat con host fijo', ({ provider, model, url, strict, maxTokens, extra }) => {
  const generate = (handler: Parameters<typeof fetchMock>[0], chosen = model) => {
    const mock = fetchMock(handler)
    return { mock, result: createAIProvider(provider, { apiKey: KEY, model: chosen, fetchImpl: mock.impl }).generate('PROMPT DEL ANUNCIO') }
  }

  it('petición: URL fija del catálogo, Bearer con la clave del usuario, modelo exacto y JSON del anuncio', async () => {
    const { mock, result } = generate(() => chat(JSON.stringify(listing)))
    await expect(result).resolves.toEqual(listing)
    expect(mock.calls).toHaveLength(1)
    const call = mock.calls[0]
    expect(call.url).toBe(url)
    expect(call.method).toBe('POST')
    expect(call.redirect).toBe('error')
    expect(call.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(call.headers.get('content-type')).toBe('application/json')
    const body = call.body!
    expect(body.model).toBe(model)
    expect(body[maxTokens]).toBe(4000)
    if (strict) {
      expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'generated_listing', strict: true, schema: LISTING_JSON_SCHEMA } })
      expect(body.messages).toEqual([{ role: 'user', content: 'PROMPT DEL ANUNCIO' }])
    } else {
      // Modo JSON sin esquema: la forma se describe en el mensaje (con la palabra «json») y se valida en la API.
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.messages).toEqual([{ role: 'system', content: JSON_INSTRUCTIONS }, { role: 'user', content: 'PROMPT DEL ANUNCIO' }])
      expect(JSON_INSTRUCTIONS).toMatch(/json/)
    }
    for (const [name, value] of Object.entries(extra ?? {})) expect(body[name]).toEqual(value)
    // Solo los campos previstos: sin herramientas, funciones, muestreo ni URL del usuario.
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'response_format', maxTokens, ...Object.keys(extra ?? {})].sort())
    for (const forbidden of ['tools', 'tool_choice', 'functions', 'temperature', 'top_p', 'stream', 'base_url', 'baseURL']) expect(body).not.toHaveProperty(forbidden)
    // La clave va solo en la cabecera.
    expect(serialized(mock.calls, 'url')).not.toContain(KEY)
    expect(serialized(mock.calls, 'body')).not.toContain(KEY)
  })

  it('el host de la URL es uno de los hosts permitidos del proveedor', () => {
    const definition = findProvider(provider, {})!
    expect(definition.allowedHosts).toContain(new URL(url).hostname)
    expect(definition.text).toMatchObject({ protocol: 'chat-completions', url })
  })

  it.each([
    ['sin contenido', chat(''), /no devolvió contenido/],
    ['contenido nulo', jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: null } }] }), /no devolvió contenido/],
    ['contenido en blanco (JSON no reconocido)', chat('     '), /no devolvió contenido/],
    ['sin choices', jsonResponse({}), /no devolvió contenido/],
    ['texto que no es JSON', chat('Lo siento, no puedo ayudar.'), /no es JSON válido/],
    ['JSON con otra forma', chat(JSON.stringify({ titulo: 'x' })), /formato inválido/],
    ['tipo incorrecto', chat(JSON.stringify({ ...listing, highlights: 'Exterior' })), /formato inválido/],
    ['respuesta cortada', jsonResponse({ choices: [{ finish_reason: 'length', message: { content: '{"title":"Pi' } }] }), /ha cortado la respuesta/],
    ['filtro de contenido', jsonResponse({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }), /filtros de seguridad/],
    ['negativa del modelo', jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '', refusal: 'No puedo.' } }] }), /filtros de seguridad/],
  ])('respuesta %s: error controlado y una sola llamada', async (_label, response, message) => {
    const { mock, result } = generate(() => response.clone())
    await expect(result).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', message: expect.stringMatching(message) })
    expect(mock.calls).toHaveLength(1)
  })

  it.each([
    [401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }, 'AI_INVALID_API_KEY'],
    [402, { error: { message: 'Insufficient Balance' } }, 'AI_QUOTA_EXCEEDED'],
    [404, { error: { message: 'The model does not exist', code: 'model_not_found' } }, 'AI_MODEL_NOT_ALLOWED'],
    [429, { error: { message: 'Rate limit reached for requests', type: 'invalid_request_error' } }, 'AI_RATE_LIMITED'],
    [429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }, 'AI_QUOTA_EXCEEDED'],
    [500, { error: { message: 'Server error' } }, 'AI_PROVIDER_ERROR'],
    [503, {}, 'AI_PROVIDER_ERROR'],
  ])('HTTP %s → %s: se informa; sin reintento, sin otro modelo y sin otro proveedor', async (status, body, code) => {
    const { mock, result } = generate(() => jsonResponse(body, status))
    const error = await result.catch(e => e)
    expect(error).toMatchObject({ code })
    // El mensaje al usuario no contiene la clave ni el texto del proveedor.
    expect(String(error.message)).not.toContain(KEY)
    expect(String(error.message)).not.toMatch(/Incorrect API key|Insufficient Balance|exceeded your current quota/)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe(url)
    expect(mock.calls[0].body!.model).toBe(model)
  })

  it('una redirección del proveedor no se sigue', async () => {
    const { mock, result } = generate(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }))
    await expect(result).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    expect(mock.calls).toHaveLength(1)
  })

  it('sin clave no se hace ninguna llamada', () => {
    const mock = fetchMock(() => chat(JSON.stringify(listing)))
    expect(() => createAIProvider(provider, { apiKey: '', model, fetchImpl: mock.impl })).toThrow(/API key/)
    expect(() => createAIProvider(provider, { apiKey: '   ', model, fetchImpl: mock.impl })).toThrow(/API key/)
    expect(() => createAIProvider(provider)).toThrow(/API key/)
    expect(mock.calls).toEqual([])
  })
})

describe('anthropic: API Messages', () => {
  const URL_MESSAGES = 'https://api.anthropic.com/v1/messages'
  const message = (text: string, stop = 'end_turn') => jsonResponse({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 20 } })
  const generate = (handler: Parameters<typeof fetchMock>[0], model = 'claude-sonnet-5-5') => {
    const mock = fetchMock(handler)
    return { mock, result: createAIProvider('anthropic', { apiKey: KEY, model, fetchImpl: mock.impl }).generate('PROMPT DEL ANUNCIO') }
  }

  it.each(['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'])('%s: x-api-key, versión de la API y salida estructurada; sin parámetros de muestreo', async model => {
    const { mock, result } = generate(() => message(JSON.stringify(listing)), model)
    await expect(result).resolves.toEqual(listing)
    const call = mock.calls[0]
    expect(call.url).toBe(URL_MESSAGES)
    expect(call.headers.get('x-api-key')).toBe(KEY)
    expect(call.headers.get('anthropic-version')).toBe('2026-10-21')
    expect(call.headers.get('authorization')).toBeNull()
    expect(call.body).toEqual({ model, max_tokens: 4000, messages: [{ role: 'user', content: 'PROMPT DEL ANUNCIO' }], output_config: { format: { type: 'json_schema', schema: LISTING_JSON_SCHEMA } } })
    // La versión 2026-10-21 rechaza temperature, top_p y top_k.
    for (const forbidden of ['temperature', 'top_p', 'top_k', 'tools', 'output_format']) expect(call.body).not.toHaveProperty(forbidden)
    expect(serialized(mock.calls, 'url') + serialized(mock.calls, 'body')).not.toContain(KEY)
  })

  it('el esquema solo usa lo que admite la salida estructurada (objetos cerrados, sin límites numéricos ni de longitud)', () => {
    expect(LISTING_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(JSON.stringify(LISTING_JSON_SCHEMA)).not.toMatch(/minimum|maximum|minLength|maxLength|minItems|maxItems|\$ref|pattern/)
  })

  it.each([
    ['negativa (stop_reason refusal)', message('', 'refusal'), /filtros de seguridad/],
    ['respuesta cortada (max_tokens)', message('{"title":"Pi', 'max_tokens'), /ha cortado la respuesta/],
    ['sin bloque de texto', jsonResponse({ content: [{ type: 'thinking', thinking: '…' }], stop_reason: 'end_turn' }), /no devolvió contenido/],
    ['texto que no es JSON', message('Hola'), /no es JSON válido/],
    ['JSON con otra forma', message('{"a":1}'), /formato inválido/],
  ])('respuesta %s: error controlado', async (_label, response, pattern) => {
    const { mock, result } = generate(() => response.clone())
    await expect(result).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', message: expect.stringMatching(pattern) })
    expect(mock.calls).toHaveLength(1)
  })

  it.each([
    [401, 'authentication_error', 'AI_INVALID_API_KEY'],
    // La clave es válida pero no tiene permiso (DA-87): no se presenta como clave inválida.
    [403, 'permission_error', 'AI_PERMISSION_DENIED'],
    [402, 'billing_error', 'AI_QUOTA_EXCEEDED'],
    [404, 'not_found_error', 'AI_MODEL_NOT_ALLOWED'],
    [429, 'rate_limit_error', 'AI_RATE_LIMITED'],
    [500, 'api_error', 'AI_PROVIDER_ERROR'],
    [529, 'overloaded_error', 'AI_PROVIDER_ERROR'],
  ])('HTTP %s (%s) → %s, una sola llamada', async (status, type, code) => {
    const { mock, result } = generate(() => jsonResponse({ type: 'error', error: { type, message: 'detalle interno' } }, status))
    const error = await result.catch(e => e)
    expect(error).toMatchObject({ code })
    expect(String(error.message)).not.toContain('detalle interno')
    expect(mock.calls).toHaveLength(1)
  })
})

describe('catálogo de texto: cada proveedor declara solo lo que genera', () => {
  it.each(['anthropic', 'xai', 'mistral', 'deepseek', 'openrouter', 'groq'])('%s: sus modelos de texto solo generan texto y tienen fabricante', id => {
    const provider = findProvider(id, {})!
    const models = provider.models.filter(model => model.purpose === 'text')
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      expect(model.outputs).toEqual(['text'])
      expect(model.maker.length).toBeGreaterThan(0)
      expect(model.maxReferenceImages).toBe(0)
    }
    expect(provider.capabilities).toContain('text')
  })

  it('Anthropic, Mistral, DeepSeek, OpenRouter y Groq no declaran imagen ni vídeo', () => {
    for (const id of ['anthropic', 'mistral', 'deepseek', 'openrouter', 'groq']) {
      const provider = findProvider(id, {})!
      expect(provider.capabilities.some(capability => ['image', 'video', 'image-reference', 'video-reference'].includes(capability))).toBe(false)
      expect(provider.models.every(model => model.purpose === 'text')).toBe(true)
    }
  })

  it('agregadores: el fabricante no es el proveedor y la nota indica a quién se factura', () => {
    for (const id of ['openrouter', 'groq']) {
      const provider = findProvider(id, {})!
      expect(provider.kind).toBe('aggregator')
      expect(provider.billing).toMatch(/no la del fabricante/)
      for (const model of provider.models) expect(model.maker).not.toMatch(new RegExp(provider.name, 'i'))
    }
    // Sin precio verificado para el agregador no se copia el del fabricante.
    for (const model of findProvider('openrouter', {})!.models) {
      expect(model.pricing).toBeNull()
      expect(model.notes).toMatch(/consulta la tarifa del proveedor/)
    }
  })

  it('no hay modelos retirados en el catálogo de texto', () => {
    const ids = ['anthropic', 'xai', 'mistral', 'deepseek', 'openrouter', 'groq', 'gemini', 'openai'].flatMap(id => findProvider(id, {})!.models.map(model => model.id))
    for (const retired of ['claude-3-opus-20240229', 'claude-sonnet-4-5-20250929', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mistral-large-2411', 'deepseek-chat', 'gemini-2.0-flash', 'gpt-4o', 'grok-voice-2.0']) expect(ids).not.toContain(retired)
  })
})

describe('OpenRouter: descubrimiento de modelos validado', () => {
  const model = (overrides: Record<string, unknown> = {}) => ({
    id: 'mistralai/mistral-large-4',
    name: 'Mistral Large 4',
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    supported_parameters: ['structured_outputs', 'max_tokens'],
    pricing: { prompt: '0.0000007', completion: '0.0000021' },
    context_length: 1_000_000,
    expiration_date: null,
    ...overrides,
  })
  const now = new Date('2026-11-12T12:00:00Z')

  beforeEach(() => resetOpenRouterDiscoveryCache())

  it('admite solo modelos que generan únicamente texto, con salida estructurada, vigentes y con un identificador válido', () => {
    const models = filterDiscovered(
      {
        data: [
          model(),
          model({ id: '~openai/gpt-sol-latest', name: 'GPT Sol' }),
          model({ id: 'google/imagen', architecture: { output_modalities: ['image'] } }),
          model({ id: 'x/multi', architecture: { output_modalities: ['text', 'image'] } }),
          model({ id: 'x/sin-esquema', supported_parameters: ['max_tokens'] }),
          model({ id: 'x/caducado', expiration_date: '2026-11-01' }),
          model({ id: 'x/gratis:free' }),
          model({ id: 'https://evil.example/v1' }),
          model({ id: '../../etc/passwd' }),
          model({ id: 'sin-barra' }),
          { id: 'x/forma-rara' },
        ],
      },
      now,
    )
    expect(models.map(item => item.id)).toEqual(['mistralai/mistral-large-4', '~openai/gpt-sol-latest'])
    expect(models[0]).toEqual({ id: 'mistralai/mistral-large-4', label: 'Mistral Large 4', maker: 'mistralai', verified: false })
    // Nunca se presentan como verificados.
    expect(models.every(item => item.verified === false)).toBe(true)
  })

  it('una respuesta con otra forma (como la observada en la API real) no se usa', () => {
    expect(() => filterDiscovered({ data: [{ id: 'anthropic/openai/gpt-6.1-sol', type: 'model', display_name: 'x', created_at: 'y', max_tokens: 1 }], has_more: false }, now)).toThrow()
    expect(() => filterDiscovered({ models: [] }, now)).toThrow()
    expect(() => filterDiscovered('texto', now)).toThrow()
    expect(filterDiscovered({ data: [] }, now)).toEqual([])
  })

  it('el identificador admitido no permite rutas, espacios ni URL', () => {
    for (const ok of ['anthropic/claude-sonnet-5.5', '~openai/gpt-sol-latest', 'meta-llama/llama-4:nitro']) expect(OPENROUTER_ID.test(ok)).toBe(true)
    for (const bad of ['a/b/c', 'a b/c', '/x', 'x/', 'http://x/y', 'A/b', 'x/..', '']) expect(OPENROUTER_ID.test(bad) && !bad.includes('..')).toBe(false)
  })

  it('consulta el catálogo con la clave del usuario, lo guarda una hora y no confía en un error', async () => {
    const mock = fetchMock(() => jsonResponse({ data: [model()] }))
    const first = await discoverOpenRouterModels(KEY, mock.impl, now)
    expect(first).toHaveLength(1)
    expect(mock.calls[0].url).toBe('https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs&output_modalities=text')
    expect(mock.calls[0].method).toBe('GET')
    expect(mock.calls[0].headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(mock.calls[0].url).not.toContain(KEY)
    // Segunda consulta dentro de la hora: sin otra llamada.
    await discoverOpenRouterModels(KEY, mock.impl, new Date(now.getTime() + 30 * 60 * 1000))
    expect(mock.calls).toHaveLength(1)
    await discoverOpenRouterModels(KEY, mock.impl, new Date(now.getTime() + 61 * 60 * 1000))
    expect(mock.calls).toHaveLength(2)
    resetOpenRouterDiscoveryCache()
    await expect(discoverOpenRouterModels(KEY, fetchMock(() => jsonResponse({}, 500)).impl, now)).rejects.toThrow()
    await expect(discoverOpenRouterModels(KEY, fetchMock(() => jsonResponse({ data: [{ id: 'x/y', type: 'model' }] })).impl, now)).rejects.toThrow()
  })
})
