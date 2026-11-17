import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAIProvider } from '../ai/ai-provider.factory.js'
import { buildListingPrompt } from '../services/prompt.service.js'
import { fetchMock, jsonResponse, type RecordedCall } from '../test-support/fetch-mock.js'
import { makePng } from '../test-support/images.js'
import type { AiProviderAdapter, InputImage, SubmitRequest } from './adapter.js'
import { createBflAdapter } from './adapters/bfl.adapter.js'
import { createFalAdapter } from './adapters/fal.adapter.js'
import { createIdeogramAdapter } from './adapters/ideogram.adapter.js'
import { createOpenAIAdapter } from './adapters/openai.adapter.js'
import { createRecraftAdapter } from './adapters/recraft.adapter.js'
import { createReplicateAdapter } from './adapters/replicate.adapter.js'
import { createRunwayAdapter } from './adapters/runway.adapter.js'
import { createStabilityAdapter } from './adapters/stability.adapter.js'
import { createXaiAdapter } from './adapters/xai.adapter.js'
import { REAL_PROVIDERS } from './catalog.js'
import type { ModelDefinition, ProviderDefinition } from './catalog-types.js'
import { isAiMediaError } from './errors.js'
import { createGeminiAdapter } from './gemini.adapter.js'
import { PROVIDER_INTEGRATION } from './integration.js'
import { buildPosterPrompt, buildVideoPrompt } from './prompts.js'
import { withCatalogGuard } from './registry.js'
import type { FetchImpl } from './safe-fetch.js'
import { SYNTHETIC_PROPERTY } from './trials.service.js'

// Recorrido por los 65 modelos del catálogo (DA-88). Para cada modelo se construye la petición real con su
// adaptador y un fetch simulado, y se comprueba lo que el catálogo promete: host de la lista cerrada, modelo
// exacto, duración, imágenes de referencia, clave solo en la cabecera y ningún campo de URL del usuario.
// También que una configuración que el catálogo no admite se rechaza antes de llamar al proveedor.
// Es una prueba de contrato con respuestas simuladas: no dice nada del servicio real.

const KEY = 'clave-FICTICIA-de-prueba-que-no-es-real-0000'
const ctx = { apiKey: KEY }
const png: InputImage = { mimeType: 'image/png', data: makePng(320, 400, 5) }
/** Comienzo del base64 de la imagen: aparece en el cuerpo, con o sin prefijo data: según la API del proveedor. */
const PNG_B64 = png.data.toString('base64').slice(0, 48)

const FACTORIES: Record<string, (fetchImpl: FetchImpl) => AiProviderAdapter> = {
  gemini: fetchImpl => createGeminiAdapter({ fetchImpl }),
  openai: fetchImpl => createOpenAIAdapter({ fetchImpl }),
  xai: fetchImpl => createXaiAdapter({ fetchImpl }),
  bfl: fetchImpl => createBflAdapter({ fetchImpl }),
  stability: fetchImpl => createStabilityAdapter({ fetchImpl }),
  ideogram: fetchImpl => createIdeogramAdapter({ fetchImpl }),
  recraft: fetchImpl => createRecraftAdapter({ fetchImpl }),
  runway: fetchImpl => createRunwayAdapter({ fetchImpl }),
  fal: fetchImpl => createFalAdapter({ fetchImpl }),
  replicate: fetchImpl => createReplicateAdapter({ fetchImpl }),
}

/** Cómo aparece el modelo en la petición cuando no es su identificador literal (se comprueba en el adaptador). */
const MARKERS: Record<string, string> = {
  'stability:stable-image-core': '/v2beta/stable-image/generate/core',
  'stability:stable-image-ultra': '/v2beta/stable-image/generate/ultra',
}

const media = REAL_PROVIDERS.flatMap(provider => provider.models.filter(model => model.purpose !== 'text').map(model => ({ provider, model })))
const text = REAL_PROVIDERS.flatMap(provider => provider.models.filter(model => model.purpose === 'text').map(model => ({ provider, model })))

const hostAllowed = (provider: ProviderDefinition, url: string) => {
  const host = new URL(url).hostname
  return provider.allowedHosts.some(allowed => (allowed.startsWith('.') ? host.endsWith(allowed) : host === allowed))
}

function request(model: ModelDefinition, overrides: Partial<SubmitRequest> = {}): SubmitRequest {
  const video = model.purpose === 'video'
  const duration = video ? Math.min(...model.video!.durations) : undefined
  const references = model.maxReferenceImages > 0 ? [png] : []
  return {
    kind: model.purpose as 'poster' | 'video',
    model: model.id,
    prompt: video ? buildVideoPrompt({ type: 'apartment', operation: 'sale' }, duration!, references.length) : buildPosterPrompt({ type: 'apartment', operation: 'sale' }),
    references,
    durationSeconds: duration,
    ...overrides,
  }
}

function sent(call: RecordedCall): string {
  return `${call.url}\n${JSON.stringify(call.body ?? {})}`
}

describe('recorrido por los modelos de imagen y vídeo (contrato, respuestas simuladas)', () => {
  it('el catálogo tiene 65 modelos: 21 de texto, 24 de imagen y 20 de vídeo, y cada proveedor su adaptador y sus pruebas', () => {
    expect(text).toHaveLength(21)
    expect(media.filter(item => item.model.purpose === 'poster')).toHaveLength(24)
    expect(media.filter(item => item.model.purpose === 'video')).toHaveLength(20)
    for (const provider of REAL_PROVIDERS) {
      expect(PROVIDER_INTEGRATION[provider.id], provider.id).toBeDefined()
      if (provider.models.some(model => model.purpose !== 'text')) expect(FACTORIES[provider.id], provider.id).toBeDefined()
    }
  })

  it.each(media.map(({ provider, model }) => [`${provider.id} · ${model.id} (${model.purpose})`, provider, model] as const))('%s: petición del modelo exacto, a un host de la lista y sin URL del usuario', async (_name, provider, model) => {
    // El proveedor rechaza la petición (400): así se observa la petición sin simular un resultado.
    const mock = fetchMock(() => jsonResponse({ error: { message: 'rechazo simulado' } }, 400))
    const adapter = withCatalogGuard(provider, FACTORIES[provider.id](mock.impl))
    const req = request(model)
    const error = await adapter.submit(ctx, req).catch((caught: unknown) => caught)
    // Error controlado y sin reintentos: una sola petición de envío.
    expect(isAiMediaError(error), String(error)).toBe(true)
    expect(mock.calls).toHaveLength(1)
    const call = mock.calls[0]
    expect(call.method).toBe('POST')
    expect(hostAllowed(provider, call.url), call.url).toBe(true)
    expect(call.url.startsWith('https://')).toBe(true)
    const body = sent(call)
    expect(body).toContain(MARKERS[`${provider.id}:${model.id}`] ?? model.id)
    // La clave viaja solo en la cabecera; nunca en la URL ni en el cuerpo.
    expect(body).not.toContain(KEY)
    expect([...call.headers.values()].join(' ')).toContain(KEY)
    // Ningún webhook ni URL externa: las imágenes van en el propio cuerpo.
    expect(body).not.toMatch(/webhook|callback/i)
    expect(JSON.stringify(call.body ?? {})).not.toMatch(/"https?:\/\//)
    if (req.references.length > 0) expect(body.includes(PNG_B64) || body.includes('[archivo]'), 'la imagen de referencia no aparece en la petición').toBe(true)
    else expect(body.includes(PNG_B64) || body.includes('data:image/')).toBe(false)
    if (model.purpose === 'video') expect(body).toMatch(new RegExp(`(^|[^0-9])${req.durationSeconds}([^0-9]|$)`))
  })

  it.each(media.map(({ provider, model }) => [`${provider.id} · ${model.id}`, provider, model] as const))('%s: una configuración que el catálogo no admite se rechaza sin llamar al proveedor', async (_name, provider, model) => {
    const mock = fetchMock(() => {
      throw new Error('no debe llegar al proveedor')
    })
    const adapter = withCatalogGuard(provider, FACTORIES[provider.id](mock.impl))
    // Más imágenes de referencia de las admitidas.
    await expect(adapter.submit(ctx, request(model, { references: Array.from({ length: model.maxReferenceImages + 1 }, () => png) }))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
    if (model.purpose === 'video') {
      // Duración que el modelo no admite, o ninguna.
      await expect(adapter.submit(ctx, request(model, { durationSeconds: 99 }))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
      await expect(adapter.submit(ctx, request(model, { durationSeconds: undefined }))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
      // Un modelo de vídeo pedido como cartel.
      await expect(adapter.submit(ctx, request(model, { kind: 'poster', durationSeconds: undefined }))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    } else {
      await expect(adapter.submit(ctx, request(model, { durationSeconds: 6 }))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
      await expect(adapter.submit(ctx, request(model, { kind: 'video', durationSeconds: 6 }))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    }
    // Un modelo que no está en el catálogo de ese proveedor.
    await expect(adapter.submit(ctx, request(model, { model: `${model.id}-inexistente` }))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect(mock.calls).toHaveLength(0)
  })
})

describe('recorrido por los modelos de texto (contrato, respuestas simuladas)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(text.map(({ provider, model }) => [`${provider.id} · ${model.id}`, provider, model] as const))('%s: petición con el modelo exacto, salida estructurada y una sola llamada', async (_name, provider, model) => {
    const protocol = provider.text!
    const prompt = buildListingPrompt({ property: SYNTHETIC_PROPERTY, provider: provider.id as never, tone: 'professional', language: 'español' })
    if (protocol.protocol === 'chat-completions' || protocol.protocol === 'anthropic-messages') {
      const mock = fetchMock(() => jsonResponse({ error: { type: 'invalid_request_error', message: 'rechazo simulado' } }, 400))
      await expect(createAIProvider(provider.id as never, { apiKey: KEY, model: model.id, fetchImpl: mock.impl }).generate(prompt)).rejects.toBeTruthy()
      expect(mock.calls).toHaveLength(1)
      const call = mock.calls[0]
      expect(call.url).toBe(protocol.url)
      expect(call.body?.model).toBe(model.id)
      expect(sent(call)).not.toContain(KEY)
      if (protocol.protocol === 'chat-completions') {
        // Salida estructurada: esquema estricto o modo JSON, según el proveedor.
        expect((call.body?.response_format as { type?: string } | undefined)?.type).toBe(protocol.jsonMode)
        expect(call.body?.[protocol.maxTokensField]).toBeGreaterThan(0)
      } else {
        expect(call.headers.get('anthropic-version')).toBe(protocol.version)
        expect(call.body).not.toHaveProperty('temperature')
      }
      return
    }
    // SDK oficial (OpenAI, Gemini): se observa el fetch global que usa el SDK.
    const calls: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      const body = input instanceof Request ? await input.text() : typeof init?.body === 'string' ? init.body : ''
      calls.push({ url, body })
      return new Response(JSON.stringify({ error: { message: 'rechazo simulado', type: 'invalid_request_error', code: 'invalid_request' } }), { status: 400, headers: { 'content-type': 'application/json' } })
    })
    await expect(createAIProvider(provider.id as never, { apiKey: KEY, model: model.id }).generate(prompt)).rejects.toBeTruthy()
    // Una sola llamada: ni el SDK ni EstateForge reintentan (MD-51).
    expect(calls).toHaveLength(1)
    const host = new URL(calls[0].url).hostname
    expect(provider.allowedHosts).toContain(host)
    expect(`${calls[0].url}\n${calls[0].body}`).toContain(model.id)
    expect(calls[0].url).not.toContain(KEY)
  })

  it('OpenAI: un error 500 o de red no se reintenta (el SDK reintentaría por defecto y podría cobrar dos veces)', async () => {
    for (const failure of ['500', 'red'] as const) {
      let count = 0
      vi.stubGlobal('fetch', async () => {
        count += 1
        if (failure === 'red') throw new TypeError('fetch failed')
        return new Response(JSON.stringify({ error: { message: 'interno', type: 'server_error' } }), { status: 500, headers: { 'content-type': 'application/json' } })
      })
      await expect(createAIProvider('openai', { apiKey: KEY, model: 'gpt-6.1-terra' }).generate(buildListingPrompt({ property: SYNTHETIC_PROPERTY, provider: 'openai', tone: 'professional', language: 'español' }))).rejects.toBeTruthy()
      expect(count, failure).toBe(1)
    }
  })
})
