import { randomBytes } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// BYOK obligatorio también para el texto (DA-77), contra PostgreSQL real y la aplicación completa.
// Ninguna prueba llama a un proveedor real: fetch está sustituido por un espía que falla si se usa, y
// las «claves globales antiguas» del entorno son cadenas ficticias que deben ignorarse.

let database: TestDatabase
let admin: pg.Client
let app: FastifyInstance
let createSession: typeof import('../services/session.service.js')['createSession']
let closeDatabase: () => Promise<void>

const fetchSpy = vi.fn(async () => {
  throw new Error('llamada externa no permitida en esta prueba')
})

const ENCRYPTION_KEY = randomBytes(32).toString('base64')
const SIM_KEY = 'sim-ok-prueba12345'
const OLD_GLOBAL = 'clave-global-antigua-que-debe-ignorarse'
const id = (prefix: string) => `c${prefix}${randomBytes(10).toString('hex')}`.slice(0, 25)
const ipFor = (cookie: string) => `10.${cookie.length % 200}.${cookie.charCodeAt(30) % 250}.${cookie.charCodeAt(40) % 250}`

const property = {
  title: 'Piso de prueba',
  operation: 'sale',
  type: 'apartment',
  price: '250000',
  address: 'Calle Mayor 10',
  city: 'Madrid',
  neighborhood: 'Centro',
  area: 90,
  bedrooms: 3,
  bathrooms: 2,
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
  heating: true,
  additionalInformation: '',
}

async function account() {
  const userId = id('u')
  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt", "emailVerifiedAt") VALUES ($1, $2, 'x', now(), now())`, [userId, `${userId}@example.test`])
  const { token } = await createSession(userId)
  return { userId, cookie: `estateforge_session=${token}` }
}

const inject = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, remoteAddress: ipFor(cookie), headers: { cookie, ...(payload !== undefined && { 'content-type': 'application/json' }) }, ...(payload !== undefined && { payload: payload as Record<string, unknown> }) })

const generate = (cookie: string, provider: string, extra: Record<string, unknown> = {}) => inject(cookie, 'POST', '/api/generations', { property, provider, tone: 'professional', language: 'español', ...extra })
const saveKey = (cookie: string, provider: string, apiKey: string) => inject(cookie, 'PUT', `/api/account/ai-keys/${provider}`, { apiKey })
const count = async (table: string, userId: string) =>
  Number((await admin.query(table === 'Property' ? `SELECT count(*) FROM "Property" WHERE "userId" = $1` : `SELECT count(*) FROM "Generation" g JOIN "Property" p ON p.id = g."propertyId" WHERE p."userId" = $1`, [userId])).rows[0].count)

beforeAll(async () => {
  database = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', database.url)
  vi.stubEnv('ESTATEFORGE_API_KEY_ENCRYPTION_KEY', ENCRYPTION_KEY)
  vi.stubEnv('AI_MEDIA_SIMULATOR', '1')
  vi.stubEnv('NODE_ENV', 'test')
  // Variables de versiones anteriores presentes en el entorno: no deben leerse ni usarse.
  vi.stubEnv('GEMINI_API_KEY', OLD_GLOBAL)
  vi.stubEnv('OPENAI_API_KEY', OLD_GLOBAL)
  vi.stubEnv('AI_PROVIDER', 'openai')
  vi.stubGlobal('fetch', fetchSpy)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  vi.resetModules()
  createSession = (await import('../services/session.service.js')).createSession
  closeDatabase = (await import('../db/prisma.js')).closeDatabase
  app = await (await import('../app.js')).buildApp()
  await app.ready()
})

beforeEach(() => {
  fetchSpy.mockClear()
})

afterAll(async () => {
  await app.close()
  await closeDatabase()
  await admin.end()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await database.drop()
})

describe('sin API key: la aplicación funciona y la IA no se ejecuta', () => {
  it('la API arranca sin claves de IA y la configuración validada no las contiene', async () => {
    const { env } = await import('../env.js')
    expect(Object.keys(env).filter(name => /GEMINI|OPENAI|AI_PROVIDER/.test(name))).toEqual([])
    expect(JSON.stringify(env)).not.toContain(OLD_GLOBAL)
  })

  it('crear un inmueble y su anuncio con la plantilla local, y editarlo a mano, no requiere clave', async () => {
    const user = await account()
    const created = await generate(user.cookie, 'mock')
    expect(created.statusCode).toBe(200)
    const { generationId, propertyId } = created.json() as { generationId: string; propertyId: string }
    const again = await inject(user.cookie, 'POST', '/api/generations/from-property', { propertyId, provider: 'mock', tone: 'professional', language: 'español' })
    expect(again.statusCode).toBe(200)
    const edited = await inject(user.cookie, 'PUT', `/api/generations/${generationId}`, { title: 'Título escrito a mano', description: 'Descripción escrita a mano por el usuario.' })
    expect(edited.statusCode).toBe(200)
    const row = (await admin.query(`SELECT title, provider FROM "Generation" WHERE id = $1`, [generationId])).rows[0]
    expect(row).toEqual({ title: 'Título escrito a mano', provider: 'mock' })
    expect(Number((await admin.query(`SELECT count(*) FROM "UserAIKey" WHERE "userId" = $1`, [user.userId])).rows[0].count)).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each(['gemini', 'openai', 'simulador'])('%s sin clave: 409 AI_KEY_REQUIRED, sin llamada externa, sin clave global y sin crear nada', async provider => {
    const user = await account()
    const response = await generate(user.cookie, provider)
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('AI_KEY_REQUIRED')
    expect(response.body).not.toContain(OLD_GLOBAL)
    expect(fetchSpy).not.toHaveBeenCalled()
    // Sin sustitución silenciosa: no se ha generado nada con la plantilla local ni con otro proveedor.
    expect(await count('Property', user.userId)).toBe(0)
    expect(await count('Generation', user.userId)).toBe(0)
  })

  it('desde un inmueble existente, sin clave: 409 y ningún anuncio nuevo', async () => {
    const user = await account()
    const { propertyId } = (await generate(user.cookie, 'mock')).json() as { propertyId: string }
    const response = await inject(user.cookie, 'POST', '/api/generations/from-property', { propertyId, provider: 'gemini', tone: 'professional', language: 'español' })
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('AI_KEY_REQUIRED')
    expect(await count('Generation', user.userId)).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('la clave temporal por petición ya no existe: el campo apiKey se rechaza', async () => {
    const user = await account()
    const response = await generate(user.cookie, 'gemini', { apiKey: 'AIzaSyFAKE-not-a-real-key-0123456789abcd' })
    expect(response.statusCode).toBe(400)
    expect(response.body).not.toContain('AIzaSyFAKE')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('con la API key del usuario', () => {
  it('se usa la credencial del usuario autenticado; la de otro usuario no sirve', async () => {
    const withKey = await account()
    const withoutKey = await account()
    expect((await saveKey(withKey.cookie, 'simulador', SIM_KEY)).statusCode).toBe(200)

    const ok = await generate(withKey.cookie, 'simulador')
    expect(ok.statusCode).toBe(200)
    expect(ok.body).not.toContain(SIM_KEY)
    const row = (await admin.query(`SELECT provider FROM "Generation" WHERE id = $1`, [ok.json().generationId])).rows[0]
    expect(row.provider).toBe('simulador')

    const other = await generate(withoutKey.cookie, 'simulador')
    expect(other.statusCode).toBe(409)
    expect(other.json().code).toBe('AI_KEY_REQUIRED')
    expect(await count('Generation', withoutKey.userId)).toBe(0)
  })

  it('tener clave de un proveedor no habilita otro: no hay proveedor de respaldo', async () => {
    const user = await account()
    await saveKey(user.cookie, 'simulador', SIM_KEY)
    const response = await generate(user.cookie, 'openai')
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('AI_KEY_REQUIRED')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await count('Generation', user.userId)).toBe(0)
  })

  it('preferencia de texto: exige clave y modelo del catálogo; se devuelve y se borra con la clave', async () => {
    const user = await account()
    const pref = (text: unknown) => inject(user.cookie, 'PUT', '/api/account/ai-preferences', { text, poster: null, video: null })
    expect((await pref({ provider: 'simulador', model: 'sim-texto-1' })).statusCode).toBe(409)
    await saveKey(user.cookie, 'simulador', SIM_KEY)
    expect((await pref({ provider: 'simulador', model: 'modelo-inventado' })).statusCode).toBeGreaterThanOrEqual(400)
    // Un modelo de cartel no vale como modelo de texto.
    expect((await pref({ provider: 'simulador', model: 'sim-imagen-1' })).statusCode).toBeGreaterThanOrEqual(400)
    const saved = await pref({ provider: 'simulador', model: 'sim-texto-1' })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().preferences.text).toEqual({ provider: 'simulador', model: 'sim-texto-1', connectionId: null, available: true })
    expect((await generate(user.cookie, 'simulador')).statusCode).toBe(200)

    expect((await inject(user.cookie, 'DELETE', '/api/account/ai-keys/simulador')).statusCode).toBeLessThan(300)
    const after = (await inject(user.cookie, 'GET', '/api/account/ai-integrations')).json()
    expect(after.preferences.text).toBeNull()
    expect(after.connections).toEqual([])
    expect((await generate(user.cookie, 'simulador')).statusCode).toBe(409)
  })

  it('modelo preferido retirado del catálogo: se informa al usuario y no se sustituye por otro', async () => {
    const user = await account()
    await saveKey(user.cookie, 'simulador', SIM_KEY)
    await admin.query(`INSERT INTO "AiMediaPreference" ("userId", "textProvider", "textModel", "updatedAt") VALUES ($1, 'simulador', 'sim-texto-retirado', now())`, [user.userId])
    const integrations = (await inject(user.cookie, 'GET', '/api/account/ai-integrations')).json()
    expect(integrations.preferences.text).toEqual({ provider: 'simulador', model: 'sim-texto-retirado', connectionId: null, available: false })
    const response = await generate(user.cookie, 'simulador')
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED', message: expect.stringContaining('ya no está disponible') })
    expect(await count('Generation', user.userId)).toBe(0)
    // La preferencia guardada no se ha tocado: la cambia el usuario.
    expect((await admin.query(`SELECT "textModel" FROM "AiMediaPreference" WHERE "userId" = $1`, [user.userId])).rows[0].textModel).toBe('sim-texto-retirado')
    // Al elegir un modelo vigente vuelve a funcionar.
    expect((await inject(user.cookie, 'PUT', '/api/account/ai-preferences', { text: { provider: 'simulador', model: 'sim-texto-1' }, poster: null, video: null })).statusCode).toBe(200)
    expect((await generate(user.cookie, 'simulador')).statusCode).toBe(200)
  })

  it('una credencial que no se puede descifrar no se usa: 409 AI_KEY_UNREADABLE', async () => {
    const user = await account()
    await saveKey(user.cookie, 'simulador', SIM_KEY)
    await admin.query(`UPDATE "UserAIKey" SET "encryptedKey" = 'AAAA.BBBB.CCCC' WHERE "userId" = $1`, [user.userId])
    const response = await generate(user.cookie, 'simulador')
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('AI_KEY_UNREADABLE')
    expect(await count('Generation', user.userId)).toBe(0)
  })

  it('el catálogo ofrece texto en Gemini y OpenAI y nunca expone claves ni datos internos', async () => {
    const user = await account()
    const { providers } = (await inject(user.cookie, 'GET', '/api/ai/providers')).json() as { providers: { id: string; capabilities: string[]; models: { id: string; purpose: string }[] }[] }
    for (const provider of ['gemini', 'openai', 'simulador']) {
      const found = providers.find(item => item.id === provider)
      expect(found?.capabilities).toContain('text')
      expect(found?.models.some(model => model.purpose === 'text')).toBe(true)
    }
    // OpenAI: texto, fondo de cartel (GPT Image) y moderación; ningún modelo de vídeo (Sora se cerró).
    expect(providers.find(item => item.id === 'openai')?.models.some(model => model.purpose === 'video')).toBe(false)
    // Catálogo de OpenAI (MD-35): modelos y precios publicados, con fuente, fecha y modalidad.
    const openai = providers.find(item => item.id === 'openai') as unknown as { capabilities: string[]; models: { id: string; tier: string; pricing: { tokens: unknown; source: string; consultedAt: string; currency: string; status: string } }[] }
    expect(openai.capabilities).toEqual(['text', 'image', 'image-reference', 'moderation'])
    expect(openai.models.filter(model => (model as unknown as { purpose: string }).purpose === 'text').map(model => [model.id, model.tier])).toEqual([['gpt-6.1-terra', 'recommended'], ['gpt-6-luna', 'alternative'], ['gpt-6.1-sol', 'alternative'], ['gpt-5.5', 'legacy']])
    expect(openai.models[0].pricing).toMatchObject({ tokens: { inputUsd: 1, cachedInputUsd: 0.05, outputUsd: 5 }, currency: 'USD', status: 'confirmed', consultedAt: '2026-11-12', source: 'https://developers.openai.com/api/docs/models/gpt-6.1-terra' })
    expect(JSON.stringify(providers)).not.toMatch(/keyPattern|allowedHosts|clave-global/)
  })
})
