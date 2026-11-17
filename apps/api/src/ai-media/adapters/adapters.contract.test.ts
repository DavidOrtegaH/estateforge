import { describe, expect, it } from 'vitest'

import { bytesResponse, fetchMock, jsonResponse, serialized, type RecordedCall } from '../../test-support/fetch-mock.js'
import { makePng } from '../../test-support/images.js'
import type { AiProviderAdapter, InputImage, SubmitRequest } from '../adapter.js'
import { POSTER_COMPACT, VIDEO_COMPACT, buildPosterPrompt, buildVideoPrompt } from '../prompts.js'
import { findProvider } from '../registry.js'
import type { FetchImpl } from '../safe-fetch.js'
import { createBflAdapter } from './bfl.adapter.js'
import { createFalAdapter, FAL_MODELS } from './fal.adapter.js'
import { createIdeogramAdapter } from './ideogram.adapter.js'
import { createOpenAIAdapter } from './openai.adapter.js'
import { createRecraftAdapter } from './recraft.adapter.js'
import { createReplicateAdapter } from './replicate.adapter.js'
import { createRunwayAdapter, RUNWAY_IMAGE_MODELS, RUNWAY_VIDEO_MODELS } from './runway.adapter.js'
import { createStabilityAdapter } from './stability.adapter.js'
import { createVerifyOnlyAdapter } from './verify-only.adapter.js'
import { createXaiAdapter } from './xai.adapter.js'

// Pruebas de CONTRATO de los adaptadores de imagen y vídeo (DA-82). fetch está simulado: ninguna prueba
// llama a un proveedor ni usa una clave real. Comprueban, para cada proveedor, la petición que se envía
// (URL fija, autenticación, modelo y parámetros documentados), la interpretación de sus respuestas y
// estados, la cancelación, la descarga solo desde sus hosts de entrega y los errores. No sustituyen a una
// prueba contra el servicio real, que sigue pendiente para todos ellos.

const KEY = 'clave-FICTICIA-de-prueba-que-no-es-real-0000'
const ctx = { apiKey: KEY }
const photo = (seed: number): InputImage => ({ mimeType: 'image/png', data: makePng(64, 48, seed) })
const PNG_B64 = makePng(300, 300, 7).toString('base64')
const property = { type: 'apartment', operation: 'sale' }
const poster = (model: string, references: InputImage[] = []): SubmitRequest => ({ kind: 'poster', model, prompt: buildPosterPrompt(property), references })
const video = (model: string, seconds = 6, references: InputImage[] = [photo(1)]): SubmitRequest => ({ kind: 'video', model, prompt: buildVideoPrompt(property, seconds, references.length), references, durationSeconds: seconds })
const dataUrl = (image: InputImage) => `data:image/png;base64,${image.data.toString('base64')}`

/** La clave no viaja en ninguna URL ni en ningún cuerpo: solo en la cabecera de autenticación. */
function expectKeyOnlyInHeader(calls: RecordedCall[]) {
  expect(serialized(calls, 'url')).not.toContain(KEY)
  expect(serialized(calls, 'body')).not.toContain(KEY)
  for (const call of calls) expect(call.redirect).toBe('error')
}

/** Comprobación de la clave: un GET fijo que no genera contenido, y la traducción de sus respuestas. */
async function expectVerify(create: (fetchImpl: FetchImpl) => AiProviderAdapter, url: string, header: [string, string], method = 'GET') {
  const ok = fetchMock(() => jsonResponse({ ok: true }))
  await expect(create(ok.impl).verifyKey(ctx)).resolves.toEqual({ ok: true })
  expect(ok.calls).toHaveLength(1)
  expect(ok.calls[0].url).toBe(url)
  expect(ok.calls[0].method).toBe(method)
  expect(ok.calls[0].headers.get(header[0])).toBe(header[1])
  expectKeyOnlyInHeader(ok.calls)
  // 401: clave rechazada. 403: la clave se reconoce pero la cuenta no tiene permiso (DA-87): no es «clave inválida».
  for (const [status, code] of [[401, 'AI_INVALID_KEY'], [403, 'AI_PERMISSION_DENIED'], [402, 'AI_PROVIDER_QUOTA'], [429, 'AI_PROVIDER_QUOTA'], [500, 'AI_PROVIDER_UNAVAILABLE']] as const) {
    await expect(create(fetchMock(() => jsonResponse({}, status)).impl).verifyKey(ctx)).resolves.toEqual({ ok: false, code })
  }
  // Un fallo de red no se confunde con una clave inválida.
  await expect(create((async () => { throw new Error('ECONNRESET') }) as FetchImpl).verifyKey(ctx)).resolves.toEqual({ ok: false, code: 'AI_PROVIDER_UNAVAILABLE' })
}

/** La descarga del resultado solo se hace desde los hosts de entrega del proveedor (SSRF). */
async function expectDownloadHosts(adapter: (fetchImpl: FetchImpl) => AiProviderAdapter, allowed: string[], authHeader: [string, string] | null) {
  const bytes = makePng(300, 300, 3)
  for (const uri of allowed) {
    const mock = fetchMock(() => bytesResponse(bytes, 'image/png'))
    await expect(adapter(mock.impl).fetchResult(ctx, uri, 1024 * 1024)).resolves.toEqual(bytes)
    expect(mock.calls[0].url).toBe(uri)
    expect(mock.calls[0].redirect).toBe('error')
    if (authHeader) expect(mock.calls[0].headers.get(authHeader[0])).toBe(authHeader[1])
    else for (const name of ['authorization', 'x-key', 'api-key', 'x-api-key']) expect(mock.calls[0].headers.get(name)).toBeNull()
  }
  const blocked = fetchMock(() => bytesResponse(bytes, 'image/png'))
  for (const uri of [
    'https://evil.example/resultado.png',
    'http://' + new URL(allowed[0]).hostname + '/resultado.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://[::1]/x',
    'https://usuario:clave@' + new URL(allowed[0]).hostname + '/x',
    'https://' + new URL(allowed[0]).hostname + ':8443/x',
    'https://' + new URL(allowed[0]).hostname + '.evil.example/x',
    'file:///etc/passwd',
    'no-es-una-url',
  ]) {
    await expect(adapter(blocked.impl).fetchResult(ctx, uri, 1024 * 1024)).rejects.toMatchObject({ code: 'AI_SSRF_BLOCKED' })
  }
  expect(blocked.calls).toEqual([])
  // Un resultado mayor que el límite no se acepta, y una redirección no se sigue.
  await expect(adapter(fetchMock(() => bytesResponse(Buffer.alloc(2048), 'image/png')).impl).fetchResult(ctx, allowed[0], 1024)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  await expect(adapter(fetchMock(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })).impl).fetchResult(ctx, allowed[0], 1024)).rejects.toMatchObject({ code: 'AI_SSRF_BLOCKED' })
}

describe('OpenAI: GPT Image (síncrono) y clasificador omni-moderation', () => {
  const create = (fetchImpl: FetchImpl) => createOpenAIAdapter({ fetchImpl })

  it('comprobación: GET /v1/models', () => expectVerify(create, 'https://api.openai.com/v1/models', ['authorization', `Bearer ${KEY}`]))

  it.each(['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])('%s sin referencias: POST /v1/images/generations y resultado inmediato en base64', async model => {
    const mock = fetchMock(() => jsonResponse({ created: 1, data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 10, output_tokens: 100 } }))
    const result = await create(mock.impl).submit(ctx, poster(model))
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe('https://api.openai.com/v1/images/generations')
    expect(mock.calls[0].headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(mock.calls[0].body).toMatchObject({ model, size: '1024x1536', quality: 'medium', n: 1, output_format: 'png', moderation: 'auto' })
    expect(Object.keys(mock.calls[0].body!).sort()).toEqual(['model', 'moderation', 'n', 'output_format', 'prompt', 'quality', 'size'])
    expect(String(mock.calls[0].body!.prompt)).toContain('<datos_no_confiables>')
    expect(result.immediate).toMatchObject({ state: 'done', output: { mimeType: 'image/png' }, providerFlagged: false })
    expect((result.immediate as { output: { data: Buffer } }).output.data.toString('base64')).toBe(PNG_B64)
    expectKeyOnlyInHeader(mock.calls)
  })

  it('con referencias: POST /v1/images/edits con las fotografías como data URL (nunca una URL pública)', async () => {
    const references = [photo(1), photo(2)]
    const mock = fetchMock(() => jsonResponse({ data: [{ b64_json: PNG_B64 }] }))
    await create(mock.impl).submit(ctx, poster('gpt-image-2.6-flare', references))
    expect(mock.calls[0].url).toBe('https://api.openai.com/v1/images/edits')
    expect(mock.calls[0].body!.images).toEqual(references.map(image => ({ image_url: dataUrl(image) })))
  })

  it.each([
    [400, { error: { code: 'moderation_blocked', type: 'image_generation_user_error', message: 'blocked' } }, { code: 'AI_PROVIDER_FAILED', category: 'provider_safety_block' }],
    [401, { error: { code: 'invalid_api_key' } }, { code: 'AI_INVALID_KEY' }],
    [429, { error: { code: 'insufficient_quota' } }, { code: 'AI_PROVIDER_QUOTA' }],
    [400, { error: { message: 'invalid size' } }, { code: 'AI_PROVIDER_FAILED', category: null }],
    [500, {}, { code: 'AI_PROVIDER_UNAVAILABLE' }],
  ])('error HTTP %s: se informa sin reintento', async (status, body, expected) => {
    const mock = fetchMock(() => jsonResponse(body, status))
    await expect(create(mock.impl).submit(ctx, poster('gpt-image-2.6-flare'))).rejects.toMatchObject(expected)
    expect(mock.calls).toHaveLength(1)
  })

  it('una respuesta sin imagen no se da por buena', async () => {
    const result = await create(fetchMock(() => jsonResponse({ data: [] })).impl).submit(ctx, poster('gpt-image-2.6-flare'))
    expect(result.immediate).toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
  })

  it('clasificador: POST /v1/moderations con texto e imágenes; traduce las categorías a las de EstateForge', async () => {
    const mock = fetchMock(() => jsonResponse({ id: 'modr-1', model: 'omni-moderation-latest', results: [{ flagged: false, categories: { sexual: false, violence: false } }] }))
    const image = photo(4)
    await expect(create(mock.impl).moderate(ctx, { stage: 'input', kind: 'poster', text: { titulo: 'Piso', descripcion: 'Luminoso' }, images: [image] })).resolves.toEqual({ allowed: true, categories: [] })
    expect(mock.calls[0].url).toBe('https://api.openai.com/v1/moderations')
    expect(mock.calls[0].body).toEqual({ model: 'omni-moderation-latest', input: [{ type: 'text', text: 'Piso\nLuminoso' }, { type: 'image_url', image_url: { url: dataUrl(image) } }] })
    const flagged = fetchMock(() => jsonResponse({ results: [{ flagged: true, categories: { 'sexual/minors': true, violence: true, hate: false, 'categoria-nueva': true } }] }))
    const verdict = await create(flagged.impl).moderate(ctx, { stage: 'output', kind: 'poster', images: [image] })
    expect(verdict.allowed).toBe(false)
    expect(verdict.categories.sort()).toEqual(['provider_safety_block', 'sexual_minors', 'violence'])
  })

  it('clasificador: fallo seguro (sin resultado válido, error, vídeo o nada que clasificar → no disponible)', async () => {
    const image = photo(5)
    for (const response of [jsonResponse({}, 500), jsonResponse({ results: [] }), jsonResponse({ results: [{ categories: {} }] }), jsonResponse({ results: 'x' }), jsonResponse({}, 401)]) {
      await expect(create(fetchMock(() => response.clone()).impl).moderate(ctx, { stage: 'output', kind: 'poster', images: [image] })).rejects.toMatchObject({ code: 'MODERATION_UNAVAILABLE' })
    }
    await expect(create((async () => { throw new Error('red') }) as FetchImpl).moderate(ctx, { stage: 'output', kind: 'poster', images: [image] })).rejects.toMatchObject({ code: 'MODERATION_UNAVAILABLE' })
    const none = fetchMock(() => jsonResponse({ results: [{ flagged: false, categories: {} }] }))
    // No clasifica vídeo: nunca se aprueba un vídeo sin analizar.
    await expect(create(none.impl).moderate(ctx, { stage: 'output', kind: 'video', video: { mimeType: 'video/mp4', data: Buffer.from('x') }, images: [image] })).rejects.toMatchObject({ code: 'MODERATION_UNAVAILABLE' })
    await expect(create(none.impl).moderate(ctx, { stage: 'input', kind: 'poster' })).rejects.toMatchObject({ code: 'MODERATION_UNAVAILABLE' })
    expect(none.calls).toEqual([])
  })
})

describe('xAI: Grok Imagine Image (síncrono) y Grok Imagine Video (asíncrono)', () => {
  const create = (fetchImpl: FetchImpl) => createXaiAdapter({ fetchImpl })

  it('comprobación: GET /v1/models', () => expectVerify(create, 'https://api.x.ai/v1/models', ['authorization', `Bearer ${KEY}`]))

  it('imagen sin referencias y con referencias (edits con data URL)', async () => {
    const mock = fetchMock(() => jsonResponse({ data: [{ b64_json: PNG_B64, mime_type: 'image/jpeg' }] }))
    const result = await create(mock.impl).submit(ctx, poster('grok-imagine-image-2.0'))
    expect(mock.calls[0].url).toBe('https://api.x.ai/v1/images/generations')
    expect(mock.calls[0].body).toMatchObject({ model: 'grok-imagine-image-2.0', n: 1, aspect_ratio: '3:4', resolution: '1k', response_format: 'b64_json' })
    expect(result.immediate).toMatchObject({ state: 'done', output: { mimeType: 'image/jpeg' } })
    const references = [photo(1), photo(2), photo(3)]
    await create(mock.impl).submit(ctx, poster('grok-imagine-image', references))
    expect(mock.calls[1].url).toBe('https://api.x.ai/v1/images/edits')
    expect(mock.calls[1].body!.images).toEqual(references.map(image => ({ url: dataUrl(image) })))
    expectKeyOnlyInHeader(mock.calls)
  })

  it.each(['grok-imagine-video-1.5', 'grok-imagine-video-1.5-lite'])('%s: POST /v1/videos/generations con la fotografía principal, sin audio, y sondeo por request_id', async model => {
    const primary = photo(1)
    const mock = fetchMock(call => (call.method === 'POST' ? jsonResponse({ request_id: 'req_abc123' }) : jsonResponse({ status: 'pending', progress: 40 })))
    const adapter = create(mock.impl)
    const submitted = await adapter.submit(ctx, video(model, 8, [primary, photo(2)]))
    expect(submitted).toEqual({ operationId: 'req_abc123' })
    expect(mock.calls[0].url).toBe('https://api.x.ai/v1/videos/generations')
    expect(mock.calls[0].body).toMatchObject({ model, image: { url: dataUrl(primary) }, duration: 8, resolution: '720p', generate_audio: false })
    expect(Object.keys(mock.calls[0].body!).sort()).toEqual(['duration', 'generate_audio', 'image', 'model', 'prompt', 'resolution'])
    await expect(adapter.poll(ctx, 'req_abc123')).resolves.toEqual({ state: 'running' })
    expect(mock.calls[1].url).toBe('https://api.x.ai/v1/videos/req_abc123')
    expect(mock.calls[1].method).toBe('GET')
  })

  it('sondeo: 202 y pending siguen; done da la URL; failed por moderación bloquea; respect_moderation false no se acepta', async () => {
    const poll = (response: Response) => create(fetchMock(() => response).impl).poll(ctx, 'req_1')
    await expect(poll(jsonResponse({}, 202))).resolves.toEqual({ state: 'running' })
    await expect(poll(jsonResponse({ status: 'done', video: { url: 'https://vidgen.x.ai/xai-vidgen-bucket/xai-video-req_1.mp4', duration: 6, respect_moderation: true } }))).resolves.toEqual({ state: 'done', output: { mimeType: 'video/mp4', uri: 'https://vidgen.x.ai/xai-vidgen-bucket/xai-video-req_1.mp4' }, providerFlagged: false })
    await expect(poll(jsonResponse({ status: 'done', video: { url: 'https://vidgen.x.ai/v.mp4', respect_moderation: false } }))).resolves.toMatchObject({ state: 'done', providerFlagged: true })
    await expect(poll(jsonResponse({ status: 'failed', error: { code: 'invalid_argument', message: 'Content blocked by moderation' } }))).resolves.toEqual({ state: 'blocked', category: 'provider_safety_block' })
    await expect(poll(jsonResponse({ status: 'failed', error: { code: 'internal_error', message: 'x' } }))).resolves.toEqual({ state: 'failed', code: 'AI_PROVIDER_FAILED' })
    await expect(poll(jsonResponse({ status: 'done', video: {} }))).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
    await expect(poll(jsonResponse({}, 401))).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_KEY' })
    // Un error transitorio se reintenta en el siguiente sondeo.
    await expect(poll(jsonResponse({}, 503))).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' })
  })

  it('no hay cancelación documentada, y el vídeo exige la fotografía principal', async () => {
    const mock = fetchMock(() => jsonResponse({}))
    await expect(create(mock.impl).cancel(ctx, 'req_1')).resolves.toBe(false)
    await expect(create(mock.impl).submit(ctx, video('grok-imagine-video-1.5', 6, []))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
    expect(mock.calls).toEqual([])
  })

  it('el vídeo solo se descarga de vidgen.x.ai, sin la clave', () => expectDownloadHosts(create, ['https://vidgen.x.ai/xai-vidgen-bucket/xai-video-1.mp4'], null))
})

describe('Black Forest Labs: FLUX (asíncrono con URL de sondeo)', () => {
  const create = (fetchImpl: FetchImpl) => createBflAdapter({ fetchImpl })
  const POLL = 'https://api.eu.bfl.ai/v1/get_result?id=abc-123'

  it('comprobación: GET /v1/credits con x-key', () => expectVerify(create, 'https://api.bfl.ai/v1/credits', ['x-key', KEY]))

  it('FLUX 3 Image: referencias en base64, relación 4:5 y solo los campos del esquema', async () => {
    const references = [photo(1), photo(2)]
    const mock = fetchMock(() => jsonResponse({ id: 'abc-123', polling_url: POLL, cost: 4.8 }))
    await expect(create(mock.impl).submit(ctx, poster('flux-3-image', references))).resolves.toEqual({ operationId: POLL })
    expect(mock.calls[0].url).toBe('https://api.bfl.ai/v1/flux-3-image')
    expect(mock.calls[0].headers.get('x-key')).toBe(KEY)
    expect(mock.calls[0].headers.get('authorization')).toBeNull()
    expect(Object.keys(mock.calls[0].body!).sort()).toEqual(['aspect_ratio', 'images', 'prompt', 'resolution'])
    expect(mock.calls[0].body).toMatchObject({ aspect_ratio: '4:5', resolution: '1k', images: references.map(image => image.data.toString('base64')) })
    expectKeyOnlyInHeader(mock.calls)
  })

  it('FLUX.2 [pro]: input_image, input_image_2…; FLUX 3 Video: fotogramas clave, sin audio', async () => {
    const references = [photo(1), photo(2), photo(3)]
    const mock = fetchMock(() => jsonResponse({ id: 'abc-123', polling_url: POLL }))
    await create(mock.impl).submit(ctx, poster('flux-2-pro', references))
    expect(mock.calls[0].url).toBe('https://api.bfl.ai/v1/flux-2-pro')
    expect(mock.calls[0].body).toMatchObject({ width: 1024, height: 1280, output_format: 'png', input_image: references[0].data.toString('base64'), input_image_2: references[1].data.toString('base64'), input_image_3: references[2].data.toString('base64') })
    await create(mock.impl).submit(ctx, video('flux-3-video', 8, references))
    expect(mock.calls[1].url).toBe('https://api.bfl.ai/v1/flux-3-video')
    expect(mock.calls[1].body).toMatchObject({ mode: 'i2v', aspect_ratio: '16:9', duration: 8, resolution: 'hd', generate_audio: false })
    expect((mock.calls[1].body!.keyframes as string[]).length).toBe(3)
    await expect(create(mock.impl).submit(ctx, poster('flux-desconocido'))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
  })

  it('la URL de sondeo que devuelve el proveedor solo se acepta si es de BFL', async () => {
    for (const pollingUrl of ['https://evil.example/poll', 'http://api.bfl.ai/v1/get_result?id=1', 'https://169.254.169.254/x', 'https://bfl.ai.evil.example/x']) {
      await expect(create(fetchMock(() => jsonResponse({ id: 'x', polling_url: pollingUrl })).impl).submit(ctx, poster('flux-3-image'))).rejects.toMatchObject({ code: 'AI_SSRF_BLOCKED' })
    }
    await expect(create(fetchMock(() => jsonResponse({ id: 'x' })).impl).submit(ctx, poster('flux-3-image'))).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })

  it('sondeo de la URL devuelta: estados de BFL', async () => {
    const poll = (body: unknown, status = 200) => {
      const mock = fetchMock(() => jsonResponse(body, status))
      return { mock, state: create(mock.impl).poll(ctx, POLL) }
    }
    const first = poll({ id: 'abc', status: 'Pending' })
    await expect(first.state).resolves.toEqual({ state: 'running' })
    expect(first.mock.calls[0].url).toBe(POLL)
    expect(first.mock.calls[0].headers.get('x-key')).toBe(KEY)
    for (const status of ['Reasoning', 'Generating']) await expect(poll({ status }).state).resolves.toEqual({ state: 'running' })
    for (const status of ['Request Moderated', 'Content Moderated']) await expect(poll({ status, result: null, details: { 'Moderation Reasons': ['Violence'] } }).state).resolves.toEqual({ state: 'blocked', category: 'provider_safety_block' })
    for (const status of ['Error', 'Task not found', 'No Card Generated', 'Failed']) await expect(poll({ status }).state).resolves.toEqual({ state: 'failed', code: 'AI_PROVIDER_FAILED' })
    await expect(poll({ status: 'Ready', result: { sample: 'https://delivery.eu1.bfl.ai/results/abc.png?sig=1' } }).state).resolves.toEqual({ state: 'done', output: { mimeType: 'application/octet-stream', uri: 'https://delivery.eu1.bfl.ai/results/abc.png?sig=1' }, providerFlagged: false })
    await expect(poll({ status: 'Ready', result: {} }).state).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
    await expect(poll({}, 402).state).rejects.toMatchObject({ code: 'AI_PROVIDER_QUOTA' })
  })

  it('el resultado solo se descarga de *.bfl.ai, sin la clave', () => expectDownloadHosts(create, ['https://delivery.eu1.bfl.ai/results/abc.png', 'https://delivery.us2.bfl.ai/r.png'], null))

  it.each([[401, 'AI_INVALID_KEY'], [402, 'AI_PROVIDER_QUOTA'], [403, 'AI_PERMISSION_DENIED'], [422, 'AI_PROVIDER_FAILED'], [429, 'AI_PROVIDER_QUOTA'], [503, 'AI_PROVIDER_UNAVAILABLE']])('error HTTP %s al enviar → %s', async (status, code) => {
    await expect(create(fetchMock(() => jsonResponse({ detail: [{ msg: 'x' }] }, status)).impl).submit(ctx, poster('flux-3-image'))).rejects.toMatchObject({ code })
  })
})

describe('Stability AI: Stable Image (multipart, síncrono, solo texto a imagen)', () => {
  const create = (fetchImpl: FetchImpl) => createStabilityAdapter({ fetchImpl })

  it('comprobación: GET /v1/user/balance', () => expectVerify(create, 'https://api.stability.ai/v1/user/balance', ['authorization', `Bearer ${KEY}`]))

  it.each([
    ['stable-image-core', 'https://api.stability.ai/v2beta/stable-image/generate/core', {}],
    ['stable-image-ultra', 'https://api.stability.ai/v2beta/stable-image/generate/ultra', {}],
    ['sd3.5-large', 'https://api.stability.ai/v2beta/stable-image/generate/sd3', { model: 'sd3.5-large', mode: 'text-to-image' }],
  ])('%s: formulario con el prompt en inglés, sin ninguna fotografía', async (model, url, extra) => {
    const mock = fetchMock(() => jsonResponse({ image: PNG_B64, seed: 1, finish_reason: 'SUCCESS' }))
    const result = await create(mock.impl).submit(ctx, poster(model, [photo(1)]))
    expect(mock.calls[0].url).toBe(url)
    expect(mock.calls[0].headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(mock.calls[0].headers.get('accept')).toBe('application/json')
    // La API solo admite inglés: se envía la versión breve en inglés de las mismas reglas.
    expect(mock.calls[0].body).toEqual({ prompt: POSTER_COMPACT, aspect_ratio: '4:5', output_format: 'png', ...extra })
    expect(POSTER_COMPACT).toMatch(/No text/)
    expect(POSTER_COMPACT).toMatch(/Do not depict buildings, rooms, windows/)
    expect(result.immediate).toMatchObject({ state: 'done', output: { mimeType: 'image/png' } })
    expectKeyOnlyInHeader(mock.calls)
  })

  it('filtros de Stability: CONTENT_FILTERED y 403 content_moderation son bloqueos; 402 es saldo', async () => {
    const filtered = await create(fetchMock(() => jsonResponse({ image: PNG_B64, finish_reason: 'CONTENT_FILTERED' })).impl).submit(ctx, poster('stable-image-core'))
    expect(filtered.immediate).toEqual({ state: 'blocked', category: 'provider_safety_block' })
    await expect(create(fetchMock(() => jsonResponse({ id: 'x', name: 'content_moderation', errors: ['x'] }, 403)).impl).submit(ctx, poster('stable-image-core'))).rejects.toMatchObject({ category: 'provider_safety_block' })
    await expect(create(fetchMock(() => jsonResponse({ name: 'payment_required' }, 402)).impl).submit(ctx, poster('stable-image-core'))).rejects.toMatchObject({ code: 'AI_PROVIDER_QUOTA' })
    await expect(create(fetchMock(() => jsonResponse({ name: 'unauthorized' }, 401)).impl).submit(ctx, poster('stable-image-core'))).rejects.toMatchObject({ code: 'AI_INVALID_KEY' })
    await expect(create(fetchMock(() => jsonResponse({ name: 'public_figure', errors: ['x'] }, 422)).impl).submit(ctx, poster('stable-image-core'))).rejects.toMatchObject({ category: 'provider_safety_block' })
  })

  it('no hay vídeo ni modelos fuera del catálogo', async () => {
    const mock = fetchMock(() => jsonResponse({}))
    await expect(create(mock.impl).submit(ctx, video('stable-video'))).rejects.toMatchObject({ code: 'AI_CAPABILITY_MISSING' })
    await expect(create(mock.impl).submit(ctx, poster('sdxl'))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect(mock.calls).toEqual([])
  })
})

describe('Ideogram: Ideogram 4.5 (síncrono, resultado por URL)', () => {
  const create = (fetchImpl: FetchImpl) => createIdeogramAdapter({ fetchImpl })
  const URL_GENERATE = 'https://api.ideogram.ai/v2/image/generate/ideogram-4-5'

  it('comprobación: presupuesto con dry_run=true (no genera ni cobra)', () => expectVerify(create, `${URL_GENERATE}?dry_run=true`, ['api-key', KEY], 'POST'))

  it('generación: Api-Key, JSON con tamaño fijo y sin fotografías; el resultado es una URL', async () => {
    const mock = fetchMock(() => jsonResponse({ generation_id: 'g1', data: [{ url: 'https://ideogram.ai/api/images/ephemeral/abc.png?exp=1', is_image_safe: true, resolution: '1024x1024', seed: 1 }] }))
    const result = await create(mock.impl).submit(ctx, poster('ideogram-4-5', [photo(1)]))
    expect(mock.calls[0].url).toBe(URL_GENERATE)
    expect(mock.calls[0].headers.get('api-key')).toBe(KEY)
    expect(mock.calls[0].headers.get('authorization')).toBeNull()
    expect(Object.keys(mock.calls[0].body!).sort()).toEqual(['magic_prompt', 'num_images', 'prompt', 'size'])
    expect(mock.calls[0].body).toMatchObject({ size: '1024x1024', num_images: 1, magic_prompt: 'off' })
    expect(result.immediate).toEqual({ state: 'done', output: { mimeType: 'application/octet-stream', uri: 'https://ideogram.ai/api/images/ephemeral/abc.png?exp=1' }, providerFlagged: false })
    expectKeyOnlyInHeader(mock.calls)
  })

  it('seguridad de Ideogram: is_image_safe false y 422 son bloqueos', async () => {
    const unsafe = await create(fetchMock(() => jsonResponse({ data: [{ url: null, is_image_safe: false }] })).impl).submit(ctx, poster('ideogram-4-5'))
    expect(unsafe.immediate).toEqual({ state: 'blocked', category: 'provider_safety_block' })
    await expect(create(fetchMock(() => jsonResponse({ error: 'Prompt failed safety check' }, 422)).impl).submit(ctx, poster('ideogram-4-5'))).rejects.toMatchObject({ category: 'provider_safety_block' })
    await expect(create(fetchMock(() => jsonResponse({ error: 'x', reject_reason: 'insufficient_funds' }, 402)).impl).submit(ctx, poster('ideogram-4-5'))).rejects.toMatchObject({ code: 'AI_PROVIDER_QUOTA' })
    const empty = await create(fetchMock(() => jsonResponse({ data: [] })).impl).submit(ctx, poster('ideogram-4-5'))
    expect(empty.immediate).toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
  })

  it('la imagen solo se descarga de ideogram.ai y sus subdominios, sin la clave', () => expectDownloadHosts(create, ['https://ideogram.ai/api/images/ephemeral/a.png', 'https://cdn.ideogram.ai/a.png'], null))
})

describe('Recraft (síncrono, base64, solo texto a imagen)', () => {
  const create = (fetchImpl: FetchImpl) => createRecraftAdapter({ fetchImpl })

  it('comprobación: GET /v1/users/me', () => expectVerify(create, 'https://external.api.recraft.ai/v1/users/me', ['authorization', `Bearer ${KEY}`]))

  it.each(['recraftv4_1', 'recraftv4_1_flash'])('%s: POST /v1/images/generations en base64, sin fotografías', async model => {
    const mock = fetchMock(() => jsonResponse({ created: 1, credits: 35, data: [{ image_id: 'i1', b64_json: PNG_B64 }] }))
    const result = await create(mock.impl).submit(ctx, poster(model, [photo(1)]))
    expect(mock.calls[0].url).toBe('https://external.api.recraft.ai/v1/images/generations')
    expect(mock.calls[0].body).toMatchObject({ model, size: '1:1', n: 1, response_format: 'b64_json', image_format: 'png' })
    expect(Object.keys(mock.calls[0].body!).sort()).toEqual(['image_format', 'model', 'n', 'prompt', 'response_format', 'size'])
    expect(result.immediate).toMatchObject({ state: 'done', output: { mimeType: 'image/png' } })
    expectKeyOnlyInHeader(mock.calls)
  })

  it('errores y ausencia de vídeo', async () => {
    await expect(create(fetchMock(() => jsonResponse({}, 401)).impl).submit(ctx, poster('recraftv4_1'))).rejects.toMatchObject({ code: 'AI_INVALID_KEY' })
    await expect(create(fetchMock(() => jsonResponse({}, 429)).impl).submit(ctx, poster('recraftv4_1'))).rejects.toMatchObject({ code: 'AI_PROVIDER_QUOTA' })
    await expect(create(fetchMock(() => jsonResponse({})).impl).submit(ctx, video('x'))).rejects.toMatchObject({ code: 'AI_CAPABILITY_MISSING' })
    const empty = await create(fetchMock(() => jsonResponse({ data: [{ url: 'https://x/y' }] })).impl).submit(ctx, poster('recraftv4_1'))
    expect(empty.immediate).toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
  })
})

describe('Runway (agregador): modelos propios y de terceros con la clave de Runway', () => {
  const create = (fetchImpl: FetchImpl) => createRunwayAdapter({ fetchImpl })
  const runway = findProvider('runway', {})!

  it('comprobación: GET /v1/organization con la versión de la API', async () => {
    await expectVerify(create, 'https://api.dev.runwayml.com/v1/organization', ['authorization', `Bearer ${KEY}`])
    const mock = fetchMock(() => jsonResponse({ creditBalance: 100 }))
    await create(mock.impl).verifyKey(ctx)
    expect(mock.calls[0].headers.get('x-runway-version')).toBe('2024-11-06')
  })

  it('cada modelo del catálogo tiene sus parámetros en el adaptador, y al revés', () => {
    expect(runway.models.filter(model => model.purpose === 'video').map(model => model.id).sort()).toEqual([...RUNWAY_VIDEO_MODELS].sort())
    expect(runway.models.filter(model => model.purpose === 'poster').map(model => model.id).sort()).toEqual([...RUNWAY_IMAGE_MODELS].sort())
  })

  const VIDEO_BODIES: Record<string, Record<string, unknown>> = {
    'gen4.5': { ratio: '1280:720', duration: 6 },
    'veo3.1': { ratio: '1280:720', duration: 6, audio: false },
    'veo3.1_fast': { ratio: '1280:720', duration: 6, audio: false },
    'kling3.0_standard': { ratio: '1280:720', duration: 6, audio: false },
    'kling3.0_pro': { ratio: '1920:1080', duration: 6, audio: false },
    kling_4: { ratio: 'auto_720p', duration: 6 },
    seedance2_fast: { ratio: '1280:720', duration: 6, audio: false },
    seedance2_5: { ratio: '1280:720', duration: 6, audio: false },
    hailuo3: { ratio: '16:9', resolution: '768p', duration: 6 },
    wan3: { ratio: 'auto_720p', duration: 6, audio: false },
    grok_imagine_1_5: { resolution: '720p', duration: 6 },
    'gemini_omni_flash_1.2': { ratio: '1280:720', duration: 6 },
  }

  it.each(Object.entries(VIDEO_BODIES))('vídeo %s: POST /v1/image_to_video con la fotografía principal como data URI y solo sus parámetros', async (model, expected) => {
    const primary = photo(1)
    const mock = fetchMock(() => jsonResponse({ id: '17f20503-6c24-4c16-946b-35dbbce2af2f', estimatedCost: { credits: 60 } }))
    await expect(create(mock.impl).submit(ctx, video(model, 6, [primary, photo(2)]))).resolves.toEqual({ operationId: '17f20503-6c24-4c16-946b-35dbbce2af2f' })
    const call = mock.calls[0]
    expect(call.url).toBe('https://api.dev.runwayml.com/v1/image_to_video')
    expect(call.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(call.headers.get('x-runway-version')).toBe('2024-11-06')
    const { promptText, ...rest } = call.body as Record<string, unknown>
    expect(rest).toEqual({ model, promptImage: dataUrl(primary), ...expected })
    // Los modelos con límite de 1000 caracteres reciben la versión breve; todos llevan las reglas de fidelidad.
    expect(String(promptText).length).toBeLessThanOrEqual(['gen4.5', 'veo3.1', 'veo3.1_fast'].includes(model) ? 1000 : 4000)
    if (['gen4.5', 'veo3.1', 'veo3.1_fast'].includes(model)) expect(promptText).toBe(VIDEO_COMPACT)
    expect(String(promptText)).toMatch(/No invent|Do not invent/i)
    // El fabricante del catálogo no es Runway para los modelos de terceros, y la nota dice quién factura.
    const definition = runway.models.find(item => item.id === model)!
    expect(definition.notes).toMatch(/se factura a tu cuenta de Runway/)
    expect(definition.video!.durations).toContain(6)
    expectKeyOnlyInHeader(mock.calls)
  })

  it('fabricantes reales de los modelos servidos por Runway', () => {
    const maker = (id: string) => runway.models.find(model => model.id === id)!.maker
    expect(maker('gen4.5')).toBe('Runway')
    expect(maker('kling_4')).toMatch(/Kling/)
    expect(maker('seedance2_5')).toBe('ByteDance')
    expect(maker('hailuo3')).toBe('MiniMax')
    expect(maker('wan3')).toBe('Alibaba')
    expect(maker('veo3.1')).toBe('Google')
    expect(maker('grok_imagine_1_5')).toBe('xAI')
    expect(maker('gpt_image_2_6_flare')).toBe('OpenAI')
    expect(runway.kind).toBe('aggregator')
    expect(runway.billing).toMatch(/no la del fabricante/)
  })

  it.each([
    ['gen4_image', { ratio: '1080:1440' }, 3],
    ['nano_banana_2.1', { ratio: '848:1264' }, 3],
    ['seedream5_pro', { ratio: '896:1184' }, 3],
    ['gpt_image_2_6_flare', { ratio: 'auto', quality: 'medium' }, 3],
    ['grok_imagine_image_2', { ratio: '864:1152', quality: 'medium' }, 3],
  ] as const)('imagen %s: POST /v1/text_to_image con referencias como data URI', async (model, expected, count) => {
    const references = [photo(1), photo(2), photo(3)]
    const mock = fetchMock(() => jsonResponse({ id: 'task-1' }))
    await create(mock.impl).submit(ctx, poster(model, references))
    expect(mock.calls[0].url).toBe('https://api.dev.runwayml.com/v1/text_to_image')
    const { promptText, referenceImages, ...rest } = mock.calls[0].body as Record<string, unknown>
    expect(rest).toEqual({ model, ...expected })
    expect(referenceImages).toEqual(references.slice(0, count).map(image => ({ uri: dataUrl(image) })))
    expect(String(promptText).length).toBeLessThanOrEqual(model === 'gen4_image' ? 1000 : 3500)
    // Sin referencias no se envía el campo.
    const none = fetchMock(() => jsonResponse({ id: 'task-2' }))
    await create(none.impl).submit(ctx, poster(model))
    expect(none.calls[0].body).not.toHaveProperty('referenceImages')
  })

  it('estados de la tarea: GET /v1/tasks/{id}', async () => {
    const poll = (body: unknown, status = 200) => {
      const mock = fetchMock(() => jsonResponse(body, status))
      return { mock, state: create(mock.impl).poll(ctx, 'task-1') }
    }
    const first = poll({ id: 'task-1', status: 'PENDING' })
    await expect(first.state).resolves.toEqual({ state: 'running' })
    expect(first.mock.calls[0].url).toBe('https://api.dev.runwayml.com/v1/tasks/task-1')
    for (const status of ['THROTTLED', 'RUNNING']) await expect(poll({ status, progress: 0.4 }).state).resolves.toEqual({ state: 'running' })
    await expect(poll({ status: 'CANCELLED' }).state).resolves.toEqual({ state: 'cancelled' })
    await expect(poll({ status: 'SUCCEEDED', output: ['https://dnznrvs05pmza.cloudfront.net/out.mp4?_jwt=abc'] }).state).resolves.toEqual({ state: 'done', output: { mimeType: 'application/octet-stream', uri: 'https://dnznrvs05pmza.cloudfront.net/out.mp4?_jwt=abc' }, providerFlagged: false })
    await expect(poll({ status: 'SUCCEEDED', output: [] }).state).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
    for (const failureCode of ['SAFETY.INPUT.TEXT', 'SAFETY.OUTPUT.VIDEO', 'INPUT_PREPROCESSING.SAFETY.TEXT']) await expect(poll({ status: 'FAILED', failure: 'x', failureCode }).state).resolves.toEqual({ state: 'blocked', category: 'provider_safety_block' })
    for (const failureCode of ['INTERNAL.BAD_OUTPUT.01', 'ASSET.INVALID', 'THIRD_PARTY.UNAVAILABLE', undefined]) await expect(poll({ status: 'FAILED', failure: 'x', failureCode }).state).resolves.toEqual({ state: 'failed', code: 'AI_PROVIDER_FAILED' })
    await expect(poll({ status: 'ALGO_NUEVO' }).state).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
    await expect(poll({}, 404).state).resolves.toEqual({ state: 'failed', code: 'AI_PROVIDER_FAILED' })
    await expect(poll({}, 429).state).rejects.toMatchObject({ code: 'AI_PROVIDER_QUOTA' })
  })

  it('cancelación: DELETE /v1/tasks/{id}', async () => {
    const mock = fetchMock(() => new Response(null, { status: 204 }))
    await expect(create(mock.impl).cancel(ctx, 'task-1')).resolves.toBe(true)
    expect(mock.calls[0]).toMatchObject({ url: 'https://api.dev.runwayml.com/v1/tasks/task-1', method: 'DELETE' })
    await expect(create(fetchMock(() => jsonResponse({}, 404)).impl).cancel(ctx, 'task-1')).resolves.toBe(false)
  })

  it('límites de entrada: fotografía de más de 3,6 MB (5 MB codificados), modelo desconocido y vídeo sin fotografía', async () => {
    const mock = fetchMock(() => jsonResponse({ id: 'x' }))
    const big: InputImage = { mimeType: 'image/jpeg', data: Buffer.alloc(4 * 1024 * 1024) }
    await expect(create(mock.impl).submit(ctx, video('gen4.5', 6, [big]))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
    await expect(create(mock.impl).submit(ctx, video('gen3a_turbo'))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    await expect(create(mock.impl).submit(ctx, poster('gen4_turbo'))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    await expect(create(mock.impl).submit(ctx, video('gen4.5', 6, []))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
    expect(mock.calls).toEqual([])
  })

  it('las salidas solo se descargan de los hosts de entrega registrados, sin la clave', () => expectDownloadHosts(create, ['https://dnznrvs05pmza.cloudfront.net/out.mp4?_jwt=abc', 'https://storage.runwayml.com/out.mp4'], null))
})

describe('fal.ai (agregador): cola asíncrona', () => {
  const create = (fetchImpl: FetchImpl) => createFalAdapter({ fetchImpl })
  const fal = findProvider('fal', {})!
  const queueUrls = (app: string, id = 'req-1') => ({
    request_id: id,
    status_url: `https://queue.fal.run/${app}/requests/${id}/status`,
    response_url: `https://queue.fal.run/${app}/requests/${id}`,
    cancel_url: `https://queue.fal.run/${app}/requests/${id}/cancel`,
    queue_position: 0,
  })

  it('comprobación: precio de un modelo (exige clave válida), con Authorization: Key', () => expectVerify(create, 'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux-2', ['authorization', `Key ${KEY}`]))

  it('cada modelo del catálogo tiene su constructor en el adaptador, y al revés', () => {
    expect(fal.models.map(model => model.id).sort()).toEqual([...FAL_MODELS].sort())
  })

  const primary = photo(1)
  const BODIES: [string, SubmitRequest, Record<string, unknown>][] = [
    ['fal-ai/flux-2', poster('fal-ai/flux-2'), { image_size: { width: 1024, height: 1280 }, num_images: 1, output_format: 'png', enable_safety_checker: true }],
    ['fal-ai/flux-2/edit', poster('fal-ai/flux-2/edit', [primary, photo(2)]), { image_urls: [dataUrl(primary), dataUrl(photo(2))], image_size: { width: 1024, height: 1280 }, num_images: 1, output_format: 'png', enable_safety_checker: true }],
    ['fal-ai/nano-banana-2', poster('fal-ai/nano-banana-2'), { num_images: 1, aspect_ratio: '4:5', resolution: '1K', output_format: 'png' }],
    ['fal-ai/kling-video/v3/pro/image-to-video', video('fal-ai/kling-video/v3/pro/image-to-video', 8, [primary]), { start_image_url: dataUrl(primary), duration: '8', generate_audio: false }],
    ['bytedance/seedance-2.0/fast/image-to-video', video('bytedance/seedance-2.0/fast/image-to-video', 6, [primary]), { image_url: dataUrl(primary), resolution: '720p', duration: '6', aspect_ratio: '16:9', generate_audio: false }],
    ['minimax/h3-max/image-to-video', video('minimax/h3-max/image-to-video', 6, [primary]), { image_url: dataUrl(primary), duration: 6, resolution: '768P', prompt_expansion_mode: 'disabled', enable_safety_checker: true }],
  ]

  it.each(BODIES)('%s: POST a la cola con la entrada del modelo; no se guardan entradas ni salidas en fal', async (model, request, expected) => {
    const mock = fetchMock(() => jsonResponse(queueUrls('fal-ai/app')))
    const submitted = await create(mock.impl).submit(ctx, request)
    const call = mock.calls[0]
    expect(call.url).toBe(`https://queue.fal.run/${model}`)
    expect(call.headers.get('authorization')).toBe(`Key ${KEY}`)
    expect(call.headers.get('x-fal-store-io')).toBe('0')
    const { prompt, ...rest } = call.body as Record<string, unknown>
    expect(rest).toEqual(expected)
    expect(String(prompt)).toContain('<datos_no_confiables>')
    // El identificador de operación son las URL devueltas por la cola (ya validadas).
    expect(JSON.parse(Buffer.from(submitted.operationId, 'base64url').toString())).toEqual({ s: 'https://queue.fal.run/fal-ai/app/requests/req-1/status', r: 'https://queue.fal.run/fal-ai/app/requests/req-1', c: 'https://queue.fal.run/fal-ai/app/requests/req-1/cancel' })
    expectKeyOnlyInHeader(mock.calls)
  })

  it('las URL de estado, resultado y cancelación solo se aceptan si son de la cola de fal', async () => {
    for (const field of ['status_url', 'response_url', 'cancel_url']) {
      const urls = { ...queueUrls('fal-ai/flux-2'), [field]: 'https://evil.example/x' }
      await expect(create(fetchMock(() => jsonResponse(urls)).impl).submit(ctx, poster('fal-ai/flux-2'))).rejects.toMatchObject({ code: 'AI_SSRF_BLOCKED' })
    }
    await expect(create(fetchMock(() => jsonResponse({ request_id: 'x' })).impl).submit(ctx, poster('fal-ai/flux-2'))).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
    // Un identificador de operación manipulado no hace ninguna llamada.
    const forged = Buffer.from(JSON.stringify({ s: 'https://169.254.169.254/status', r: 'https://queue.fal.run/x', c: 'https://queue.fal.run/x' })).toString('base64url')
    const mock = fetchMock(() => jsonResponse({}))
    await expect(create(mock.impl).poll(ctx, forged)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
    await expect(create(mock.impl).poll(ctx, 'no-es-base64-json')).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
    await expect(create(mock.impl).cancel(ctx, forged)).resolves.toBe(false)
    expect(mock.calls).toEqual([])
  })

  async function submitted(model = 'fal-ai/flux-2') {
    return (await create(fetchMock(() => jsonResponse(queueUrls('fal-ai/flux-2'))).impl).submit(ctx, poster(model))).operationId
  }

  it('sondeo: en cola y en curso siguen; al completar se lee el resultado (imagen o vídeo)', async () => {
    const id = await submitted()
    for (const status of ['IN_QUEUE', 'IN_PROGRESS']) {
      const mock = fetchMock(() => jsonResponse({ status, queue_position: 1 }))
      await expect(create(mock.impl).poll(ctx, id)).resolves.toEqual({ state: 'running' })
      expect(mock.calls).toHaveLength(1)
      expect(mock.calls[0].url).toBe('https://queue.fal.run/fal-ai/flux-2/requests/req-1/status')
    }
    const image = fetchMock(call => (call.url.endsWith('/status') ? jsonResponse({ status: 'COMPLETED' }) : jsonResponse({ images: [{ url: 'https://v3.fal.media/files/a/out.png', content_type: 'image/png' }], has_nsfw_concepts: [false] })))
    await expect(create(image.impl).poll(ctx, id)).resolves.toEqual({ state: 'done', output: { mimeType: 'application/octet-stream', uri: 'https://v3.fal.media/files/a/out.png' }, providerFlagged: false })
    expect(image.calls.map(call => call.url)).toEqual(['https://queue.fal.run/fal-ai/flux-2/requests/req-1/status', 'https://queue.fal.run/fal-ai/flux-2/requests/req-1'])
    const clip = fetchMock(call => (call.url.endsWith('/status') ? jsonResponse({ status: 'COMPLETED' }) : jsonResponse({ video: { url: 'https://v3b.fal.media/files/b/out.mp4' } })))
    await expect(create(clip.impl).poll(ctx, id)).resolves.toMatchObject({ state: 'done', output: { uri: 'https://v3b.fal.media/files/b/out.mp4' } })
  })

  it('sondeo: fallos y moderación', async () => {
    const id = await submitted()
    const poll = (status: unknown, result?: Response) => create(fetchMock(call => (call.url.endsWith('/status') ? jsonResponse(status) : result!.clone())).impl).poll(ctx, id)
    await expect(poll({ status: 'COMPLETED', error: 'x', error_type: 'content_policy_violation' })).resolves.toEqual({ state: 'blocked', category: 'provider_safety_block' })
    await expect(poll({ status: 'COMPLETED', error: 'Runner disconnected', error_type: 'runner_disconnected' })).resolves.toEqual({ state: 'failed', code: 'AI_PROVIDER_FAILED' })
    await expect(poll({ status: 'COMPLETED' }, jsonResponse({ detail: [{ loc: ['body', 'prompt'], msg: 'x', type: 'content_policy_violation' }] }, 422))).resolves.toEqual({ state: 'blocked', category: 'provider_safety_block' })
    await expect(poll({ status: 'COMPLETED' }, jsonResponse({ images: [{ url: 'https://v3.fal.media/x.png' }], has_nsfw_concepts: [true] }))).resolves.toEqual({ state: 'blocked', category: 'provider_safety_block' })
    await expect(poll({ status: 'COMPLETED' }, jsonResponse({ images: [] }))).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
    await expect(poll({ status: 'COMPLETED' }, jsonResponse({ detail: 'x', type: 'rejected_key' }, 401))).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_KEY' })
    await expect(poll({ status: 'OTRO' })).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
  })

  it('cancelación: PUT a la URL de cancelación devuelta', async () => {
    const id = await submitted()
    const mock = fetchMock(() => jsonResponse({ status: 'CANCELLATION_REQUESTED' }, 202))
    await expect(create(mock.impl).cancel(ctx, id)).resolves.toBe(true)
    expect(mock.calls[0]).toMatchObject({ url: 'https://queue.fal.run/fal-ai/flux-2/requests/req-1/cancel', method: 'PUT' })
    await expect(create(fetchMock(() => jsonResponse({ status: 'ALREADY_COMPLETED' }, 400)).impl).cancel(ctx, id)).resolves.toBe(false)
  })

  it('el vídeo exige fotografía, y un modelo fuera del catálogo no se envía', async () => {
    const mock = fetchMock(() => jsonResponse(queueUrls('x/y')))
    await expect(create(mock.impl).submit(ctx, video('fal-ai/kling-video/v3/pro/image-to-video', 6, []))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
    await expect(create(mock.impl).submit(ctx, poster('fal-ai/otro-modelo'))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    await expect(create(mock.impl).submit(ctx, poster('https://evil.example/modelo'))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect(mock.calls).toEqual([])
  })

  it('los resultados solo se descargan de fal.media, sin la clave', () => expectDownloadHosts(create, ['https://v3.fal.media/files/a/out.png', 'https://v3b.fal.media/files/b/out.mp4', 'https://fal.media/files/c.png'], null))
})

describe('Replicate (agregador): predicciones de modelos oficiales', () => {
  const create = (fetchImpl: FetchImpl) => createReplicateAdapter({ fetchImpl })

  it('comprobación: GET /v1/account', () => expectVerify(create, 'https://api.replicate.com/v1/account', ['authorization', `Bearer ${KEY}`]))

  it('Seedance 2.5: POST /v1/models/{owner}/{name}/predictions con la fotografía como data URL, sin audio', async () => {
    const primary = photo(1)
    const mock = fetchMock(() => jsonResponse({ id: 'gm3qorzdhgbfurvjtvhg6dckhu', status: 'starting', urls: { get: 'https://api.replicate.com/v1/predictions/gm3', cancel: 'x' } }, 201))
    await expect(create(mock.impl).submit(ctx, video('bytedance/seedance-2.5', 8, [primary]))).resolves.toEqual({ operationId: 'gm3qorzdhgbfurvjtvhg6dckhu' })
    expect(mock.calls[0].url).toBe('https://api.replicate.com/v1/models/bytedance/seedance-2.5/predictions')
    expect(mock.calls[0].headers.get('authorization')).toBe(`Bearer ${KEY}`)
    const { input } = mock.calls[0].body as { input: Record<string, unknown> }
    expect(Object.keys(mock.calls[0].body!)).toEqual(['input'])
    const { prompt, ...rest } = input
    expect(rest).toEqual({ image: dataUrl(primary), duration: 8, aspect_ratio: '16:9', generate_audio: false })
    expect(String(prompt)).toContain('<datos_no_confiables>')
    expectKeyOnlyInHeader(mock.calls)
  })

  it('estados de la predicción', async () => {
    const poll = (body: unknown, status = 200) => {
      const mock = fetchMock(() => jsonResponse(body, status))
      return { mock, state: create(mock.impl).poll(ctx, 'gm3') }
    }
    const first = poll({ status: 'starting' })
    await expect(first.state).resolves.toEqual({ state: 'running' })
    expect(first.mock.calls[0].url).toBe('https://api.replicate.com/v1/predictions/gm3')
    await expect(poll({ status: 'processing' }).state).resolves.toEqual({ state: 'running' })
    for (const status of ['canceled', 'aborted']) await expect(poll({ status }).state).resolves.toEqual({ state: 'cancelled' })
    await expect(poll({ status: 'succeeded', output: 'https://replicate.delivery/xezq/abc/out.mp4' }).state).resolves.toMatchObject({ state: 'done', output: { uri: 'https://replicate.delivery/xezq/abc/out.mp4' } })
    await expect(poll({ status: 'succeeded', output: ['https://pbxt.replicate.delivery/abc/out.mp4'] }).state).resolves.toMatchObject({ state: 'done', output: { uri: 'https://pbxt.replicate.delivery/abc/out.mp4' } })
    await expect(poll({ status: 'succeeded', output: null }).state).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_OUTPUT' })
    await expect(poll({ status: 'failed', error: 'NSFW content detected' }).state).resolves.toEqual({ state: 'blocked', category: 'provider_safety_block' })
    await expect(poll({ status: 'failed', error: 'E1001 Model Out of Memory' }).state).resolves.toEqual({ state: 'failed', code: 'AI_PROVIDER_FAILED' })
    await expect(poll({ detail: 'x' }, 401).state).resolves.toEqual({ state: 'failed', code: 'AI_INVALID_KEY' })
  })

  it('cancelación, límites y modelos no registrados', async () => {
    const cancel = fetchMock(() => jsonResponse({ status: 'canceled' }))
    await expect(create(cancel.impl).cancel(ctx, 'gm3')).resolves.toBe(true)
    expect(cancel.calls[0]).toMatchObject({ url: 'https://api.replicate.com/v1/predictions/gm3/cancel', method: 'POST' })
    const mock = fetchMock(() => jsonResponse({ id: 'x' }))
    const big: InputImage = { mimeType: 'image/jpeg', data: Buffer.alloc(1024 * 1024 + 1) }
    await expect(create(mock.impl).submit(ctx, video('bytedance/seedance-2.5', 6, [big]))).rejects.toMatchObject({ code: 'AI_INVALID_REQUEST' })
    // Kling en Replicate no se registra: sus parámetros no se pudieron leer en la documentación.
    await expect(create(mock.impl).submit(ctx, video('kwaivgi/kling-v4.0'))).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    await expect(create(mock.impl).submit(ctx, poster('black-forest-labs/flux-2-pro'))).rejects.toMatchObject({ code: 'AI_CAPABILITY_MISSING' })
    expect(mock.calls).toEqual([])
  })

  it('los archivos de salida se piden con la cabecera Authorization y solo a replicate.delivery', () => expectDownloadHosts(create, ['https://replicate.delivery/xezq/abc/out.mp4', 'https://pbxt.replicate.delivery/abc/out.mp4'], ['authorization', `Bearer ${KEY}`]))
})

describe('proveedores de solo texto: comprobación de la clave sin generar', () => {
  it.each([
    ['anthropic', 'https://api.anthropic.com/v1/models', 'x-api-key', KEY],
    ['mistral', 'https://api.mistral.ai/v1/models', 'authorization', `Bearer ${KEY}`],
    ['deepseek', 'https://api.deepseek.com/models', 'authorization', `Bearer ${KEY}`],
    ['groq', 'https://api.groq.com/openai/v1/models', 'authorization', `Bearer ${KEY}`],
  ])('%s: GET %s', async (id, url, header, value) => {
    const provider = findProvider(id, {})!
    expect(provider.allowedHosts).toContain(new URL(url).hostname)
    const config = { name: provider.name, hosts: provider.allowedHosts, verify: { url, header: (header === 'x-api-key' ? 'x-api-key' : 'bearer') as 'x-api-key' | 'bearer', ...(id === 'anthropic' && { extraHeaders: { 'anthropic-version': '2026-10-21' } }) } }
    await expectVerify(fetchImpl => createVerifyOnlyAdapter(config, { fetchImpl }), url, [header, value])
    // No generan carteles ni vídeos ni clasifican contenido.
    const adapter = createVerifyOnlyAdapter(config)
    await expect(adapter.submit(ctx, poster('x'))).rejects.toMatchObject({ code: 'AI_CAPABILITY_MISSING' })
    await expect(adapter.moderate(ctx, { stage: 'input', kind: 'poster' })).rejects.toMatchObject({ code: 'MODERATION_UNAVAILABLE' })
  })

  it('OpenRouter: sin comprobación documentada, no se llama a nada y se dice', async () => {
    const mock = fetchMock(() => jsonResponse({}))
    const adapter = createVerifyOnlyAdapter({ name: 'OpenRouter', hosts: ['openrouter.ai'], verify: null }, { fetchImpl: mock.impl })
    await expect(adapter.verifyKey(ctx)).resolves.toEqual({ ok: false, code: 'AI_VERIFY_UNSUPPORTED' })
    expect(mock.calls).toEqual([])
    expect(findProvider('openrouter', {})!.verificationCost).toBe('unsupported')
  })
})

describe('diagnóstico de la comprobación: modelos que lista la cuenta (DA-87)', () => {
  it('lee los identificadores de {data:[{id}]} o [{id}], descarta los que no tienen un formato seguro y no inventa listas', async () => {
    const { modelIds } = await import('./common.js')
    expect(modelIds({ object: 'list', data: [{ id: 'gpt-6.1-terra' }, { id: 'gpt-image-2.6-flare' }, { id: 'gpt-6.1-terra' }] })).toEqual(['gpt-6.1-terra', 'gpt-image-2.6-flare'])
    expect(modelIds([{ id: 'mistral-large-latest' }, { name: 'sin id' }])).toEqual(['mistral-large-latest'])
    expect(modelIds({ data: [{ id: '<script>' }, { id: 'a'.repeat(200) }, { id: 'ok/modelo:1' }] })).toEqual(['ok/modelo:1'])
    expect(modelIds({ data: 'no es una lista' })).toBeNull()
    expect(modelIds(null)).toBeNull()
  })

  it('la comprobación con lista devuelve los modelos de la cuenta en una sola petición GET, sin cuerpo', async () => {
    const mock = fetchMock(() => jsonResponse({ data: [{ id: 'grok-4.3' }, { id: 'grok-imagine-video-1.5' }] }))
    const result = await createXaiAdapter({ fetchImpl: mock.impl }).verifyKey(ctx)
    expect(result).toEqual({ ok: true, models: ['grok-4.3', 'grok-imagine-video-1.5'] })
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]).toMatchObject({ method: 'GET', body: undefined })
    // Una respuesta 200 sin lista sigue siendo una clave válida, sin modelos que comparar.
    await expect(createXaiAdapter({ fetchImpl: fetchMock(() => jsonResponse({ otra: 'forma' })).impl }).verifyKey(ctx)).resolves.toEqual({ ok: true })
  })
})
