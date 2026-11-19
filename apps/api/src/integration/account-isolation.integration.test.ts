import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PUBLICATION_PLATFORM_IDS } from '@estateforge/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { makeJpeg, makePng } from '../test-support/images.js'
import { makeMp3 } from '../test-support/media-files.js'
import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Aislamiento entre cuentas sobre la aplicación completa, PostgreSQL real y el simulador local de Blob
// en modo de transferencias directas. Dos cuentas sintéticas: A (titular de todos los recursos) y B
// (intrusa, rol USER), más una cuenta OWNER para el control positivo de la administración.
//
// Para cada ruta que recibe un identificador, B la llama con los identificadores de A y se espera una
// respuesta exacta (404, 403 o el rechazo uniforme de las rutas binarias antiguas): nunca 2xx, ni un 400
// que pudiera ocultar que no se llegó a comprobar la propiedad. Después se comprueba que:
// - ningún dato ni archivo de A ha cambiado (instantánea de sus filas y de sus objetos);
// - ninguna respuesta contiene datos de A (título, email, identificador de cuenta, claves);
// - ninguna respuesta se puede guardar en una caché compartida;
// - no se ha hecho ninguna llamada de red (ningún proveedor de IA con la conexión de A).
// El control positivo (A obtiene 200 con los mismos identificadores) demuestra que el 404 de B se debe a
// la propiedad y no a un identificador mal construido. Una ruta nueva con parámetros que no figure en la
// tabla hace fallar la prueba de inventario.

let database: TestDatabase
let admin: pg.Client
let root: string
let app: FastifyInstance
let createSession: typeof import('../services/session.service.js')['createSession']
let closeDatabase: () => Promise<void>
let storage: InstanceType<typeof import('../storage/local-storage.js')['LocalStorage']>
const routes: string[] = []
const fetchCalls: unknown[] = []

const id = (prefix: string) => `c${prefix}${randomBytes(12).toString('hex')}`.slice(0, 25)
let ipCounter = 0
const nextIp = () => {
  ipCounter += 1
  return `10.77.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

const TITLE_A = 'Ático privado de la cuenta A'
const SECRET_HINT_A = 'zq9k'

interface Account {
  userId: string
  email: string
  cookie: string
}

async function account(role = 'USER'): Promise<Account> {
  const userId = id('u')
  const email = `${userId}@example.test`
  await admin.query(`INSERT INTO "User" (id, email, password, role, "updatedAt", "emailVerifiedAt") VALUES ($1, $2, $3, $4, now(), now())`, [userId, email, `hash-sintetico-${userId}`, role])
  const { token } = await createSession(userId)
  return { userId, email, cookie: `estateforge_session=${token}` }
}

async function propertyOf(userId: string, title: string) {
  const propertyId = id('p')
  await admin.query(
    `INSERT INTO "Property" (id, title, operation, type, price, address, city, neighborhood, area, bedrooms, bathrooms, condition, "commercialStatus", "additionalInformation", "userId", "updatedAt")
     VALUES ($1, $2, 'sale', 'apartment', 250000, 'Calle Ficticia 1', 'Madrid', 'Centro', 80, 2, 1, 'good', 'for-sale', '', $3, now())`,
    [propertyId, title, userId],
  )
  const generationId = id('g')
  await admin.query(
    `INSERT INTO "Generation" (id, title, description, highlights, "callToAction", provider, tone, language, "propertyId", "updatedAt")
     VALUES ($1, $2, 'Texto', '["Uno"]', 'Llama', 'mock', 'professional', 'español', $3, now())`,
    [generationId, `${title} — anuncio`, propertyId],
  )
  return { propertyId, generationId }
}

const call = (who: Account | null, method: string, url: string, options: { payload?: unknown; headers?: Record<string, string> } = {}) =>
  app.inject({
    method: method as 'GET',
    url,
    remoteAddress: nextIp(),
    headers: { ...(who && { cookie: who.cookie }), ...(options.payload !== undefined && !Buffer.isBuffer(options.payload) && { 'content-type': 'application/json' }), ...options.headers },
    ...(options.payload !== undefined && { payload: options.payload as string }),
  })

async function directUpload(who: Account, request: Record<string, unknown>, body: Buffer) {
  const prepared = await call(who, 'POST', '/api/uploads', { payload: request })
  expect(prepared.statusCode).toBe(201)
  const { attemptId, upload } = prepared.json() as { attemptId: string; upload: { url: string; headers: Record<string, string> } }
  const target = new URL(upload.url)
  expect((await app.inject({ method: 'PUT', url: target.pathname + target.search, headers: { 'content-type': upload.headers['Content-Type'] }, payload: body })).statusCode).toBe(200)
  return attemptId
}

let A: Account
let B: Account
let ownerAccount: Account
let a: { propertyId: string; generationId: string; photoId: string; trackId: string; attemptId: string; connectionId: string; jobId: string; trialId: string }
let b: { propertyId: string; generationId: string }
let bConnectionId: string

/** Filas y objetos de A, en un orden estable. Cualquier cambio en ellos hace fallar la prueba. */
async function snapshotA(): Promise<string> {
  const q = async (sql: string) => (await admin.query(sql, [A.userId])).rows
  const tables = {
    user: await q(`SELECT id, email, password, role, "adminSuspendedAt", "securityHoldAt", "updatedAt" FROM "User" WHERE id = $1`),
    sessions: await q(`SELECT count(*)::int AS n FROM "Session" WHERE "userId" = $1`),
    properties: await q(`SELECT * FROM "Property" WHERE "userId" = $1 ORDER BY id`),
    generations: await q(`SELECT g.* FROM "Generation" g JOIN "Property" p ON p.id = g."propertyId" WHERE p."userId" = $1 ORDER BY g.id`),
    photos: await q(`SELECT f.* FROM "PropertyPhoto" f JOIN "Property" p ON p.id = f."propertyId" WHERE p."userId" = $1 ORDER BY f.id`),
    media: await q(`SELECT m.* FROM "ListingMedia" m JOIN "Generation" g ON g.id = m."generationId" JOIN "Property" p ON p.id = g."propertyId" WHERE p."userId" = $1 ORDER BY m.id`),
    publications: await q(`SELECT l.* FROM "ListingPublication" l JOIN "Generation" g ON g.id = l."generationId" JOIN "Property" p ON p.id = g."propertyId" WHERE p."userId" = $1 ORDER BY l.id`),
    tracks: await q(`SELECT * FROM "AudioTrack" WHERE "userId" = $1 ORDER BY id`),
    uploads: await q(`SELECT * FROM "UploadAttempt" WHERE "userId" = $1 ORDER BY id`),
    keys: await q(`SELECT * FROM "UserAIKey" WHERE "userId" = $1 ORDER BY id`),
    jobs: await q(`SELECT * FROM "AiMediaJob" WHERE "userId" = $1 ORDER BY id`),
    trials: await q(`SELECT * FROM "AiProviderTrial" WHERE "userId" = $1 ORDER BY id`),
    preferences: await q(`SELECT * FROM "AiMediaPreference" WHERE "userId" = $1`),
  }
  return JSON.stringify({ tables, objects: await storage.list(`u/${A.userId}/`) })
}

beforeAll(async () => {
  database = await createTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'ef-isolation-'))
  vi.stubEnv('DATABASE_URL', database.url)
  vi.stubEnv('ESTATEFORGE_API_KEY_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
  // Diagnóstico temporal de MD-4 abierto una hora: también debe quedar restringido al OWNER.
  vi.stubEnv('CLIENT_IP_DIAGNOSTIC_UNTIL', new Date(Date.now() + 3_600_000).toISOString())
  vi.stubGlobal('fetch', async (...args: unknown[]) => {
    fetchCalls.push(args[0])
    throw new Error('Llamada de red no permitida en esta prueba')
  })
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  vi.resetModules()
  const { LocalStorage } = await import('../storage/local-storage.js')
  const { LocalSigner } = await import('../storage/local-signer.js')
  storage = new LocalStorage(root, { signer: new LocalSigner('http://localhost'), directTransfers: true })
  ;(await import('../storage/object-storage.js')).setStorageForTests(storage)
  createSession = (await import('../services/session.service.js')).createSession
  closeDatabase = (await import('../db/prisma.js')).closeDatabase
  // Inventario real de rutas: se anota cada una al registrarse.
  const fastify = await import('fastify')
  const original = fastify.default
  vi.doMock('fastify', () => {
    const build = (...args: unknown[]) => {
      const instance = (original as unknown as (...factory: unknown[]) => FastifyInstance)(...args)
      instance.addHook('onRoute', route => {
        for (const method of [route.method].flat()) if (method !== 'HEAD' && method !== 'OPTIONS') routes.push(`${method} ${route.url}`)
      })
      return instance
    }
    return { ...fastify, default: build, fastify: build }
  })
  app = await (await import('../app.js')).buildApp()
  await app.ready()

  A = await account()
  B = await account()
  ownerAccount = await account('OWNER')
  const ownA = await propertyOf(A.userId, TITLE_A)
  b = await propertyOf(B.userId, 'Piso de la cuenta B')
  // B tiene una conexión propia, cifrada de verdad con una clave sintética (nunca llega a ningún proveedor:
  // fetch está bloqueado), para que sus peticiones superen sus propias comprobaciones y lleguen a las de A.
  bConnectionId = await (await import('../services/user-ai-key.service.js')).createConnection(B.userId, 'openai', `sk-sintetica-${randomBytes(12).toString('hex')}`, '')
  await admin.query(`UPDATE "UserAIKey" SET status = 'verified' WHERE id = $1`, [bConnectionId])

  // Fotografía de A con miniatura, por subida directa.
  const photo = makePng(40, 30, 77)
  const photoDone = await call(A, 'POST', `/api/uploads/${await directUpload(A, { kind: 'photo', contentType: 'image/png', size: photo.length, propertyId: ownA.propertyId }, photo)}/complete`)
  expect(photoDone.statusCode).toBe(200)
  const photoId = photoDone.json().photo.id as string
  const thumb = makeJpeg(40, 30, 78)
  expect((await call(A, 'POST', `/api/uploads/${await directUpload(A, { kind: 'thumbnail', contentType: 'image/jpeg', size: thumb.length, propertyId: ownA.propertyId, photoId }, thumb)}/complete`)).statusCode).toBe(200)

  // Pista de audio de A.
  const mp3 = makeMp3(2, { seed: 79 })
  const trackDone = await call(A, 'POST', `/api/uploads/${await directUpload(A, { kind: 'audio', contentType: 'audio/mpeg', size: mp3.length, fileName: 'privada.mp3', rightsConfirmed: true }, mp3)}/complete`)
  expect(trackDone.statusCode).toBe(200)

  // Subida de A enviada y todavía sin confirmar.
  const pendingPhoto = makePng(41, 30, 80)
  const attemptId = await directUpload(A, { kind: 'photo', contentType: 'image/png', size: pendingPhoto.length, propertyId: ownA.propertyId }, pendingPhoto)

  // Cartel guardado de A (fila mínima válida con su archivo).
  const posterKey = `u/${A.userId}/g/${ownA.generationId}/poster/${crypto.randomUUID()}.png`
  await storage.put(posterKey, makePng(20, 25, 81))
  await admin.query(
    `INSERT INTO "ListingMedia" (id, "generationId", kind, "storageKey", "contentType", size, width, height, variant, "sourceHash", "photoIds", "updatedAt")
     VALUES ($1, $2, 'poster', $3, 'image/png', 100, 20, 25, 0, $4, $5, now())`,
    [id('m'), ownA.generationId, posterKey, 'a'.repeat(64), JSON.stringify([photoId])],
  )

  // Conexión de IA de A (sin clave real: nunca se descifra en esta prueba), trabajo listo y prueba real.
  const connectionId = id('k')
  await admin.query(`INSERT INTO "UserAIKey" (id, "userId", provider, "encryptedKey", "keyHint", status, "updatedAt") VALUES ($1, $2, 'openai', 'v1:sintetico', $3, 'verified', now())`, [connectionId, A.userId, SECRET_HINT_A])
  const aiKey = `u/${A.userId}/g/${ownA.generationId}/ai/${crypto.randomUUID()}.png`
  await storage.put(aiKey, makePng(20, 25, 82))
  const jobId = id('j')
  await admin.query(
    `INSERT INTO "AiMediaJob" (id, "userId", "generationId", "propertyId", kind, provider, model, status, "idempotencyKey", "sourceHash", "expectedVersion", "resultKey", "resultContentType", "resultSize", "moderationStatus", "expiresAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'poster', 'openai', 'gpt-image-1', 'ready', $5, $6, 0, $7, 'image/png', 100, 'passed', now() + interval '1 day', now())`,
    [jobId, A.userId, ownA.generationId, ownA.propertyId, id('i'), 'b'.repeat(64), aiKey],
  )
  const trialId = id('t')
  await admin.query(
    `INSERT INTO "AiProviderTrial" (id, "userId", "connectionId", provider, model, kind, status, "idempotencyKey", "contractVersion", "updatedAt")
     VALUES ($1, $2, $3, 'openai', 'gpt-4.1-mini', 'text', 'passed', $4, 'v1', now())`,
    [trialId, A.userId, connectionId, id('i')],
  )

  // Checklist de publicación guardada por A con la propia API (el mismo cuerpo se usa como intrusa).
  expect((await call(A, 'PUT', `/api/generations/${ownA.generationId}/publications`, { payload: publicationBody })).statusCode).toBe(200)

  a = { ...ownA, photoId, trackId: trackDone.json().track.id, attemptId, connectionId, jobId, trialId }
})

afterAll(async () => {
  await app?.close()
  await closeDatabase?.()
  await admin?.end()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.doUnmock('fastify')
  await database?.drop()
  rmSync(root, { recursive: true, force: true })
})

const publicationBody = { items: [{ platform: PUBLICATION_PLATFORM_IDS[0], isPublished: false, url: null }] }

type Expectation = 404 | 403 | 'bulk-zero' | 'direct-upload-required'

interface Case {
  route: string
  url: () => string
  payload?: () => unknown
  headers?: () => Record<string, string>
  expect: Expectation
  /** Control positivo: A obtiene 200 con la misma petición (solo lecturas sin efectos). */
  ownerControl?: boolean
}

const mediaHeaders = () => ({
  'content-type': 'image/png',
  'x-source-hash': 'c'.repeat(64),
  'x-expected-version': '0',
  'x-media-variant': '0',
  'x-photo-ids': a.photoId,
  'x-template-id': 'elegante',
  'x-template-selection': 'manual',
})

// En la ruta directa B usa su propia conexión, para que la petición llegue a la comprobación del anuncio de A.
const jobBody = (connectionId = bConnectionId) => ({ kind: 'poster', provider: 'openai', model: 'gpt-image-2.6-flare', connectionId, photoIds: [a.photoId], sourceHash: 'd'.repeat(64), expectedVersion: 0, idempotencyKey: 'intrusa-0000000000000001', consent: true })

// Rutas con identificador, llamadas por B con los identificadores de A.
const cases = (): Case[] => [
  { route: 'GET /api/properties/:id', url: () => `/api/properties/${a.propertyId}`, expect: 404, ownerControl: true },
  { route: 'PUT /api/properties/:id', url: () => `/api/properties/${a.propertyId}`, payload: () => ({ title: 'Cambiado por la cuenta B' }), expect: 404 },
  { route: 'DELETE /api/properties/:id', url: () => `/api/properties/${a.propertyId}`, expect: 404 },
  { route: 'DELETE /api/properties', url: () => '/api/properties', payload: () => ({ ids: [a.propertyId] }), expect: 'bulk-zero' },
  { route: 'GET /api/generations/:id', url: () => `/api/generations/${a.generationId}`, expect: 404, ownerControl: true },
  { route: 'POST /api/generations/:id/language', url: () => `/api/generations/${a.generationId}/language`, payload: () => ({ language: 'english', confirmed: true, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }), expect: 404 },
  { route: 'PUT /api/generations/:id', url: () => `/api/generations/${a.generationId}`, payload: () => ({ title: 'Cambiado por la cuenta B' }), expect: 404 },
  { route: 'DELETE /api/generations/:id', url: () => `/api/generations/${a.generationId}`, expect: 404 },
  { route: 'DELETE /api/generations', url: () => '/api/generations', payload: () => ({ ids: [a.generationId] }), expect: 'bulk-zero' },
  { route: 'POST /api/generations/from-property', url: () => '/api/generations/from-property', payload: () => ({ propertyId: a.propertyId, provider: 'mock', tone: 'professional', language: 'español' }), expect: 404 },
  { route: 'GET /api/generations/:id/publications', url: () => `/api/generations/${a.generationId}/publications`, expect: 404, ownerControl: true },
  { route: 'PUT /api/generations/:id/publications', url: () => `/api/generations/${a.generationId}/publications`, payload: () => publicationBody, expect: 404 },
  { route: 'GET /api/properties/:id/photos', url: () => `/api/properties/${a.propertyId}/photos`, expect: 404, ownerControl: true },
  { route: 'POST /api/properties/:id/photos', url: () => `/api/properties/${a.propertyId}/photos`, payload: () => makePng(10, 10, 1), headers: () => ({ 'content-type': 'image/png' }), expect: 'direct-upload-required' },
  { route: 'PUT /api/properties/:id/photos/order', url: () => `/api/properties/${a.propertyId}/photos/order`, payload: () => ({ photoIds: [a.photoId] }), expect: 404 },
  { route: 'PUT /api/properties/:id/photos/:photoId/primary', url: () => `/api/properties/${a.propertyId}/photos/${a.photoId}/primary`, expect: 404 },
  { route: 'PUT /api/properties/:id/photos/:photoId/file', url: () => `/api/properties/${a.propertyId}/photos/${a.photoId}/file`, payload: () => makePng(10, 10, 2), headers: () => ({ 'content-type': 'image/png' }), expect: 'direct-upload-required' },
  { route: 'PUT /api/properties/:id/photos/:photoId/thumbnail', url: () => `/api/properties/${a.propertyId}/photos/${a.photoId}/thumbnail`, payload: () => makeJpeg(10, 10, 3), headers: () => ({ 'content-type': 'image/jpeg' }), expect: 'direct-upload-required' },
  { route: 'DELETE /api/properties/:id/photos/:photoId', url: () => `/api/properties/${a.propertyId}/photos/${a.photoId}`, expect: 404 },
  { route: 'GET /api/properties/:id/photos/:photoId/file', url: () => `/api/properties/${a.propertyId}/photos/${a.photoId}/file?as=url`, expect: 404, ownerControl: true },
  { route: 'GET /api/generations/:id/media', url: () => `/api/generations/${a.generationId}/media`, expect: 404, ownerControl: true },
  { route: 'GET /api/generations/:id/media/source', url: () => `/api/generations/${a.generationId}/media/source`, expect: 404, ownerControl: true },
  { route: 'POST /api/generations/:id/media/poster/template-draw', url: () => `/api/generations/${a.generationId}/media/poster/template-draw`, expect: 404 },
  { route: 'PUT /api/generations/:id/media/:kind', url: () => `/api/generations/${a.generationId}/media/poster`, payload: () => makePng(10, 10, 4), headers: mediaHeaders, expect: 'direct-upload-required' },
  { route: 'GET /api/generations/:id/media/:kind/file', url: () => `/api/generations/${a.generationId}/media/poster/file?as=url`, expect: 404, ownerControl: true },
  { route: 'DELETE /api/audio-tracks/:id', url: () => `/api/audio-tracks/${a.trackId}`, expect: 404 },
  { route: 'GET /api/audio-tracks/:id/file', url: () => `/api/audio-tracks/${a.trackId}/file?as=url`, expect: 404, ownerControl: true },
  { route: 'POST /api/uploads/:id/complete', url: () => `/api/uploads/${a.attemptId}/complete`, expect: 404 },
  { route: 'DELETE /api/uploads/:id', url: () => `/api/uploads/${a.attemptId}`, expect: 404 },
  { route: 'GET /api/generations/:id/ai-jobs', url: () => `/api/generations/${a.generationId}/ai-jobs`, expect: 404, ownerControl: true },
  { route: 'POST /api/generations/:id/ai-jobs', url: () => `/api/generations/${a.generationId}/ai-jobs`, payload: jobBody, expect: 404 },
  { route: 'GET /api/ai-jobs/:id', url: () => `/api/ai-jobs/${a.jobId}`, expect: 404, ownerControl: true },
  { route: 'GET /api/ai-jobs/:id/result', url: () => `/api/ai-jobs/${a.jobId}/result`, expect: 404, ownerControl: true },
  { route: 'POST /api/ai-jobs/:id/cancel', url: () => `/api/ai-jobs/${a.jobId}/cancel`, expect: 404 },
  { route: 'POST /api/ai-jobs/:id/reject', url: () => `/api/ai-jobs/${a.jobId}/reject`, expect: 404 },
  { route: 'PUT /api/account/ai-connections/:id', url: () => `/api/account/ai-connections/${a.connectionId}`, payload: () => ({ label: 'robada' }), expect: 404 },
  { route: 'DELETE /api/account/ai-connections/:id', url: () => `/api/account/ai-connections/${a.connectionId}`, expect: 404 },
  { route: 'POST /api/account/ai-connections/:id/verify', url: () => `/api/account/ai-connections/${a.connectionId}/verify`, payload: () => ({}), expect: 404 },
  { route: 'GET /api/account/ai-connections/:id/models', url: () => `/api/account/ai-connections/${a.connectionId}/models`, expect: 404 },
  { route: 'GET /api/account/ai-trials/:id', url: () => `/api/account/ai-trials/${a.trialId}`, expect: 404, ownerControl: true },
  { route: 'POST /api/account/ai-trials/:id/cancel', url: () => `/api/account/ai-trials/${a.trialId}/cancel`, expect: 404 },
  // Administración: B tiene rol USER; la comprobación de rol ocurre antes de leer nada.
  { route: 'GET /api/admin/users/:id', url: () => `/api/admin/users/${A.userId}`, expect: 403 },
  { route: 'POST /api/admin/users/:id/suspend', url: () => `/api/admin/users/${A.userId}/suspend`, payload: () => ({ reason: 'Prueba de aislamiento' }), expect: 403 },
  { route: 'POST /api/admin/users/:id/unsuspend', url: () => `/api/admin/users/${A.userId}/unsuspend`, payload: () => ({}), expect: 403 },
  { route: 'POST /api/admin/users/:id/resolve-security-hold', url: () => `/api/admin/users/${A.userId}/resolve-security-hold`, payload: () => ({}), expect: 403 },
  { route: 'POST /api/admin/users/:id/recovery-destination', url: () => `/api/admin/users/${A.userId}/recovery-destination`, payload: () => ({}), expect: 403 },
  { route: 'POST /api/admin/users/:id/resend-recovery', url: () => `/api/admin/users/${A.userId}/resend-recovery`, payload: () => ({}), expect: 403 },
  { route: 'POST /api/admin/users/:id/revoke-sessions', url: () => `/api/admin/users/${A.userId}/revoke-sessions`, payload: () => ({}), expect: 403 },
  { route: 'GET /api/admin/overview', url: () => '/api/admin/overview', expect: 403 },
  { route: 'GET /api/admin/users', url: () => '/api/admin/users', expect: 403 },
  { route: 'GET /api/admin/audit', url: () => '/api/admin/audit', expect: 403 },
  { route: 'GET /api/admin/diagnostics/client-ip', url: () => '/api/admin/diagnostics/client-ip', expect: 403 },
]

// Referencias indirectas: un recurso propio de B combinado con un identificador de A en la ruta o en el
// cuerpo. Deben fallar sin usar el recurso de A y responder exactamente igual que con un identificador
// que no existe (sin enumeración): cada caso se repite con identificadores inventados.
interface Refs {
  photoId: string
  propertyId: string
  generationId: string
  connectionId: string
}
const crossCases = (): { label: string; method: string; url: (r: Refs) => string; payload?: (r: Refs) => unknown; expect: number }[] => [
  { label: 'fotografía de A leída a través de un inmueble de B', method: 'GET', url: r => `/api/properties/${b.propertyId}/photos/${r.photoId}/file?as=url`, expect: 404 },
  { label: 'miniatura de A a través de un inmueble de B', method: 'GET', url: r => `/api/properties/${b.propertyId}/photos/${r.photoId}/file?as=url&size=thumb`, expect: 404 },
  { label: 'borrar la fotografía de A a través de un inmueble de B', method: 'DELETE', url: r => `/api/properties/${b.propertyId}/photos/${r.photoId}`, expect: 404 },
  { label: 'marcar como principal la fotografía de A en un inmueble de B', method: 'PUT', url: r => `/api/properties/${b.propertyId}/photos/${r.photoId}/primary`, expect: 404 },
  { label: 'reordenar un inmueble de B con la fotografía de A', method: 'PUT', url: () => `/api/properties/${b.propertyId}/photos/order`, payload: r => ({ photoIds: [r.photoId] }), expect: 400 },
  { label: 'preparar una subida en el inmueble de A', method: 'POST', url: () => '/api/uploads', payload: r => ({ kind: 'photo', contentType: 'image/png', size: 100, propertyId: r.propertyId }), expect: 404 },
  { label: 'sustituir la fotografía de A a través de un inmueble de B', method: 'POST', url: () => '/api/uploads', payload: r => ({ kind: 'photo-replace', contentType: 'image/png', size: 100, propertyId: b.propertyId, photoId: r.photoId }), expect: 404 },
  { label: 'miniatura para la fotografía de A a través de un inmueble de B', method: 'POST', url: () => '/api/uploads', payload: r => ({ kind: 'thumbnail', contentType: 'image/jpeg', size: 100, propertyId: b.propertyId, photoId: r.photoId }), expect: 404 },
  { label: 'cartel en el anuncio de A', method: 'POST', url: () => '/api/uploads', payload: r => ({ kind: 'poster', contentType: 'image/png', size: 100, generationId: r.generationId, media: { sourceHash: 'e'.repeat(64), expectedVersion: 0, variant: 0, photoIds: [r.photoId], poster: { templateId: 'elegante', selection: 'manual', drawId: null } } }), expect: 404 },
  // La conexión se busca solo entre las de la cuenta: la de A no existe para B (409 «ya no existe»).
  { label: 'trabajo de IA en un anuncio de B con la conexión de A', method: 'POST', url: () => `/api/generations/${b.generationId}/ai-jobs`, payload: r => ({ ...jobBody(r.connectionId), photoIds: [], idempotencyKey: 'intrusa-0000000000000002' }), expect: 409 },
  { label: 'preferencias de B que apuntan a la conexión de A', method: 'PUT', url: () => '/api/account/ai-preferences', payload: r => ({ poster: { provider: 'openai', model: 'gpt-image-2.6-flare', connectionId: r.connectionId }, video: null }), expect: 409 },
  { label: 'plan de prueba real con la conexión de A', method: 'POST', url: () => '/api/account/ai-trials/plan', payload: r => ({ connectionId: r.connectionId, kind: 'text', model: 'gpt-6-luna' }), expect: 409 },
  {
    label: 'prueba real con la conexión de A',
    method: 'POST',
    url: () => '/api/account/ai-trials',
    payload: r => ({ connectionId: r.connectionId, kind: 'text', model: 'gpt-6-luna', idempotencyKey: 'intrusa-0000000000000003', confirmation: { provider: 'openai', model: 'gpt-6-luna', connectionId: r.connectionId, estimatedCostMicroUsd: 0, acceptCharges: true } }),
    expect: 409,
  },
]

const leaks = (body: string) => [A.userId, A.email, TITLE_A, `hash-sintetico-${A.userId}`, SECRET_HINT_A, 'v1:sintetico', `u/${A.userId}`].filter(marker => body.includes(marker))

function assertPrivate(response: LightMyRequestResponse) {
  const cache = String(response.headers['cache-control'] ?? '')
  expect(cache, 'Cache-Control').toMatch(/no-store|private/)
  expect(cache).not.toMatch(/public|s-maxage/)
}

describe('aislamiento entre cuentas: todas las rutas con identificador', () => {
  it('el inventario de rutas con parámetros está cubierto (una ruta nueva sin caso hace fallar esta prueba)', () => {
    const covered = new Set([...cases().map(item => item.route), 'GET /api/account/ai-trials/presets'])
    const withParams = [...new Set(routes)].filter(route => route.includes(':') || route.startsWith('DELETE /api/properties') || route.startsWith('DELETE /api/generations') || route.includes('/api/admin/'))
    // Rutas con parámetro que no son de una cuenta: tokens de un solo uso del incidente (no hay recurso ajeno
    // al que apuntar) y la conexión principal por proveedor, que se resuelve siempre con la sesión propia.
    const notAccountResources = new Set(['GET /api/auth/security-incident/:token', 'POST /api/auth/security-incident/:token', 'PUT /api/account/ai-keys/:provider', 'DELETE /api/account/ai-keys/:provider', 'POST /api/account/ai-keys/:provider/verify'])
    const missing = withParams.filter(route => !covered.has(route) && !notAccountResources.has(route))
    expect(missing).toEqual([])
    expect(routes.length).toBeGreaterThan(60)
  })

  it('la cuenta B recibe exactamente el rechazo esperado y no altera ni ve nada de A', async () => {
    const before = await snapshotA()
    const report: string[] = []
    for (const item of cases()) {
      const [method] = item.route.split(' ')
      const response = await call(B, method, item.url(), { ...(item.payload && { payload: item.payload() }), ...(item.headers && { headers: item.headers() }) })
      const body = response.body
      report.push(`${item.route} → ${response.statusCode}`)
      assertPrivate(response)
      expect(leaks(body), `${item.route}: datos de A en la respuesta`).toEqual([])
      if (item.expect === 'bulk-zero') {
        expect(response.statusCode, item.route).toBe(200)
        expect(response.json()).toMatchObject({ deletedCount: 0 })
      } else if (item.expect === 'direct-upload-required') {
        // Con transferencias directas estas rutas binarias rechazan cualquier petición igual, sin leer nada.
        expect(response.statusCode, item.route).toBe(409)
        expect(response.json()).toMatchObject({ code: 'DIRECT_UPLOAD_REQUIRED' })
      } else {
        expect(response.statusCode, `${item.route} (${body.slice(0, 160)})`).toBe(item.expect)
      }
      expect(response.headers.location, `${item.route}: redirección a un archivo`).toBeUndefined()
    }
    expect(await snapshotA()).toBe(before)
    expect(fetchCalls).toEqual([])
    expect(report).toHaveLength(cases().length)
  })

  it('referencias indirectas (recurso propio + identificador ajeno) fallan sin usar nada de A', async () => {
    const before = await snapshotA()
    const invented: Refs = { photoId: id('x'), propertyId: id('x'), generationId: id('x'), connectionId: id('x') }
    for (const item of crossCases()) {
      const send = (refs: Refs) => call(B, item.method, item.url(refs), item.payload ? { payload: item.payload(refs) } : {})
      const response = await send(a)
      assertPrivate(response)
      expect(response.statusCode, `${item.label} (${response.body.slice(0, 160)})`).toBe(item.expect)
      expect(leaks(response.body), item.label).toEqual([])
      // Igual que con un identificador inexistente: no revela que el recurso de A existe.
      const control = await send(invented)
      expect({ status: control.statusCode, body: control.json() }, `${item.label}: distinto de un identificador inexistente`).toEqual({ status: response.statusCode, body: response.json() })
    }
    expect(await snapshotA()).toBe(before)
    expect(fetchCalls).toEqual([])
    // B no ha creado nada que apunte a recursos de A.
    const refs = (await admin.query(
      `SELECT (SELECT count(*) FROM "UploadAttempt" WHERE "userId" = $1 AND ("propertyId" = $2 OR "photoId" = $3 OR "generationId" = $4))::int AS uploads,
              (SELECT count(*) FROM "AiMediaJob" WHERE "userId" = $1)::int AS jobs,
              (SELECT count(*) FROM "AiProviderTrial" WHERE "userId" = $1)::int AS trials,
              (SELECT count(*) FROM "AiMediaPreference" WHERE "userId" = $1 AND ("posterKeyId" = $5 OR "videoKeyId" = $5 OR "textKeyId" = $5 OR "moderationKeyId" = $5))::int AS preferences`,
      [B.userId, a.propertyId, a.photoId, a.generationId, a.connectionId],
    )).rows[0]
    expect(refs).toEqual({ uploads: 0, jobs: 0, trials: 0, preferences: 0 })
  })

  it('control positivo: A obtiene 200 en las mismas lecturas, así que el 404 de B se debe a la propiedad', async () => {
    for (const item of cases().filter(entry => entry.ownerControl)) {
      const response = await call(A, item.route.split(' ')[0], item.url())
      expect(response.statusCode, `${item.route} como titular (${response.body.slice(0, 160)})`).toBe(200)
      assertPrivate(response)
    }
  })

  it('los listados de B no contienen nada de A', async () => {
    const ids = () => [a.propertyId, a.generationId, a.photoId, a.trackId, a.attemptId, a.connectionId, a.jobId, a.trialId]
    for (const url of ['/api/properties', '/api/generations', '/api/dashboard/stats', '/api/audio-tracks', '/api/account/ai-keys', '/api/account/ai-integrations', '/api/account/ai-trials', '/api/auth/me']) {
      const response = await call(B, 'GET', url)
      expect(response.statusCode, url).toBe(200)
      assertPrivate(response)
      expect(leaks(response.body), url).toEqual([])
      expect(ids().filter(value => response.body.includes(value)), url).toEqual([])
    }
  })

  it('sin sesión: 401 en todas las rutas con identificador, sin datos', async () => {
    for (const item of cases()) {
      const [method] = item.route.split(' ')
      const response = await call(null, method, item.url(), { ...(item.payload && { payload: item.payload() }), ...(item.headers && { headers: item.headers() }) })
      if (item.expect === 'direct-upload-required') expect([401, 409]).toContain(response.statusCode)
      else expect(response.statusCode, item.route).toBe(401)
      expect(leaks(response.body)).toEqual([])
    }
  })

  it('administración: el OWNER ve la ficha de A sin contraseña ni secretos; un OWNER con incidente abierto, no', async () => {
    const detail = await call(ownerAccount, 'GET', `/api/admin/users/${A.userId}`)
    expect(detail.statusCode).toBe(200)
    assertPrivate(detail)
    expect(detail.body).not.toContain(`hash-sintetico-${A.userId}`)
    expect(detail.body).not.toMatch(/"password"|encryptedKey|v1:sintetico|estateforge_session/)
    // El diagnóstico temporal de la IP solo responde al OWNER, con datos de su propia petición.
    const diagnostic = await call(ownerAccount, 'GET', '/api/admin/diagnostics/client-ip')
    expect(diagnostic.statusCode).toBe(200)
    expect(diagnostic.headers['cache-control']).toBe('no-store')
    expect(leaks(diagnostic.body)).toEqual([])
    const held = await account('OWNER')
    await admin.query(`UPDATE "User" SET "securityHoldAt" = now() WHERE id = $1`, [held.userId])
    expect([401, 403]).toContain((await call(held, 'GET', `/api/admin/users/${A.userId}`)).statusCode)
    expect([401, 403]).toContain((await call(held, 'GET', '/api/admin/diagnostics/client-ip')).statusCode)
  })
})
