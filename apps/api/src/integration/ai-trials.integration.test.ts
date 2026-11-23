import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiProviderAdapter, SubmitRequest, VerifyResult } from '../ai-media/adapter.js'
import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Diagnóstico de conexiones (DA-87) y pruebas reales controladas (DA-89) contra PostgreSQL real y la
// aplicación completa. Ninguna prueba llama a un proveedor real: los proveedores se sustituyen por adaptadores
// de prueba o por el simulador local, y fetch está sustituido por un espía que falla si se usa. Lo que se
// comprueba es el flujo de EstateForge (confirmación, una sola operación, validación, descarte, límites y
// aislamiento), no el comportamiento de ningún servicio real.

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
const FAKE = 'clave-FICTICIA-de-prueba-que-no-es-real-0000'
const id = (prefix: string) => `c${prefix}${randomBytes(10).toString('hex')}`.slice(0, 25)
const ipFor = (cookie: string) => `10.${cookie.length % 200}.${cookie.charCodeAt(30) % 250}.${cookie.charCodeAt(41) % 250}`

async function account() {
  const userId = id('u')
  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt", "emailVerifiedAt") VALUES ($1, $2, 'x', now(), now())`, [userId, `${userId}@example.test`])
  const { token } = await mods.createSession(userId)
  return { userId, cookie: `estateforge_session=${token}` }
}

const inject = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, remoteAddress: ipFor(cookie), headers: { cookie, ...(payload !== undefined && { 'content-type': 'application/json' }) }, ...(payload !== undefined && { payload: payload as Record<string, unknown> }) })

async function connect(cookie: string, provider: string, apiKey: string, label = ''): Promise<string> {
  const response = await inject(cookie, 'POST', '/api/account/ai-connections', { provider, label, apiKey })
  expect(response.statusCode, response.body).toBe(201)
  return response.json().id as string
}
const integrations = async (cookie: string) => (await inject(cookie, 'GET', '/api/account/ai-integrations')).json()
const plan = async (cookie: string, body: Record<string, unknown>) => inject(cookie, 'POST', '/api/account/ai-trials/plan', body)

/** Plan y confirmación tal como los envía la web: lo que el usuario ha visto. */
async function confirmAndCreate(cookie: string, target: { connectionId: string; kind: string; model: string; durationSeconds?: number }, overrides: Record<string, unknown> = {}, idempotencyKey = randomUUID()) {
  const planned = await plan(cookie, target)
  expect(planned.statusCode, planned.body).toBe(200)
  const p = planned.json().plan
  return inject(cookie, 'POST', '/api/account/ai-trials', {
    ...target,
    idempotencyKey,
    confirmation: { provider: p.provider.id, model: p.model.id, connectionId: p.connection.id, estimatedCostMicroUsd: p.estimatedCostMicroUsd, acceptCharges: true, ...overrides },
  })
}

const count = async (table: string, userId: string) => Number((await admin.query(`SELECT count(*) FROM "${table}" WHERE "userId" = $1`, [userId])).rows[0].count)
const storedFiles = () => readdirSync(root, { recursive: true }).length

/** Proveedor síncrono de prueba (sin clasificador propio), con contador de envíos. */
function syncAdapter(calls: SubmitRequest[], behaviour: 'ok' | 'uncertain' | 'permission' | 'url' = 'ok'): AiProviderAdapter {
  return {
    verifyKey: async () => ({ ok: true }),
    submit: async (_ctx, request) => {
      calls.push(request)
      if (behaviour === 'uncertain') throw new Error('ECONNRESET tras enviar')
      if (behaviour === 'permission') throw new mods.AiMediaError('AI_PERMISSION_DENIED', 'Sin permiso.')
      if (behaviour === 'url') return { operationId: 'sync', immediate: { state: 'done', output: { mimeType: 'image/png', uri: 'https://img.recraft.ai/resultado.png?firma=secreta-123' }, providerFlagged: false } }
      return { operationId: 'sync', immediate: { state: 'done', output: { mimeType: 'image/png', data: mods.simulatedBackground(928, 1152, 3) }, providerFlagged: false } }
    },
    poll: async () => ({ state: 'failed', code: 'AI_PROVIDER_FAILED' }),
    cancel: async () => false,
    fetchResult: async () => mods.simulatedBackground(800, 1000, 4),
    moderate: async () => {
      throw new mods.AiMediaError('MODERATION_UNAVAILABLE', 'Este proveedor no clasifica.', 'moderation_unavailable')
    },
  }
}

function verifyAdapter(result: VerifyResult, calls: { count: number }): AiProviderAdapter {
  return {
    ...syncAdapter([]),
    verifyKey: async () => {
      calls.count += 1
      return result
    },
  }
}

/** Usuario con una conexión del simulador como clasificador de seguridad (para los proveedores que no moderan). */
async function withClassifier() {
  const owner = await account()
  const sim = await connect(owner.cookie, 'simulador', SIM_OK)
  const saved = await inject(owner.cookie, 'PUT', '/api/account/ai-preferences', { poster: null, video: null, moderation: { provider: 'simulador', connectionId: sim } })
  expect(saved.statusCode, saved.body).toBe(200)
  return { ...owner, sim }
}

beforeAll(async () => {
  database = await createTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'ef-trial-'))
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
  for (const provider of ['recraft', 'anthropic', 'xai', 'bfl', 'runway']) mods.setAdapterForTests(provider, null)
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

describe('comprobación de la conexión: coste y diagnóstico (DA-87)', () => {
  it('si la documentación no indica el coste, no se comprueba sin la confirmación del usuario', async () => {
    const owner = await account()
    const connection = await connect(owner.cookie, 'anthropic', FAKE)
    const calls = { count: 0 }
    mods.setAdapterForTests('anthropic', verifyAdapter({ ok: true, models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'otro-modelo'] }, calls))
    const refused = await inject(owner.cookie, 'POST', `/api/account/ai-connections/${connection}/verify`, {})
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ code: 'AI_VERIFY_COST_UNCONFIRMED' })
    expect(calls.count).toBe(0)
    const accepted = await inject(owner.cookie, 'POST', `/api/account/ai-connections/${connection}/verify`, { acknowledgeCost: true })
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(calls.count).toBe(1)
    expect(accepted.json()).toMatchObject({
      status: 'verified',
      diagnostics: { generatesContent: false, generationVerified: false, models: { listedByAccount: ['claude-sonnet-5-5', 'claude-haiku-5-5'], notListedByAccount: ['claude-opus-5-5'], accountTotal: 3 } },
    })
    // El diagnóstico se guarda (sin la respuesta del proveedor) y se devuelve en Ajustes; la columna en bruto, no.
    const listed = (await integrations(owner.cookie)).connections.find((item: { id: string }) => item.id === connection)
    expect(listed.diagnostics.models.notListedByAccount).toEqual(['claude-opus-5-5'])
    expect(listed).not.toHaveProperty('lastCheckDetails')
    expect(JSON.stringify(listed)).not.toContain(FAKE)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('403: la clave se reconoce pero sin permiso; la conexión queda con error, no como inválida', async () => {
    const owner = await account()
    const connection = await connect(owner.cookie, 'anthropic', FAKE)
    mods.setAdapterForTests('anthropic', verifyAdapter({ ok: false, code: 'AI_PERMISSION_DENIED' }, { count: 0 }))
    const response = await inject(owner.cookie, 'POST', `/api/account/ai-connections/${connection}/verify`, { acknowledgeCost: true })
    expect(response.json()).toMatchObject({ status: 'error', code: 'AI_PERMISSION_DENIED', diagnostics: { problem: 'AI_PERMISSION_DENIED' } })
    const row = (await admin.query(`SELECT status, "lastErrorCode" FROM "UserAIKey" WHERE id = $1`, [connection])).rows[0]
    expect(row).toEqual({ status: 'error', lastErrorCode: 'AI_PERMISSION_DENIED' })
  })

  it('un proveedor con comprobación documentada como gratuita no pide confirmación; al sustituir la clave se borra el diagnóstico', async () => {
    const owner = await account()
    const connection = await connect(owner.cookie, 'simulador', SIM_OK)
    const response = await inject(owner.cookie, 'POST', `/api/account/ai-connections/${connection}/verify`, {})
    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('verified')
    expect((await admin.query(`SELECT "lastCheckDetails" FROM "UserAIKey" WHERE id = $1`, [connection])).rows[0].lastCheckDetails).not.toBeNull()
    expect((await inject(owner.cookie, 'PUT', `/api/account/ai-connections/${connection}`, { apiKey: 'sim-ok-otraclave99' })).statusCode).toBe(200)
    expect((await admin.query(`SELECT "lastCheckDetails", status FROM "UserAIKey" WHERE id = $1`, [connection])).rows[0]).toEqual({ lastCheckDetails: null, status: 'unverified' })
  })
})

describe('pruebas reales controladas: plan y confirmación (DA-89)', () => {
  it('el plan muestra proveedor, fabricante, modelo, cuenta que factura, datos sintéticos y coste; no llama a nada', async () => {
    const owner = await withClassifier()
    const recraft = await connect(owner.cookie, 'recraft', FAKE)
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('recraft', syncAdapter(calls))
    const response = await plan(owner.cookie, { connectionId: recraft, kind: 'poster', model: 'recraftv4_1' })
    expect(response.statusCode, response.body).toBe(200)
    const p = response.json().plan
    expect(p).toMatchObject({ kind: 'poster', provider: { id: 'recraft', kind: 'direct' }, model: { id: 'recraftv4_1', maker: 'Recraft' }, connection: { id: recraft }, referenceImages: 0, moderation: { provider: 'simulador', external: true }, moderationRequired: true })
    expect(p.provider.billing).toMatch(/Recraft/)
    expect(p.costVerifiable).toBe(p.estimatedCostMicroUsd !== null)
    expect(p.dataSent.join(' ')).toMatch(/ficticio|sintétic/)
    expect(p.warnings.join(' ')).toMatch(/cargos/)
    expect(calls).toHaveLength(0)
    expect(await count('AiProviderTrial', owner.userId)).toBe(0)
  })

  it('sin aceptar los cargos, o con un coste o un modelo distinto del plan, no se crea nada ni se llama al proveedor', async () => {
    const owner = await withClassifier()
    const recraft = await connect(owner.cookie, 'recraft', FAKE)
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('recraft', syncAdapter(calls))
    const target = { connectionId: recraft, kind: 'poster', model: 'recraftv4_1' }
    const noAccept = await inject(owner.cookie, 'POST', '/api/account/ai-trials', { ...target, idempotencyKey: randomUUID(), confirmation: { provider: 'recraft', model: 'recraftv4_1', connectionId: recraft, estimatedCostMicroUsd: null, acceptCharges: false } })
    expect(noAccept.statusCode).toBe(400)
    expect(noAccept.json().code).toBe('AI_TRIAL_CONFIRMATION')
    const wrongCost = await confirmAndCreate(owner.cookie, target, { estimatedCostMicroUsd: 1 })
    expect(wrongCost.statusCode).toBe(409)
    expect(wrongCost.json().code).toBe('AI_TRIAL_CONFIRMATION')
    const wrongModel = await confirmAndCreate(owner.cookie, target, { model: 'recraftv4_1_flash' })
    expect(wrongModel.json().code).toBe('AI_TRIAL_CONFIRMATION')
    expect(calls).toHaveLength(0)
    expect(await count('AiProviderTrial', owner.userId)).toBe(0)
  })

  it('sin clasificador de seguridad no hay prueba de imagen ni de vídeo', async () => {
    const owner = await account()
    const recraft = await connect(owner.cookie, 'recraft', FAKE)
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('recraft', syncAdapter(calls))
    const planned = (await plan(owner.cookie, { connectionId: recraft, kind: 'poster', model: 'recraftv4_1' })).json().plan
    expect(planned.moderation).toBeNull()
    const response = await confirmAndCreate(owner.cookie, { connectionId: recraft, kind: 'poster', model: 'recraftv4_1' })
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('AI_MODERATION_REQUIRED')
    expect(calls).toHaveLength(0)
  })
})

describe('pruebas reales controladas: ejecución (con adaptadores de prueba y el simulador)', () => {
  it('texto: una operación con datos sintéticos; superada; no toca inmuebles, anuncios ni trabajos', async () => {
    const owner = await account()
    const sim = await connect(owner.cookie, 'simulador', SIM_OK)
    const before = { properties: await count('Property', owner.userId), jobs: await count('AiMediaJob', owner.userId) }
    const response = await confirmAndCreate(owner.cookie, { connectionId: sim, kind: 'text', model: 'sim-texto-1' })
    expect(response.statusCode, response.body).toBe(201)
    const trial = response.json().trial
    expect(trial).toMatchObject({ status: 'passed', kind: 'text', provider: 'simulador', model: 'sim-texto-1', active: false, estimatedCostUsd: null })
    expect(trial.report.output).toMatchObject({ structured: true })
    expect(trial.report.fallback).toBe(false)
    expect(trial.contractVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    expect({ properties: await count('Property', owner.userId), jobs: await count('AiMediaJob', owner.userId) }).toEqual(before)
    // Aparece en las pruebas superadas del usuario.
    expect((await integrations(owner.cookie)).realTrials.simulador).toEqual([expect.objectContaining({ model: 'sim-texto-1', kind: 'text' })])
  })

  it('imagen: proveedor síncrono con el clasificador del usuario; el resultado se valida, se informa y se descarta', async () => {
    const owner = await withClassifier()
    const recraft = await connect(owner.cookie, 'recraft', FAKE)
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('recraft', syncAdapter(calls))
    const files = storedFiles()
    const response = await confirmAndCreate(owner.cookie, { connectionId: recraft, kind: 'poster', model: 'recraftv4_1' })
    expect(response.statusCode, response.body).toBe(201)
    const trial = response.json().trial
    expect(trial.status).toBe('passed')
    expect(trial.report).toMatchObject({ inputModeration: 'passed', outputModeration: 'passed', output: { valid: true, mimeType: 'image/png', width: 928, height: 1152, delivery: 'inline' } })
    expect(trial.report.output.sha256).toMatch(/^[0-9a-f]{64}$/)
    // Una sola llamada, sin fotografías (el modelo no admite referencias) y con el prompt del inmueble ficticio.
    expect(calls).toHaveLength(1)
    expect(calls[0].references).toHaveLength(0)
    expect(calls[0].model).toBe('recraftv4_1')
    // Nada se guarda en el almacenamiento.
    expect(storedFiles()).toBe(files)
    expect(await count('AiMediaJob', owner.userId)).toBe(0)
  })

  it('resultado entregado por URL: el informe guarda solo el host, nunca la ruta ni la firma', async () => {
    const owner = await withClassifier()
    const recraft = await connect(owner.cookie, 'recraft', FAKE)
    mods.setAdapterForTests('recraft', syncAdapter([], 'url'))
    const trial = (await confirmAndCreate(owner.cookie, { connectionId: recraft, kind: 'poster', model: 'recraftv4_1' })).json().trial
    expect(trial.status).toBe('passed')
    expect(trial.report.output).toMatchObject({ delivery: 'url', resultHost: 'img.recraft.ai', width: 800, height: 1000 })
    const row = (await admin.query(`SELECT report FROM "AiProviderTrial" WHERE id = $1`, [trial.id])).rows[0]
    expect(row.report).not.toMatch(/firma|secreta|resultado\.png/)
  })

  it('vídeo (simulador): duración mínima del modelo, sondeo, validación del contenedor y descarte', async () => {
    const owner = await account()
    const sim = await connect(owner.cookie, 'simulador', SIM_OK)
    const created = await confirmAndCreate(owner.cookie, { connectionId: sim, kind: 'video', model: 'sim-video-1' })
    expect(created.statusCode, created.body).toBe(201)
    let trial = created.json().trial
    expect(trial.durationSeconds).toBe(4)
    expect(['submitted', 'processing']).toContain(trial.status)
    for (let i = 0; i < 5 && trial.active; i += 1) {
      await admin.query(`UPDATE "AiProviderTrial" SET "lastPolledAt" = NULL WHERE id = $1`, [trial.id])
      trial = (await inject(owner.cookie, 'GET', `/api/account/ai-trials/${trial.id}`)).json().trial
    }
    expect(trial.status).toBe('passed')
    expect(trial.report.output).toMatchObject({ valid: true, mimeType: 'video/webm' })
    expect(trial.report.output.durationMs).toBeGreaterThan(1000)
    expect(JSON.stringify(trial)).not.toMatch(/sim\.video\./)
  })

  it('estado incierto: no se repite, ni al consultar ni al reenviar la misma petición', async () => {
    const owner = await withClassifier()
    const recraft = await connect(owner.cookie, 'recraft', FAKE)
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('recraft', syncAdapter(calls, 'uncertain'))
    const key = randomUUID()
    const first = (await confirmAndCreate(owner.cookie, { connectionId: recraft, kind: 'poster', model: 'recraftv4_1' }, {}, key)).json().trial
    expect(first).toMatchObject({ status: 'uncertain', failureCode: 'AI_PROVIDER_UNCERTAIN' })
    expect(first.message).toMatch(/no se ha repetido/i)
    const again = await confirmAndCreate(owner.cookie, { connectionId: recraft, kind: 'poster', model: 'recraftv4_1' }, {}, key)
    expect(again.json().trial.id).toBe(first.id)
    await inject(owner.cookie, 'GET', `/api/account/ai-trials/${first.id}`)
    expect(calls).toHaveLength(1)
  })

  it('permiso denegado: la prueba falla y la conexión queda con error, no como inválida', async () => {
    const owner = await withClassifier()
    const recraft = await connect(owner.cookie, 'recraft', FAKE)
    mods.setAdapterForTests('recraft', syncAdapter([], 'permission'))
    const trial = (await confirmAndCreate(owner.cookie, { connectionId: recraft, kind: 'poster', model: 'recraftv4_1' })).json().trial
    expect(trial).toMatchObject({ status: 'failed', failureCode: 'AI_PERMISSION_DENIED' })
    expect((await admin.query(`SELECT status FROM "UserAIKey" WHERE id = $1`, [recraft])).rows[0].status).toBe('error')
  })
})

describe('pruebas reales controladas: aislamiento y límites', () => {
  it('nadie ve ni usa las pruebas ni las conexiones de otro usuario', async () => {
    const owner = await account()
    const other = await account()
    const sim = await connect(owner.cookie, 'simulador', SIM_OK)
    const trial = (await confirmAndCreate(owner.cookie, { connectionId: sim, kind: 'text', model: 'sim-texto-1' })).json().trial
    expect((await inject(other.cookie, 'GET', `/api/account/ai-trials/${trial.id}`)).statusCode).toBe(404)
    expect((await inject(other.cookie, 'GET', '/api/account/ai-trials')).json().trials).toEqual([])
    expect((await inject(other.cookie, 'POST', `/api/account/ai-trials/${trial.id}/cancel`)).statusCode).toBe(404)
    // La conexión de otro usuario no existe para él: ni plan ni prueba.
    const foreign = await plan(other.cookie, { connectionId: sim, kind: 'text', model: 'sim-texto-1' })
    expect(foreign.statusCode).toBe(409)
    expect(foreign.json().code).toBe('AI_NOT_CONFIGURED')
  })

  it('las pruebas cuentan en el límite diario de generaciones con IA', async () => {
    const owner = await account()
    const sim = await connect(owner.cookie, 'simulador', SIM_OK)
    vi.stubEnv('AI_MEDIA_DAILY_LIMIT', '1')
    try {
      expect((await confirmAndCreate(owner.cookie, { connectionId: sim, kind: 'text', model: 'sim-texto-1' })).statusCode).toBe(201)
      const second = await confirmAndCreate(owner.cookie, { connectionId: sim, kind: 'text', model: 'sim-texto-1' })
      expect(second.statusCode).toBe(429)
      expect(second.json().code).toBe('AI_DAILY_LIMIT')
    } finally {
      vi.stubEnv('AI_MEDIA_DAILY_LIMIT', '20')
    }
  })

  it('una prueba en curso impide otra; se puede cancelar y queda registrada', async () => {
    const owner = await account()
    const sim = await connect(owner.cookie, 'simulador', SIM_OK)
    vi.stubEnv('AI_SIMULATOR_DELAY_MS', '600000')
    try {
      const trial = (await confirmAndCreate(owner.cookie, { connectionId: sim, kind: 'video', model: 'sim-video-1' })).json().trial
      expect(trial.active).toBe(true)
      const second = await confirmAndCreate(owner.cookie, { connectionId: sim, kind: 'text', model: 'sim-texto-1' })
      expect(second.json().code).toBe('AI_CONCURRENCY_LIMIT')
      const cancelled = (await inject(owner.cookie, 'POST', `/api/account/ai-trials/${trial.id}/cancel`)).json().trial
      expect(cancelled.status).toBe('cancelled')
      expect((await inject(owner.cookie, 'POST', `/api/account/ai-trials/${trial.id}/cancel`)).statusCode).toBe(409)
    } finally {
      vi.stubEnv('AI_SIMULATOR_DELAY_MS', '0')
    }
  })

  it('eliminar la conexión conserva el historial de la prueba, sin la conexión', async () => {
    const owner = await account()
    const sim = await connect(owner.cookie, 'simulador', SIM_OK)
    const trial = (await confirmAndCreate(owner.cookie, { connectionId: sim, kind: 'text', model: 'sim-texto-1' })).json().trial
    expect((await inject(owner.cookie, 'DELETE', `/api/account/ai-connections/${sim}`)).statusCode).toBe(200)
    const listed = (await inject(owner.cookie, 'GET', '/api/account/ai-trials')).json().trials
    expect(listed).toEqual([expect.objectContaining({ id: trial.id, status: 'passed', connectionId: null })])
  })
})

describe('las seis pruebas propuestas (DA-93) y el coste por resolución (DA-92)', () => {
  const RUNWAY_KEY = 'key_FICTICIA0000000000000000000000'
  const clip = () => readFileSync(join(import.meta.dirname, '../ai-media/fixtures/simulador-clip.webm'))

  it('sin conexiones: las seis aparecen pendientes de credenciales, con su coste y sin ejecutar nada', async () => {
    const owner = await account()
    const response = await inject(owner.cookie, 'GET', '/api/account/ai-trials/presets')
    expect(response.statusCode).toBe(200)
    const presets = response.json().presets as { id: string; kind: string; available: boolean; connections: unknown[]; moderationRequired: boolean; moderationMissing: boolean; moderation: { provider: string } | null; cost: { knownUsd: number; complete: boolean } | null; billing: string; maker: string }[]
    expect(presets.map(preset => preset.id)).toEqual(['texto-directo', 'texto-agregador', 'imagen-directa', 'imagen-agregador', 'video-directo', 'video-agregador'])
    expect(presets.every(preset => preset.available && preset.connections.length === 0 && preset.cost && preset.billing && preset.maker)).toBe(true)
    // Gemini trae su clasificador; Runway y xAI necesitan el del usuario, que no tiene.
    expect(presets.map(preset => [preset.id, preset.moderationRequired, preset.moderationMissing, preset.moderation?.provider ?? null])).toEqual([
      ['texto-directo', false, false, null],
      ['texto-agregador', false, false, null],
      ['imagen-directa', true, false, 'gemini'],
      ['imagen-agregador', true, true, null],
      ['video-directo', true, true, null],
      ['video-agregador', true, true, null],
    ])
    expect(presets.find(preset => preset.id === 'video-agregador')!.cost!.knownUsd).toBe(0.09)
    expect(await count('AiProviderTrial', owner.userId)).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('la conexión no se elige por el usuario: el preset lista las suyas y el plan exige una concreta', async () => {
    const owner = await withClassifier()
    const runway = await connect(owner.cookie, 'runway', RUNWAY_KEY)
    const presets = (await inject(owner.cookie, 'GET', '/api/account/ai-trials/presets')).json().presets as { id: string; connections: { id: string }[]; moderation: { provider: string } | null }[]
    const preset = presets.find(item => item.id === 'video-agregador')!
    expect(preset.connections.map(item => item.id)).toEqual([runway])
    expect(preset.moderation?.provider).toBe('simulador')
    expect((await plan(owner.cookie, { kind: 'video', model: 'gemini_omni_flash_1.2', durationSeconds: 4, resolution: '360p', references: 1 })).statusCode).toBe(400)
  })

  it('Runway Gemini Omni Flash 1.2 a 360p y 4 s: plan con desglose; la resolución llega al adaptador; el resultado se valida y se descarta', async () => {
    const owner = await withClassifier()
    const runway = await connect(owner.cookie, 'runway', RUNWAY_KEY)
    const calls: SubmitRequest[] = []
    mods.setAdapterForTests('runway', {
      ...syncAdapter([]),
      submit: async (_ctx, request) => {
        calls.push(request)
        return { operationId: 'task', immediate: { state: 'done', output: { mimeType: 'video/webm', data: clip() }, providerFlagged: false } }
      },
    })
    const target = { connectionId: runway, kind: 'video', model: 'gemini_omni_flash_1.2', durationSeconds: 4, resolution: '360p', references: 1 }
    const planned = (await plan(owner.cookie, target)).json().plan
    expect(planned).toMatchObject({ resolution: '360p', resolutionLabel: '360p (640×360)', durationSeconds: 4, referenceImages: 1, estimatedCostMicroUsd: 90_000, costKnownUsd: 0.09, priceConsultedAt: '2026-11-15', moderation: { provider: 'simulador', external: true } })
    expect(planned.costLines.map((line: { usd: number | null }) => line.usd)).toEqual([0.08, 0.01, 0])
    expect(calls).toHaveLength(0)
    const created = await confirmAndCreate(owner.cookie, target)
    expect(created.statusCode, created.body).toBe(201)
    const trial = created.json().trial
    expect(trial.status).toBe('passed')
    expect(trial.report.requested).toMatchObject({ resolution: '360p (640×360)', resolutionId: '360p', durationSeconds: 4, referenceImages: 1 })
    expect(trial.report.output).toMatchObject({ valid: true, mimeType: 'video/webm' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ model: 'gemini_omni_flash_1.2', resolution: '360p', durationSeconds: 4 })
    expect(calls[0].references).toHaveLength(1)
    expect(await count('AiMediaJob', owner.userId)).toBe(0)
  })

  it('resolución no ofrecida por el modelo, o referencias que el modelo no admite: 400 sin crear nada', async () => {
    const owner = await withClassifier()
    const runway = await connect(owner.cookie, 'runway', RUNWAY_KEY)
    expect((await plan(owner.cookie, { connectionId: runway, kind: 'video', model: 'gemini_omni_flash_1.2', durationSeconds: 4, resolution: '1080p', references: 1 })).json().code).toBe('AI_INVALID_REQUEST')
    expect((await plan(owner.cookie, { connectionId: runway, kind: 'video', model: 'gemini_omni_flash_1.2', durationSeconds: 4, references: 0 })).json().code).toBe('AI_INVALID_REQUEST')
    expect((await plan(owner.cookie, { connectionId: runway, kind: 'poster', model: 'nano_banana_2.1', resolution: '360p' })).json().code).toBe('AI_INVALID_REQUEST')
    expect(await count('AiProviderTrial', owner.userId)).toBe(0)
  })

  it('texto: el informe dice si la API devolvió tokens (el simulador no los devuelve) y no inventa un coste', async () => {
    const owner = await account()
    const sim = await connect(owner.cookie, 'simulador', SIM_OK)
    const trial = (await confirmAndCreate(owner.cookie, { connectionId: sim, kind: 'text', model: 'sim-texto-1' })).json().trial
    expect(trial.report.usage).toMatchObject({ reported: false })
  })
})
