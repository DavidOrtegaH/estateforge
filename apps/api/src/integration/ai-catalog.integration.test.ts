import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiProviderAdapter, SubmitRequest } from '../ai-media/adapter.js'
import { makePng, uniqueSeed } from '../test-support/images.js'
import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Catálogo amplio de proveedores BYOK (DA-82 a DA-86) contra PostgreSQL real y la aplicación completa:
// varias conexiones por proveedor, aislamiento entre usuarios, preferencias por conexión, clasificador de
// seguridad externo obligatorio y proveedores síncronos. Ninguna prueba llama a un proveedor real: los
// proveedores reales se sustituyen por adaptadores de prueba y el clasificador es el simulador local.
// fetch está sustituido por un espía que falla si se usa. Las claves son ficticias.

let database: TestDatabase
let admin: pg.Client
let root: string
let app: FastifyInstance
let mods: {
  createSession: typeof import('../services/session.service.js')['createSession']
  setAdapterForTests: typeof import('../ai-media/registry.js')['setAdapterForTests']
  simulatedBackground: typeof import('../ai-media/simulator.adapter.js')['simulatedBackground']
  AiMediaError: typeof import('../ai-media/errors.js')['AiMediaError']
  closeDatabase: () => Promise<void>
}
const fetchSpy = vi.fn(async () => {
  throw new Error('llamada externa no permitida en esta prueba')
})

const ENCRYPTION_KEY = randomBytes(32).toString('base64')
const SIM_OK = 'sim-ok-prueba12345'
const SIM_FAIL = 'sim-error-proveedor-12345'
const FAKE = 'clave-FICTICIA-de-prueba-que-no-es-real-0000'
const RUNWAY_FAKE = 'key_FICTICIA0000000000000000000000'
const OPENAI_FAKE = 'sk-FAKE-clave-de-prueba-que-no-es-real-000000'
const id = (prefix: string) => `c${prefix}${randomBytes(10).toString('hex')}`.slice(0, 25)
const ipFor = (cookie: string) => `10.${cookie.length % 200}.${cookie.charCodeAt(30) % 250}.${cookie.charCodeAt(40) % 250}`

async function account() {
  const userId = id('u')
  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt", "emailVerifiedAt") VALUES ($1, $2, 'x', now(), now())`, [userId, `${userId}@example.test`])
  const { token } = await mods.createSession(userId)
  return { userId, cookie: `estateforge_session=${token}` }
}

const inject = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, remoteAddress: ipFor(cookie), headers: { cookie, ...(payload !== undefined && { 'content-type': 'application/json' }) }, ...(payload !== undefined && { payload: payload as Record<string, unknown> }) })

const pathOf = (url: string) => {
  const parsed = new URL(url)
  return parsed.pathname + parsed.search
}

async function withPhotos(count = 2) {
  const owner = await account()
  const propertyId = id('p')
  await admin.query(
    `INSERT INTO "Property" (id, title, operation, type, price, address, city, neighborhood, area, bedrooms, bathrooms, condition, "commercialStatus", "additionalInformation", "userId", "updatedAt")
     VALUES ($1, 'Piso luminoso', 'sale', 'apartment', 250000, 'Calle Privada 7', 'Madrid', 'Chamberí', 92, 3, 2, 'good', 'for-sale', '', $2, now())`,
    [propertyId, owner.userId],
  )
  const generationId = id('g')
  await admin.query(
    `INSERT INTO "Generation" (id, title, description, highlights, "callToAction", provider, tone, language, "propertyId", "updatedAt")
     VALUES ($1, 'Vive en Chamberí', 'Piso exterior y reformado', '["Exterior"]', 'Pide visita', 'mock', 'professional', 'español', $2, now())`,
    [generationId, propertyId],
  )
  for (let i = 0; i < count; i += 1) {
    const image = makePng(40, 30, uniqueSeed())
    const prepared = await inject(owner.cookie, 'POST', '/api/uploads', { kind: 'photo', contentType: 'image/png', size: image.length, propertyId })
    expect(prepared.statusCode).toBe(201)
    const p = prepared.json()
    expect((await app.inject({ method: 'PUT', url: pathOf(p.upload.url), headers: { 'content-type': p.upload.headers['Content-Type'] }, payload: image })).statusCode).toBe(200)
    expect((await inject(owner.cookie, 'POST', `/api/uploads/${p.attemptId}/complete`)).statusCode).toBe(200)
  }
  const source = (await inject(owner.cookie, 'GET', `/api/generations/${generationId}/media/source`)).json() as { sourceHash: string; photos: { id: string; isPrimary: boolean }[] }
  return { ...owner, propertyId, generationId, source }
}

const connect = (cookie: string, provider: string, apiKey: string, label = '') => inject(cookie, 'POST', '/api/account/ai-connections', { provider, label, apiKey })
const connections = async (cookie: string) => (await inject(cookie, 'GET', '/api/account/ai-integrations')).json().connections as { id: string; provider: string; label: string; keyHint: string; status: string }[]
const prefs = (cookie: string, body: Record<string, unknown>) => inject(cookie, 'PUT', '/api/account/ai-preferences', { poster: null, video: null, ...body })

function jobBody(owner: Awaited<ReturnType<typeof withPhotos>>, overrides: Record<string, unknown> = {}) {
  return { kind: 'poster', provider: 'simulador', model: 'sim-imagen-1', photoIds: owner.source.photos.slice(0, 2).map(p => p.id), sourceHash: owner.source.sourceHash, expectedVersion: 0, idempotencyKey: randomUUID(), consent: true, ...overrides }
}
const createJob = (owner: Awaited<ReturnType<typeof withPhotos>>, overrides: Record<string, unknown> = {}) => inject(owner.cookie, 'POST', `/api/generations/${owner.generationId}/ai-jobs`, jobBody(owner, overrides))
const jobCount = async (userId: string) => Number((await admin.query(`SELECT count(*) FROM "AiMediaJob" WHERE "userId" = $1`, [userId])).rows[0].count)
const jobRow = async (jobId: string) => (await admin.query(`SELECT * FROM "AiMediaJob" WHERE id = $1`, [jobId])).rows[0]

/** Adaptador de prueba de un proveedor síncrono sin clasificador propio (como Recraft o Stability). */
function syncAdapter(calls: SubmitRequest[], output?: Buffer): AiProviderAdapter {
  return {
    verifyKey: async () => ({ ok: true }),
    submit: async (_ctx, request) => {
      calls.push(request)
      return { operationId: 'sync', immediate: { state: 'done', output: { mimeType: 'image/png', data: output ?? mods.simulatedBackground(928, 1152, 3) }, providerFlagged: false } }
    },
    poll: async () => ({ state: 'failed', code: 'AI_PROVIDER_FAILED' }),
    cancel: async () => false,
    fetchResult: async () => Buffer.alloc(0),
    moderate: async () => {
      throw new mods.AiMediaError('MODERATION_UNAVAILABLE', 'Este proveedor no clasifica.', 'moderation_unavailable')
    },
  }
}

beforeAll(async () => {
  database = await createTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'ef-cat-'))
  vi.stubEnv('DATABASE_URL', database.url)
  vi.stubEnv('ESTATEFORGE_API_KEY_ENCRYPTION_KEY', ENCRYPTION_KEY)
  vi.stubEnv('AI_MEDIA_SIMULATOR', '1')
  vi.stubEnv('AI_SIMULATOR_DELAY_MS', '0')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubGlobal('fetch', fetchSpy)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  vi.resetModules()
  const { LocalStorage } = await import('../storage/local-storage.js')
  const { LocalSigner } = await import('../storage/local-signer.js')
  ;(await import('../storage/object-storage.js')).setStorageForTests(new LocalStorage(root, { signer: new LocalSigner('http://localhost'), directTransfers: true }))
  mods = {
    createSession: (await import('../services/session.service.js')).createSession,
    setAdapterForTests: (await import('../ai-media/registry.js')).setAdapterForTests,
    simulatedBackground: (await import('../ai-media/simulator.adapter.js')).simulatedBackground,
    AiMediaError: (await import('../ai-media/errors.js')).AiMediaError,
    closeDatabase: (await import('../db/prisma.js')).closeDatabase,
  }
  app = await (await import('../app.js')).buildApp()
  await app.ready()
})

beforeEach(() => {
  fetchSpy.mockClear()
  for (const provider of ['recraft', 'stability', 'xai', 'runway']) mods.setAdapterForTests(provider, null)
})

afterAll(async () => {
  await app.close()
  await mods.closeDatabase()
  await admin.end()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await database.drop()
  rmSync(root, { recursive: true, force: true })
})

describe('catálogo público', () => {
  it('ofrece los proveedores directos y los agregadores, con fabricante, facturación y sin datos internos', async () => {
    const user = await account()
    const { providers } = (await inject(user.cookie, 'GET', '/api/ai/providers')).json() as { providers: { id: string; kind: string; billing: string; capabilities: string[]; models: { id: string; maker: string; purpose: string; outputs: string[]; selectable: boolean }[] }[] }
    expect(providers.map(p => p.id)).toEqual(['gemini', 'openai', 'anthropic', 'xai', 'mistral', 'deepseek', 'bfl', 'stability', 'ideogram', 'recraft', 'openrouter', 'groq', 'runway', 'fal', 'replicate', 'simulador'])
    expect(providers.filter(p => p.kind === 'aggregator').map(p => p.id)).toEqual(['openrouter', 'groq', 'runway', 'fal', 'replicate'])
    for (const provider of providers) {
      expect(provider.billing.length).toBeGreaterThan(5)
      for (const model of provider.models) {
        expect(model.maker.length).toBeGreaterThan(0)
        expect(model.selectable).toBe(true)
        // Un modelo solo figura en un uso si genera ese tipo de contenido.
        expect(model.outputs).toEqual([model.purpose === 'poster' ? 'image' : model.purpose === 'video' ? 'video' : 'text'])
      }
    }
    const raw = JSON.stringify(providers)
    expect(raw).not.toMatch(/keyPattern|allowedHosts|resultHosts|"text":\{"protocol"|api\.dev\.runwayml\.com|queue\.fal\.run/)
  })
})

describe('conexiones BYOK: varias por proveedor', () => {
  it('se crean cifradas, con etiqueta única por proveedor, y nunca se devuelve la clave', async () => {
    const user = await account()
    const first = await connect(user.cookie, 'anthropic', FAKE)
    expect(first.statusCode).toBe(201)
    expect(first.body).not.toContain(FAKE)
    // Otra conexión principal del mismo proveedor: no se sustituye en silencio.
    expect((await connect(user.cookie, 'anthropic', `${FAKE}b`)).json()).toMatchObject({ code: 'AI_CONNECTION_DUPLICATE' })
    const second = await connect(user.cookie, 'anthropic', `${FAKE}-profesional`, 'Profesional')
    expect(second.statusCode).toBe(201)
    expect((await connect(user.cookie, 'anthropic', FAKE, 'Profesional')).statusCode).toBe(409)
    const list = await connections(user.cookie)
    expect(list.map(c => [c.provider, c.label, c.status])).toEqual([['anthropic', '', 'unverified'], ['anthropic', 'Profesional', 'unverified']])
    expect(JSON.stringify(list)).not.toMatch(/encryptedKey|FICTICIA/)
    const rows = (await admin.query(`SELECT "encryptedKey", label, algorithm FROM "UserAIKey" WHERE "userId" = $1 ORDER BY label`, [user.userId])).rows
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.encryptedKey).not.toContain('FICTICIA')
      expect(row.encryptedKey.split('.')).toHaveLength(3)
      expect(row.algorithm).toBe('aes-256-gcm')
    }
    // Mismo secreto, cifrados distintos (IV aleatorio).
    expect(rows[0].encryptedKey).not.toBe(rows[1].encryptedKey)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('valida proveedor, formato de la clave y etiqueta; como máximo 5 conexiones por proveedor', async () => {
    const user = await account()
    expect((await connect(user.cookie, 'proveedor-inventado', FAKE)).statusCode).toBe(400)
    expect((await connect(user.cookie, 'https://evil.example', FAKE)).statusCode).toBe(400)
    expect((await connect(user.cookie, 'runway', FAKE)).statusCode).toBe(400)
    expect((await connect(user.cookie, 'runway', RUNWAY_FAKE)).statusCode).toBe(201)
    expect((await connect(user.cookie, 'anthropic', 'corta')).statusCode).toBe(400)
    expect((await connect(user.cookie, 'anthropic', FAKE, '<script>alert(1)</script>')).statusCode).toBe(400)
    expect((await inject(user.cookie, 'POST', '/api/account/ai-connections', { provider: 'anthropic', apiKey: FAKE, baseURL: 'http://169.254.169.254' })).statusCode).toBe(400)
    for (const label of ['', 'a', 'b', 'c', 'd']) expect((await connect(user.cookie, 'mistral', FAKE, label)).statusCode).toBe(201)
    expect((await connect(user.cookie, 'mistral', FAKE, 'e')).json()).toMatchObject({ code: 'AI_CONNECTION_LIMIT' })
    expect(await connections(user.cookie)).toHaveLength(6)
  })

  it('la base solo admite proveedores con formato válido y etiquetas recortadas', async () => {
    const user = await account()
    const insert = (provider: string, label: string) => admin.query(`INSERT INTO "UserAIKey" (id, "userId", provider, label, "encryptedKey", "updatedAt") VALUES ($1, $2, $3, $4, 'a.b.c', now())`, [id('k'), user.userId, provider, label])
    await expect(insert('OpenAI', '')).rejects.toThrow(/UserAIKey_provider_format/)
    await expect(insert('https://evil', '')).rejects.toThrow(/UserAIKey_provider_format/)
    await expect(insert('groq', ' con espacios ')).rejects.toThrow(/UserAIKey_label_format/)
    await insert('groq', '')
    await expect(insert('groq', '')).rejects.toThrow(/UserAIKey_userId_provider_label_key/)
    await insert('groq', 'otra')
  })

  it('sustituir la clave, cambiar la etiqueta y eliminar; la gestión por proveedor sigue funcionando', async () => {
    const user = await account()
    const connectionId = (await connect(user.cookie, 'deepseek', FAKE)).json().id as string
    await admin.query(`UPDATE "UserAIKey" SET status = 'verified', "lastVerifiedAt" = now() WHERE id = $1`, [connectionId])
    const before = (await admin.query(`SELECT "encryptedKey" FROM "UserAIKey" WHERE id = $1`, [connectionId])).rows[0].encryptedKey
    expect((await inject(user.cookie, 'PUT', `/api/account/ai-connections/${connectionId}`, { apiKey: `${FAKE}-nueva`, label: 'Trabajo' })).statusCode).toBe(200)
    const row = (await admin.query(`SELECT "encryptedKey", label, status, "lastVerifiedAt" FROM "UserAIKey" WHERE id = $1`, [connectionId])).rows[0]
    // Clave nueva: vuelve a «sin comprobar».
    expect(row).toMatchObject({ label: 'Trabajo', status: 'unverified', lastVerifiedAt: null })
    expect(row.encryptedKey).not.toBe(before)
    expect((await inject(user.cookie, 'PUT', `/api/account/ai-connections/${connectionId}`, {})).statusCode).toBe(400)
    expect((await inject(user.cookie, 'DELETE', `/api/account/ai-connections/${connectionId}`)).statusCode).toBe(200)
    expect((await inject(user.cookie, 'DELETE', `/api/account/ai-connections/${connectionId}`)).statusCode).toBe(404)
    // Rutas por proveedor (conexión principal).
    expect((await inject(user.cookie, 'PUT', '/api/account/ai-keys/groq', { apiKey: FAKE })).statusCode).toBe(200)
    expect((await connections(user.cookie)).map(c => [c.provider, c.label])).toEqual([['groq', '']])
    expect((await inject(user.cookie, 'DELETE', '/api/account/ai-keys/groq')).statusCode).toBe(200)
    expect(await connections(user.cookie)).toEqual([])
    expect((await inject(user.cookie, 'PUT', '/api/account/ai-keys/proveedor-inventado', { apiKey: FAKE })).statusCode).toBe(400)
  })

  it('aislamiento: la conexión de otro usuario no existe para nadie más', async () => {
    const owner = await account()
    const other = await account()
    const connectionId = (await connect(owner.cookie, 'simulador', SIM_OK)).json().id as string
    expect((await inject(other.cookie, 'PUT', `/api/account/ai-connections/${connectionId}`, { apiKey: SIM_FAIL })).statusCode).toBe(404)
    expect((await inject(other.cookie, 'DELETE', `/api/account/ai-connections/${connectionId}`)).statusCode).toBe(404)
    expect((await inject(other.cookie, 'POST', `/api/account/ai-connections/${connectionId}/verify`)).statusCode).toBe(404)
    expect((await inject(other.cookie, 'GET', `/api/account/ai-connections/${connectionId}/models`)).statusCode).toBe(404)
    expect(await connections(other.cookie)).toEqual([])
    // No puede fijarla como preferencia ni como clasificador.
    expect((await prefs(other.cookie, { text: { provider: 'simulador', model: 'sim-texto-1', connectionId } })).statusCode).toBe(409)
    expect((await prefs(other.cookie, { moderation: { provider: 'simulador', connectionId } })).statusCode).toBe(409)
    // Ni generar texto con ella.
    const text = await inject(other.cookie, 'POST', '/api/generations', { property: { title: 'Piso', operation: 'sale', type: 'apartment', price: '250000', address: 'Calle Mayor 10', city: 'Madrid', neighborhood: 'Centro', area: 90, bedrooms: 3, bathrooms: 2, floor: 4, condition: 'good', commercialStatus: 'for-sale', elevator: true, terrace: true, balcony: false, garage: false, storageRoom: false, pool: false, garden: false, airConditioning: true, heating: true, additionalInformation: '' }, provider: 'simulador', connectionId, tone: 'professional', language: 'español' })
    expect(text.statusCode).toBe(409)
    expect(text.json().code).toBe('AI_KEY_REQUIRED')
    // La del propietario sigue intacta.
    expect((await connections(owner.cookie)).map(c => c.id)).toEqual([connectionId])
  })

  it('comprobación de la conexión: guarda solo el resultado; OpenRouter indica que no hay comprobación sin generar', async () => {
    const user = await account()
    const sim = (await connect(user.cookie, 'simulador', SIM_OK)).json().id as string
    const verified = await inject(user.cookie, 'POST', `/api/account/ai-connections/${sim}/verify`)
    expect(verified.json()).toMatchObject({ status: 'verified', connectionId: sim })
    const bad = (await connect(user.cookie, 'simulador', 'sim-invalida-12345678', 'mala')).json().id as string
    expect((await inject(user.cookie, 'POST', `/api/account/ai-connections/${bad}/verify`)).json()).toMatchObject({ status: 'invalid', code: 'AI_INVALID_KEY' })
    const rows = (await admin.query(`SELECT label, status, "lastErrorCode" FROM "UserAIKey" WHERE "userId" = $1 ORDER BY label`, [user.userId])).rows
    expect(rows).toEqual([{ label: '', status: 'verified', lastErrorCode: null }, { label: 'mala', status: 'invalid', lastErrorCode: 'AI_INVALID_KEY' }])
    const router = (await connect(user.cookie, 'openrouter', FAKE)).json().id as string
    const unsupported = await inject(user.cookie, 'POST', `/api/account/ai-connections/${router}/verify`)
    expect(unsupported.json()).toMatchObject({ status: 'unverified', code: 'AI_VERIFY_UNSUPPORTED' })
    // No se ha hecho ninguna llamada externa (ni siquiera para OpenRouter).
    expect(fetchSpy).not.toHaveBeenCalled()
    // El descubrimiento solo existe en los agregadores que lo declaran.
    expect((await inject(user.cookie, 'GET', `/api/account/ai-connections/${sim}/models`)).json()).toMatchObject({ code: 'AI_CAPABILITY_MISSING' })
    // Con el catálogo del agregador inaccesible (fetch bloqueado), se informa y no se ofrece nada.
    expect((await inject(user.cookie, 'GET', `/api/account/ai-connections/${router}/models`)).statusCode).toBe(502)
  })
})

describe('qué conexión se usa', () => {
  it('la elegida para la operación, la de la preferencia o la principal; con varias sin principal hay que elegir', async () => {
    const owner = await withPhotos()
    const main = (await connect(owner.cookie, 'simulador', SIM_OK)).json().id as string
    const failing = (await connect(owner.cookie, 'simulador', SIM_FAIL, 'averiada')).json().id as string
    // Sin indicar nada: la principal.
    const byDefault = (await createJob(owner)).json().job
    expect(JSON.parse((await jobRow(byDefault.id)).params)).toMatchObject({ connectionId: main })
    await inject(owner.cookie, 'POST', `/api/ai-jobs/${byDefault.id}/cancel`)
    // La indicada para esta operación (la que falla en el «proveedor»).
    const chosen = (await createJob(owner, { connectionId: failing })).json().job
    expect(JSON.parse((await jobRow(chosen.id)).params)).toMatchObject({ connectionId: failing })
    await admin.query(`UPDATE "AiMediaJob" SET "lastPolledAt" = NULL WHERE id = $1`, [chosen.id])
    expect((await inject(owner.cookie, 'GET', `/api/ai-jobs/${chosen.id}`)).json().job).toMatchObject({ status: 'failed' })
    // La de la preferencia.
    expect((await prefs(owner.cookie, { poster: { provider: 'simulador', model: 'sim-imagen-1', connectionId: failing } })).json().preferences.poster).toMatchObject({ connectionId: failing, available: true })
    const preferred = (await createJob(owner)).json().job
    expect(JSON.parse((await jobRow(preferred.id)).params)).toMatchObject({ connectionId: failing })
    await inject(owner.cookie, 'POST', `/api/ai-jobs/${preferred.id}/cancel`)
    // Una conexión inexistente no se sustituye por otra.
    expect((await createJob(owner, { connectionId: id('k') })).json()).toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    // Sin principal y sin preferencia: se pide elegir.
    await prefs(owner.cookie, {})
    await inject(owner.cookie, 'DELETE', `/api/account/ai-connections/${main}`)
    await connect(owner.cookie, 'simulador', SIM_OK, 'otra')
    expect((await createJob(owner)).json()).toMatchObject({ code: 'AI_CONNECTION_AMBIGUOUS' })
  })

  it('al eliminar una conexión se limpian las preferencias que la usaban, sin tocar las demás', async () => {
    const user = await account()
    const a = (await connect(user.cookie, 'simulador', SIM_OK)).json().id as string
    const b = (await connect(user.cookie, 'simulador', SIM_OK, 'b')).json().id as string
    const saved = await prefs(user.cookie, { text: { provider: 'simulador', model: 'sim-texto-1', connectionId: b }, poster: { provider: 'simulador', model: 'sim-imagen-1', connectionId: a }, moderation: { provider: 'simulador', connectionId: b } })
    expect(saved.json().preferences).toMatchObject({ text: { connectionId: b }, poster: { connectionId: a }, moderation: { provider: 'simulador', connectionId: b, available: true } })
    await inject(user.cookie, 'DELETE', `/api/account/ai-connections/${b}`)
    const after = (await inject(user.cookie, 'GET', '/api/account/ai-integrations')).json().preferences
    // El proveedor conserva otra conexión: se mantiene el modelo y se quita solo la conexión borrada.
    expect(after.text).toMatchObject({ provider: 'simulador', model: 'sim-texto-1', connectionId: null })
    expect(after.poster).toMatchObject({ connectionId: a })
    expect(after.moderation).toBeNull()
    await inject(user.cookie, 'DELETE', `/api/account/ai-connections/${a}`)
    const empty = (await inject(user.cookie, 'GET', '/api/account/ai-integrations')).json().preferences
    expect(empty).toMatchObject({ text: null, poster: null, video: null, moderation: null })
  })

  it('preferencias: solo modelos que generan ese contenido, del catálogo y de un proveedor con esa capacidad', async () => {
    const user = await account()
    await connect(user.cookie, 'simulador', SIM_OK)
    await connect(user.cookie, 'anthropic', FAKE)
    await connect(user.cookie, 'xai', FAKE)
    // Anthropic no genera imágenes ni vídeo.
    expect((await prefs(user.cookie, { poster: { provider: 'anthropic', model: 'claude-sonnet-5-5' } })).json()).toMatchObject({ code: 'AI_CAPABILITY_MISSING' })
    expect((await prefs(user.cookie, { video: { provider: 'anthropic', model: 'claude-sonnet-5-5' } })).json()).toMatchObject({ code: 'AI_CAPABILITY_MISSING' })
    // Un modelo de texto de xAI no vale para carteles, ni uno de imagen para texto o vídeo.
    expect((await prefs(user.cookie, { poster: { provider: 'xai', model: 'grok-4.3' } })).json()).toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect((await prefs(user.cookie, { text: { provider: 'xai', model: 'grok-imagine-image-2.0' } })).json()).toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect((await prefs(user.cookie, { video: { provider: 'xai', model: 'grok-imagine-image-2.0' } })).json()).toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect((await prefs(user.cookie, { text: { provider: 'anthropic', model: 'https://evil.example/v1' } })).json()).toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    // Un proveedor sin clave guardada no se puede elegir.
    expect((await prefs(user.cookie, { text: { provider: 'groq', model: 'openai/gpt-oss-120b' } })).json()).toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    // Un clasificador debe tener esa capacidad.
    expect((await prefs(user.cookie, { moderation: { provider: 'anthropic' } })).json()).toMatchObject({ code: 'AI_CAPABILITY_MISSING' })
    const ok = await prefs(user.cookie, { text: { provider: 'anthropic', model: 'claude-haiku-5-5' }, poster: { provider: 'xai', model: 'grok-imagine-image-2.0' }, video: { provider: 'xai', model: 'grok-imagine-video-1.5' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().preferences).toMatchObject({ text: { provider: 'anthropic', model: 'claude-haiku-5-5', available: true }, poster: { provider: 'xai', available: true }, video: { provider: 'xai', model: 'grok-imagine-video-1.5', available: true } })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('clasificador de seguridad externo (proveedores que no traen uno)', () => {
  it('sin clasificador configurado no se genera, no se crea el trabajo y no se llama al proveedor', async () => {
    const owner = await withPhotos()
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('recraft', syncAdapter(calls))
    await connect(owner.cookie, 'recraft', FAKE)
    const response = await createJob(owner, { provider: 'recraft', model: 'recraftv4_1', photoIds: [] })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'AI_MODERATION_REQUIRED', message: expect.stringContaining('clasificador de seguridad') })
    expect(calls).toEqual([])
    expect(await jobCount(owner.userId)).toBe(0)
  })

  it('con el clasificador del usuario: proveedor síncrono, sin fotografías, resultado listo para revisión', async () => {
    const owner = await withPhotos()
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('recraft', syncAdapter(calls))
    const recraft = (await connect(owner.cookie, 'recraft', FAKE)).json().id as string
    const classifier = (await connect(owner.cookie, 'simulador', SIM_OK)).json().id as string
    expect((await prefs(owner.cookie, { moderation: { provider: 'simulador' } })).statusCode).toBe(200)
    // Este modelo solo genera a partir de texto: no admite fotografías.
    expect((await createJob(owner, { provider: 'recraft', model: 'recraftv4_1' })).json()).toMatchObject({ code: 'AI_INVALID_REQUEST', message: expect.stringContaining('no admite fotografías') })
    const response = await createJob(owner, { provider: 'recraft', model: 'recraftv4_1', photoIds: [] })
    expect(response.statusCode).toBe(201)
    const job = response.json().job
    // Síncrono: validado, guardado y moderado en la misma petición; queda para la revisión del usuario.
    expect(job).toMatchObject({ status: 'ready', provider: 'recraft', model: 'recraftv4_1', moderationStatus: 'passed', resultReady: true, photoIds: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ kind: 'poster', model: 'recraftv4_1', references: [] })
    expect(calls[0].prompt.instructions).toContain('No incluyas texto')
    const row = await jobRow(job.id)
    expect(JSON.parse(row.params)).toEqual({ photoIds: [], connectionId: recraft, moderation: { provider: 'simulador', connectionId: classifier } })
    expect(row.resultKey).toMatch(/^u\//)
    // Coste estimado: el precio publicado por imagen.
    expect(job.estimatedCostUsd).toBe(0.035)
    expect(JSON.stringify(job)).not.toMatch(/FICTICIA|resultKey|encryptedKey/)
  })

  it.each([
    ['sim-bloqueo-entrada-12345', 'blocked', 0],
    ['sim-bloqueo-salida-123456', 'blocked', 1],
    ['sim-sin-moderacion-123456', 'failed', 0],
  ])('el clasificador externo decide (%s): %s, y el resultado no se conserva', async (classifierKey, status, submits) => {
    const owner = await withPhotos()
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('stability', syncAdapter(calls))
    await connect(owner.cookie, 'stability', FAKE)
    await connect(owner.cookie, 'simulador', classifierKey)
    await prefs(owner.cookie, { moderation: { provider: 'simulador' } })
    const job = (await createJob(owner, { provider: 'stability', model: 'stable-image-core', photoIds: [] })).json().job
    expect(job.status).toBe(status)
    expect(job.resultReady).toBe(false)
    expect(calls).toHaveLength(submits)
    // Fallo seguro: sin clasificación completada no hay propuesta aceptable.
    if (status === 'failed') expect((await jobRow(job.id)).failureCode).toBe('MODERATION_UNAVAILABLE')
  })

  it('un resultado que no es una imagen válida no se acepta', async () => {
    const owner = await withPhotos()
    mods.setAdapterForTests('recraft', syncAdapter([], Buffer.from('<html>no es una imagen</html>')))
    await connect(owner.cookie, 'recraft', FAKE)
    await connect(owner.cookie, 'simulador', SIM_OK)
    await prefs(owner.cookie, { moderation: { provider: 'simulador' } })
    const job = (await createJob(owner, { provider: 'recraft', model: 'recraftv4_1', photoIds: [] })).json().job
    expect(job).toMatchObject({ status: 'failed', resultReady: false })
    expect((await jobRow(job.id)).failureCode).toBe('AI_INVALID_OUTPUT')
  })

  it('vídeo: hace falta un clasificador que analice vídeo; el de OpenAI (texto e imagen) no basta', async () => {
    const owner = await withPhotos()
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('xai', syncAdapter(calls))
    await connect(owner.cookie, 'xai', FAKE)
    await connect(owner.cookie, 'openai', OPENAI_FAKE)
    expect((await prefs(owner.cookie, { moderation: { provider: 'openai' } })).statusCode).toBe(200)
    const primary = owner.source.photos.find(p => p.isPrimary)!
    const response = await createJob(owner, { kind: 'video', provider: 'xai', model: 'grok-imagine-video-1.5', photoIds: [primary.id], durationSeconds: 6 })
    expect(response.json()).toMatchObject({ code: 'AI_MODERATION_REQUIRED', message: expect.stringContaining('vídeo') })
    expect(calls).toEqual([])
    expect(await jobCount(owner.userId)).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('duraciones y referencias por modelo: Runway con MiniMax H3 admite 6 u 8 s y una sola fotografía', async () => {
    const owner = await withPhotos()
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('runway', syncAdapter(calls))
    await connect(owner.cookie, 'runway', RUNWAY_FAKE)
    await connect(owner.cookie, 'simulador', SIM_OK)
    await prefs(owner.cookie, { moderation: { provider: 'simulador' } })
    const primary = owner.source.photos.find(p => p.isPrimary)!
    const other = owner.source.photos.find(p => !p.isPrimary)!
    const video = { kind: 'video', provider: 'runway', model: 'hailuo3' }
    expect((await createJob(owner, { ...video, photoIds: [primary.id], durationSeconds: 4 })).json()).toMatchObject({ code: 'AI_INVALID_REQUEST', message: expect.stringContaining('6, 8') })
    expect((await createJob(owner, { ...video, photoIds: [primary.id, other.id], durationSeconds: 6 })).json()).toMatchObject({ code: 'AI_INVALID_REQUEST' })
    expect((await createJob(owner, { ...video, photoIds: [other.id], durationSeconds: 6 })).json()).toMatchObject({ code: 'AI_INVALID_REQUEST' })
    // Un modelo de imagen de Runway no vale para vídeo, ni uno que no esté en el catálogo.
    expect((await createJob(owner, { ...video, model: 'gen4_image', photoIds: [primary.id], durationSeconds: 6 })).json()).toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect((await createJob(owner, { ...video, model: 'gen3a_turbo', photoIds: [primary.id], durationSeconds: 6 })).json()).toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect(calls).toEqual([])
    expect(await jobCount(owner.userId)).toBe(0)
  })
})
