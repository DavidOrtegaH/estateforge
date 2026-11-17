import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { makeJpeg, makePng, uniqueSeed } from '../test-support/images.js'
import { makeMp3, makeVideo, makeWav } from '../test-support/media-files.js'
import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Subidas y descargas directas (DA-58) contra PostgreSQL real y la aplicación completa, con el
// simulador local de Blob en modo de transferencias directas (STORAGE_LOCAL_SIGNED_URLS=1): las URLs
// firmadas apuntan a /api/local-blob/…, que hace el papel de Vercel Blob. Ninguna prueba usa el
// servicio real de Vercel (no autorizado): el adaptador de Blob se prueba con el SDK simulado aparte.

let database: TestDatabase
let admin: pg.Client
let root: string
let app: FastifyInstance
let mods: {
  buildApp: typeof import('../app.js')['buildApp']
  createSession: typeof import('../services/session.service.js')['createSession']
  storage: InstanceType<typeof import('../storage/local-storage.js')['LocalStorage']>
  expireUploads: typeof import('../media/upload.service.js')['expireUploads']
  closeDatabase: () => Promise<void>
}

const id = (prefix: string) => `c${prefix}${randomBytes(10).toString('hex')}`.slice(0, 25)
const ipFor = (cookie: string) => {
  let h = 0
  for (const ch of cookie) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `10.${(h >> 16) & 255}.${(h >> 8) & 255}.${h & 255}`
}

async function account() {
  const userId = id('u')
  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt", "emailVerifiedAt") VALUES ($1, $2, 'x', now(), now())`, [userId, `${userId}@example.test`])
  const { token } = await mods.createSession(userId)
  return { userId, cookie: `estateforge_session=${token}` }
}

async function property(userId: string) {
  const propertyId = id('p')
  await admin.query(
    `INSERT INTO "Property" (id, title, operation, type, price, address, city, neighborhood, area, bedrooms, bathrooms, condition, "commercialStatus", "additionalInformation", "userId", "updatedAt")
     VALUES ($1, 'Piso luminoso', 'sale', 'apartment', 250000, 'Calle Privada 7', 'Madrid', 'Chamberí', 92, 3, 2, 'good', 'for-sale', '', $2, now())`,
    [propertyId, userId],
  )
  const generationId = id('g')
  await admin.query(
    `INSERT INTO "Generation" (id, title, description, highlights, "callToAction", provider, tone, language, "propertyId", "updatedAt")
     VALUES ($1, 'Vive en Chamberí', 'Piso exterior', '["Exterior"]', 'Pide visita', 'mock', 'professional', 'español', $2, now())`,
    [generationId, propertyId],
  )
  return { propertyId, generationId }
}

const objects = async () => (await mods.storage.list('u/')).length
const pathOf = (url: string) => {
  const parsed = new URL(url)
  return parsed.pathname + parsed.search
}

interface Prepared {
  attemptId: string
  expiresAt: string
  upload: { method: 'PUT'; url: string; headers: Record<string, string> }
}

async function prepare(cookie: string, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/uploads', remoteAddress: ipFor(cookie), headers: { cookie, 'content-type': 'application/json' }, payload: body })
}

const transfer = (prepared: Prepared, body: Buffer, type?: string) =>
  app.inject({ method: 'PUT', url: pathOf(prepared.upload.url), headers: { 'content-type': type ?? prepared.upload.headers['Content-Type'] }, payload: body })

const complete = (cookie: string, attemptId: string) => app.inject({ method: 'POST', url: `/api/uploads/${attemptId}/complete`, remoteAddress: ipFor(cookie), headers: { cookie } })

/** Flujo completo: preparar, enviar a la URL firmada y confirmar. */
async function directUpload(cookie: string, request: Record<string, unknown>, body: Buffer): Promise<{ prepared: LightMyRequestResponse; put?: LightMyRequestResponse; done?: LightMyRequestResponse }> {
  const prepared = await prepare(cookie, request)
  if (prepared.statusCode !== 201) return { prepared }
  const put = await transfer(prepared.json(), body)
  if (put.statusCode !== 200) return { prepared, put }
  return { prepared, put, done: await complete(cookie, prepared.json().attemptId) }
}

const photoRequest = (propertyId: string, body: Buffer, type = 'image/png') => ({ kind: 'photo', contentType: type, size: body.length, fileName: 'salón.png', propertyId })

beforeAll(async () => {
  database = await createTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'ef-uploads-'))
  vi.stubEnv('DATABASE_URL', database.url)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  vi.resetModules()
  const { LocalStorage } = await import('../storage/local-storage.js')
  const { LocalSigner } = await import('../storage/local-signer.js')
  const storage = new LocalStorage(root, { signer: new LocalSigner('http://localhost'), directTransfers: true })
  ;(await import('../storage/object-storage.js')).setStorageForTests(storage)
  mods = {
    buildApp: (await import('../app.js')).buildApp,
    createSession: (await import('../services/session.service.js')).createSession,
    storage,
    expireUploads: (await import('../media/upload.service.js')).expireUploads,
    closeDatabase: (await import('../db/prisma.js')).closeDatabase,
  }
  app = await mods.buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await mods.closeDatabase()
  await admin.end()
  vi.unstubAllEnvs()
  await database.drop()
  rmSync(root, { recursive: true, force: true })
})

describe('subida directa de fotografías', () => {
  it('preparar (JSON pequeño), enviar a la URL firmada y confirmar: la fotografía queda asociada y el intento completado', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const image = makePng(120, 90, 7)
    const request = photoRequest(propertyId, image)
    expect(JSON.stringify(request).length).toBeLessThan(400)
    const prepared = await prepare(owner.cookie, request)
    expect(prepared.statusCode).toBe(201)
    expect(prepared.headers['cache-control']).toBe('private, no-store')
    const body = prepared.json() as Prepared
    expect(body.upload.method).toBe('PUT')
    expect(body.upload.url).toMatch(/\/api\/local-blob\/u\/[a-z0-9]+\/p\/[a-z0-9]+\/photos\/[0-9a-f-]{36}\.png\?op=put&/)
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    // La API no ha recibido ningún archivo: solo existe el intento.
    expect(await objects()).toBe(0)
    expect((await transfer(body, image)).statusCode).toBe(200)
    const done = await complete(owner.cookie, body.attemptId)
    expect(done.statusCode).toBe(200)
    expect(done.json()).toMatchObject({ kind: 'photo', photo: { position: 0, isPrimary: true, contentType: 'image/png', width: 120, height: 90, originalName: 'salón.png' } })
    expect(JSON.stringify(done.json())).not.toMatch(/storageKey|local-blob/)
    const attempt = (await admin.query(`SELECT status, "resultId" FROM "UploadAttempt" WHERE id = $1`, [body.attemptId])).rows[0]
    expect(attempt).toEqual({ status: 'completed', resultId: done.json().photo.id })
  })

  it('confirmar dos veces devuelve la misma fotografía (idempotente) y no duplica nada', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const { prepared, done } = await directUpload(owner.cookie, photoRequest(propertyId, makePng(60, 40, 8)), makePng(60, 40, 8))
    const again = await complete(owner.cookie, prepared.json().attemptId)
    expect(again.statusCode).toBe(200)
    expect(again.json().photo.id).toBe(done!.json().photo.id)
    expect((await admin.query(`SELECT count(*)::int AS n FROM "PropertyPhoto" WHERE "propertyId" = $1`, [propertyId])).rows[0].n).toBe(1)
  })

  it.each([
    ['tipo no permitido', { contentType: 'image/gif' }, 415],
    ['tamaño superior al permitido', { size: 4 * 1024 * 1024 + 1 }, 413],
    ['tamaño cero', { size: 0 }, 400],
    ['ruta enviada por el navegador', { pathname: 'u/otro/p/x/photos/00000000-0000-0000-0000-000000000000.png' }, 400],
    ['clave de almacenamiento enviada por el navegador', { storageKey: 'u/x' }, 400],
    ['tipo de subida desconocido', { kind: 'backup' }, 400],
  ])('preparar rechaza: %s', async (_label, patch, status) => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const response = await prepare(owner.cookie, { ...photoRequest(propertyId, makePng()), ...patch })
    expect(response.statusCode).toBe(status)
    expect((await admin.query(`SELECT count(*)::int AS n FROM "UploadAttempt" WHERE "userId" = $1`, [owner.userId])).rows[0].n).toBe(0)
  })

  it('sin sesión 401; inmueble o fotografía de otra cuenta 404; confirmar o cancelar un intento ajeno 404', async () => {
    const owner = await account()
    const intruder = await account()
    const { propertyId } = await property(owner.userId)
    expect((await app.inject({ method: 'POST', url: '/api/uploads', headers: { 'content-type': 'application/json' }, payload: photoRequest(propertyId, makePng()) })).statusCode).toBe(401)
    expect((await prepare(intruder.cookie, photoRequest(propertyId, makePng()))).statusCode).toBe(404)
    const { done } = await directUpload(owner.cookie, photoRequest(propertyId, makePng(30, 20, 1)), makePng(30, 20, 1))
    const photoId = done!.json().photo.id
    const other = await property(intruder.userId)
    // Fotografía de un inmueble ajeno a través de un inmueble propio.
    expect((await prepare(intruder.cookie, { kind: 'photo-replace', contentType: 'image/png', size: 10, propertyId: other.propertyId, photoId })).statusCode).toBe(404)
    const pending = (await prepare(owner.cookie, photoRequest(propertyId, makePng(31, 20, 2)))).json() as Prepared
    expect((await complete(intruder.cookie, pending.attemptId)).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/uploads/${pending.attemptId}`, headers: { cookie: intruder.cookie } })).statusCode).toBe(404)
  })

  it('la URL firmada solo sirve para su clave, su tipo, su tamaño y su plazo; nunca sobrescribe', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const image = makePng(50, 50, 3)
    const prepared = (await prepare(owner.cookie, photoRequest(propertyId, image))).json() as Prepared
    const url = new URL(prepared.upload.url)
    // Otra clave con la misma firma.
    const otherKey = url.pathname.replace(/[0-9a-f-]{36}\.png$/, '00000000-0000-4000-8000-000000000000.png')
    expect((await app.inject({ method: 'PUT', url: otherKey + url.search, headers: { 'content-type': 'image/png' }, payload: image })).statusCode).toBe(403)
    // Otro tipo, más bytes de los autorizados.
    expect((await transfer(prepared, image, 'image/jpeg')).statusCode).toBe(400)
    expect((await transfer(prepared, Buffer.concat([image, Buffer.alloc(10)]))).statusCode).toBe(413)
    // La URL de PUT no sirve para leer.
    expect((await app.inject({ method: 'GET', url: pathOf(prepared.upload.url) })).statusCode).toBe(403)
    // Caducada (misma clave, firmada con fecha pasada).
    const key = url.pathname.replace('/api/local-blob/', '')
    const expired = mods.storage.signer!.sign({ op: 'put', key, exp: Date.now() - 1, ct: 'image/png', max: image.length })
    expect((await app.inject({ method: 'PUT', url: pathOf(expired), headers: { 'content-type': 'image/png' }, payload: image })).json()).toMatchObject({ code: 'EXPIRED' })
    expect((await transfer(prepared, image)).statusCode).toBe(200)
    expect((await transfer(prepared, image)).statusCode).toBe(409)
  })

  it('confirmar antes de subir: 409 y el intento sigue pendiente; después funciona', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const image = makePng(44, 33, 4)
    const prepared = (await prepare(owner.cookie, photoRequest(propertyId, image))).json() as Prepared
    expect((await complete(owner.cookie, prepared.attemptId)).json()).toMatchObject({ code: 'UPLOAD_MISSING' })
    expect((await admin.query(`SELECT status FROM "UploadAttempt" WHERE id = $1`, [prepared.attemptId])).rows[0].status).toBe('pending')
    await transfer(prepared, image)
    expect((await complete(owner.cookie, prepared.attemptId)).statusCode).toBe(200)
  })

  it.each([
    ['contenido que no es una imagen', Buffer.from('<?php echo 1; ?> no es una imagen'), 'INVALID_FILE'],
    ['PNG declarado como JPEG', makePng(40, 40, 9), 'TYPE_MISMATCH'],
  ])('archivo subido no válido (%s): el intento falla, el archivo se borra y la reserva se libera', async (_label, body, code) => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const prepared = (await prepare(owner.cookie, { kind: 'photo', contentType: 'image/jpeg', size: body.length, propertyId })).json() as Prepared
    await transfer(prepared, body)
    expect(await objects()).toBeGreaterThan(0)
    const before = await objects()
    const done = await complete(owner.cookie, prepared.attemptId)
    expect(done.json()).toMatchObject({ code })
    expect((await admin.query(`SELECT status, failure FROM "UploadAttempt" WHERE id = $1`, [prepared.attemptId])).rows[0]).toEqual({ status: 'failed', failure: code })
    expect(await objects()).toBe(before - 1)
    expect((await admin.query(`SELECT count(*)::int AS n FROM "PropertyPhoto" WHERE "propertyId" = $1`, [propertyId])).rows[0].n).toBe(0)
    // Repetir la confirmación de un intento fallido no lo reabre.
    expect((await complete(owner.cookie, prepared.attemptId)).json()).toMatchObject({ code: 'UPLOAD_CLOSED' })
  })

  it('tamaño subido distinto del declarado: se rechaza', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const image = makePng(40, 40, 10)
    const prepared = (await prepare(owner.cookie, { ...photoRequest(propertyId, image), size: image.length + 100 })).json() as Prepared
    await transfer(prepared, image)
    expect((await complete(owner.cookie, prepared.attemptId)).json()).toMatchObject({ code: 'INVALID_FILE' })
  })

  it('cancelar: el intento deja de reservar, su archivo se borra y ya no se puede confirmar', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const image = makePng(40, 40, 11)
    const prepared = (await prepare(owner.cookie, photoRequest(propertyId, image))).json() as Prepared
    await transfer(prepared, image)
    const before = await objects()
    expect((await app.inject({ method: 'DELETE', url: `/api/uploads/${prepared.attemptId}`, remoteAddress: ipFor(owner.cookie), headers: { cookie: owner.cookie } })).statusCode).toBe(204)
    expect(await objects()).toBe(before - 1)
    expect((await complete(owner.cookie, prepared.attemptId)).json()).toMatchObject({ code: 'UPLOAD_CLOSED' })
  })

  it('caducidad: un intento vencido no reserva, no se confirma (410) y su archivo se limpia', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const image = makePng(40, 40, 12)
    const prepared = (await prepare(owner.cookie, photoRequest(propertyId, image))).json() as Prepared
    await transfer(prepared, image)
    await admin.query(`UPDATE "UploadAttempt" SET "expiresAt" = now() - interval '1 second' WHERE id = $1`, [prepared.attemptId])
    const before = await objects()
    expect((await complete(owner.cookie, prepared.attemptId)).statusCode).toBe(410)
    expect((await admin.query(`SELECT status FROM "UploadAttempt" WHERE id = $1`, [prepared.attemptId])).rows[0].status).toBe('expired')
    expect(await objects()).toBe(before - 1)
    // La tarea de mantenimiento es idempotente.
    expect(await mods.expireUploads(null)).toBe(0)
  })

  it('reserva de cuota: las subidas pendientes cuentan; al cancelar se libera', async () => {
    const previous = process.env.STORAGE_USER_QUOTA_MB
    process.env.STORAGE_USER_QUOTA_MB = '10'
    try {
      const owner = await account()
      const { propertyId } = await property(owner.userId)
      const big = 3_500_000
      const a = await prepare(owner.cookie, { kind: 'photo', contentType: 'image/png', size: big, propertyId })
      const b = await prepare(owner.cookie, { kind: 'photo', contentType: 'image/png', size: big, propertyId })
      expect([a.statusCode, b.statusCode]).toEqual([201, 201])
      const c = await prepare(owner.cookie, { kind: 'photo', contentType: 'image/png', size: big, propertyId })
      expect(c.json()).toMatchObject({ code: 'QUOTA_EXCEEDED' })
      await app.inject({ method: 'DELETE', url: `/api/uploads/${a.json().attemptId}`, headers: { cookie: owner.cookie } })
      expect((await prepare(owner.cookie, { kind: 'photo', contentType: 'image/png', size: big, propertyId })).statusCode).toBe(201)
      // La cuota de un usuario no afecta a otro.
      const other = await account()
      const otherProperty = await property(other.userId)
      expect((await prepare(other.cookie, { kind: 'photo', contentType: 'image/png', size: big, propertyId: otherProperty.propertyId })).statusCode).toBe(201)
    } finally {
      if (previous === undefined) delete process.env.STORAGE_USER_QUOTA_MB
      else process.env.STORAGE_USER_QUOTA_MB = previous
    }
  })

  it('60 preparaciones simultáneas para un inmueble vacío: como mucho 50 reservas; la 51.ª, rechazada', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const results = await Promise.all(Array.from({ length: 60 }, () => prepare(owner.cookie, { kind: 'photo', contentType: 'image/png', size: 1000, propertyId })))
    expect(results.filter(r => r.statusCode === 201)).toHaveLength(50)
    expect(results.filter(r => r.statusCode !== 201).every(r => r.json().code === 'LIMIT_REACHED')).toBe(true)
  })

  it('50 fotografías por subida directa; la 51.ª se rechaza al preparar', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    for (let i = 0; i < 50; i += 1) {
      const image = makePng(20, 20, 7000 + i)
      const { done } = await directUpload(owner.cookie, photoRequest(propertyId, image), image)
      expect(done?.statusCode).toBe(200)
    }
    const positions = (await admin.query(`SELECT position FROM "PropertyPhoto" WHERE "propertyId" = $1 ORDER BY position`, [propertyId])).rows.map(row => row.position)
    expect(positions).toEqual([...Array(50).keys()])
    expect((await prepare(owner.cookie, photoRequest(propertyId, makePng(20, 20, 9999)))).json()).toMatchObject({ code: 'LIMIT_REACHED' })
  })

  it('miniatura y sustitución por subida directa', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const { done } = await directUpload(owner.cookie, photoRequest(propertyId, makePng(80, 60, 13)), makePng(80, 60, 13))
    const photoId = done!.json().photo.id
    const thumb = makeJpeg(480, 360, 5)
    const t = await directUpload(owner.cookie, { kind: 'thumbnail', contentType: 'image/jpeg', size: thumb.length, propertyId, photoId }, thumb)
    expect(t.done!.json().photo.thumbUrl).toContain('size=thumb')
    const replacement = makeJpeg(640, 480, 6)
    const r = await directUpload(owner.cookie, { kind: 'photo-replace', contentType: 'image/jpeg', size: replacement.length, propertyId, photoId }, replacement)
    expect(r.done!.json().photo).toMatchObject({ id: photoId, contentType: 'image/jpeg', width: 640, thumbUrl: null })
  })

  it('con transferencias directas, la API no acepta archivos en sus rutas antiguas', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const response = await app.inject({ method: 'POST', url: `/api/properties/${propertyId}/photos`, headers: { cookie: owner.cookie, 'content-type': 'image/png' }, payload: makePng() })
    expect(response.json()).toMatchObject({ code: 'DIRECT_UPLOAD_REQUIRED' })
  })
})

describe('subida directa de audio, carteles y vídeos', () => {
  it('pista de audio: se sube y se valida; con tipo falsificado o sin declarar derechos, no', async () => {
    const owner = await account()
    const wav = makeWav(2)
    const ok = await directUpload(owner.cookie, { kind: 'audio', contentType: 'audio/x-wav', size: wav.length, fileName: 'sintonía.wav', rightsConfirmed: true }, wav)
    expect(ok.done!.json()).toMatchObject({ kind: 'audio', track: { name: 'sintonía', format: 'wav' } })
    expect((await prepare(owner.cookie, { kind: 'audio', contentType: 'audio/wav', size: wav.length })).json()).toMatchObject({ code: 'INVALID_REQUEST' })
    const fake = await directUpload(owner.cookie, { kind: 'audio', contentType: 'audio/mpeg', size: wav.length + 1, rightsConfirmed: true }, Buffer.concat([wav, Buffer.alloc(1)]))
    expect(fake.done!.json()).toMatchObject({ code: 'TYPE_MISMATCH' })
    const mp3 = makeMp3(2)
    expect((await directUpload(owner.cookie, { kind: 'audio', contentType: 'audio/flac', size: mp3.length, rightsConfirmed: true }, mp3)).prepared.statusCode).toBe(415)
  })

  async function setup(photos = 2) {
    const owner = await account()
    const ids = await property(owner.userId)
    for (let i = 0; i < photos; i += 1) {
      const image = makePng(40, 30, uniqueSeed())
      await directUpload(owner.cookie, photoRequest(ids.propertyId, image), image)
    }
    const source = (await app.inject({ url: `/api/generations/${ids.generationId}/media/source`, headers: { cookie: owner.cookie } })).json() as { sourceHash: string; photos: { id: string; isPrimary: boolean }[] }
    return { ...owner, ...ids, source }
  }

  it('cartel: preparación con sus metadatos, subida directa y confirmación; si cambian los datos, se conserva el anterior', async () => {
    const owner = await setup(1)
    const poster = makePng(1080, 1350, 1)
    const media = { sourceHash: owner.source.sourceHash, expectedVersion: 0, variant: 1, photoIds: [owner.source.photos[0].id], poster: { templateId: 'premium', selection: 'manual', drawId: null } }
    const first = await directUpload(owner.cookie, { kind: 'poster', contentType: 'image/png', size: poster.length, generationId: owner.generationId, media }, poster)
    expect(first.done!.json()).toMatchObject({ kind: 'poster', media: { version: 1, templateId: 'premium' } })
    // Versión obsoleta: se rechaza ya al preparar.
    expect((await prepare(owner.cookie, { kind: 'poster', contentType: 'image/png', size: poster.length, generationId: owner.generationId, media })).json()).toMatchObject({ code: 'VERSION_CONFLICT' })
    // Cambian los datos entre preparar y confirmar.
    const second = makePng(1080, 1350, 2)
    const prepared = (await prepare(owner.cookie, { kind: 'poster', contentType: 'image/png', size: second.length, generationId: owner.generationId, media: { ...media, expectedVersion: 1 } })).json() as Prepared
    await transfer(prepared, second)
    await admin.query(`UPDATE "Property" SET price = 260000 WHERE id = $1`, [owner.propertyId])
    expect((await complete(owner.cookie, prepared.attemptId)).json()).toMatchObject({ code: 'SOURCE_CHANGED' })
    const current = (await app.inject({ url: `/api/generations/${owner.generationId}/media`, headers: { cookie: owner.cookie } })).json()
    expect(current.poster).toMatchObject({ version: 1, templateId: 'premium' })
  })

  it('vídeo: la principal debe abrirlo; como mucho 25; solo fotografías del inmueble; pista ajena 404', async () => {
    const owner = await setup(3)
    const video = makeVideo('webm', 12)
    const primary = owner.source.photos.find(photo => photo.isPrimary)!.id
    const others = owner.source.photos.filter(photo => !photo.isPrimary).map(photo => photo.id)
    const base = { sourceHash: owner.source.sourceHash, expectedVersion: 0, variant: 2, durationMs: 12_000, audio: { source: 'none', trackId: null, volume: null, fadeInMs: null, fadeOutMs: null } }
    const request = (photoIds: string[], extra: object = {}) => ({ kind: 'video', contentType: 'video/webm', size: video.length, generationId: owner.generationId, media: { ...base, photoIds, ...extra } })
    expect((await prepare(owner.cookie, request([others[0], primary]))).json().message).toContain('principal')
    const foreign = await setup(1)
    expect((await prepare(owner.cookie, request([primary, foreign.source.photos[0].id]))).statusCode).toBe(400)
    const intruderTrack = makeWav(2, { seed: 77 })
    const track = (await directUpload(foreign.cookie, { kind: 'audio', contentType: 'audio/wav', size: intruderTrack.length, rightsConfirmed: true }, intruderTrack)).done!.json().track.id
    expect((await prepare(owner.cookie, request([primary], { audio: { source: 'library', trackId: track, volume: 50, fadeInMs: 0, fadeOutMs: 0 } }))).statusCode).toBe(404)
    // Orden elegido por el usuario: principal y después las demás en orden inverso a la galería.
    const order = [primary, ...[...others].reverse()]
    const done = await directUpload(owner.cookie, request(order), video)
    expect(done.done!.json()).toMatchObject({ kind: 'video', media: { photoCount: 3, hasAudio: false } })
    expect((await admin.query(`SELECT "photoIds" FROM "ListingMedia" WHERE "generationId" = $1 AND kind = 'video'`, [owner.generationId])).rows[0].photoIds).toBe(JSON.stringify(order))
  })
})

describe('descargas directas con URL firmada', () => {
  async function withPhoto() {
    const owner = await account()
    const ids = await property(owner.userId)
    const image = makePng(90, 60, 31)
    const done = (await directUpload(owner.cookie, photoRequest(ids.propertyId, image), image)).done!.json()
    return { ...owner, ...ids, image, photo: done.photo as { id: string; url: string } }
  }

  it('el archivo se sirve con una redirección a una URL firmada (sin caché) o en JSON con ?as=url', async () => {
    const owner = await withPhoto()
    const redirect = await app.inject({ url: owner.photo.url, headers: { cookie: owner.cookie } })
    expect(redirect.statusCode).toBe(302)
    expect(redirect.headers).toMatchObject({ 'cache-control': 'private, no-store', vary: 'Cookie' })
    expect(redirect.body).toBe('')
    const signed = redirect.headers.location as string
    expect(signed).toMatch(/\/api\/local-blob\/u\/.+\.png\?op=get&exp=\d+&sig=/)
    const json = await app.inject({ url: `${owner.photo.url}&as=url`, headers: { cookie: owner.cookie } })
    expect(json.json()).toMatchObject({ url: expect.stringContaining('op=get') })
    const file = await app.inject({ url: pathOf(signed) })
    expect(file.statusCode).toBe(200)
    expect(file.rawPayload.equals(owner.image)).toBe(true)
    expect(file.headers).toMatchObject({ 'accept-ranges': 'bytes', 'content-type': 'image/png', 'x-content-type-options': 'nosniff' })
  })

  it('sin sesión 401, otra cuenta 404 y un identificador manipulado 404: no se emite ninguna URL', async () => {
    const owner = await withPhoto()
    const intruder = await account()
    expect((await app.inject({ url: owner.photo.url })).statusCode).toBe(401)
    expect((await app.inject({ url: `${owner.photo.url}&as=url`, headers: { cookie: intruder.cookie } })).statusCode).toBe(404)
    const other = await property(intruder.userId)
    expect((await app.inject({ url: `/api/properties/${other.propertyId}/photos/${owner.photo.id}/file?as=url`, headers: { cookie: intruder.cookie } })).statusCode).toBe(404)
  })

  it('la URL de lectura no sirve para otra clave, para escribir ni para HEAD, y caduca', async () => {
    const owner = await withPhoto()
    const signed = new URL((await app.inject({ url: `${owner.photo.url}&as=url`, headers: { cookie: owner.cookie } })).json().url)
    const otherKey = signed.pathname.replace(/[0-9a-f-]{36}\.png$/, '00000000-0000-4000-8000-000000000000.png')
    expect((await app.inject({ url: otherKey + signed.search })).statusCode).toBe(403)
    expect((await app.inject({ method: 'PUT', url: signed.pathname + signed.search, headers: { 'content-type': 'image/png' }, payload: makePng() })).statusCode).toBe(403)
    expect((await app.inject({ method: 'HEAD', url: signed.pathname + signed.search })).statusCode).toBe(403)
    const key = signed.pathname.replace('/api/local-blob/', '')
    const expired = mods.storage.signer!.sign({ op: 'get', key, exp: Date.now() - 1 })
    expect((await app.inject({ url: pathOf(expired) })).json()).toMatchObject({ code: 'EXPIRED' })
    // Sin firma (lo que sería una URL «pública»): no hay acceso.
    expect((await app.inject({ url: signed.pathname })).statusCode).toBe(403)
  })

  it('archivo grande (6 MB, por encima de los 4,5 MB de una Function): descarga completa, Range, reanudación y fin del archivo', async () => {
    // Objeto escrito directamente en el almacenamiento: comprueba el transporte, no los límites de subida.
    const key = `u/${id('u')}/g/${id('g')}/video/${'00000000-0000-4000-8000-00000000abcd'}.mp4`
    const big = Buffer.alloc(6 * 1024 * 1024)
    for (let i = 0; i < big.length; i += 4096) big.writeUInt32BE(i, i)
    await mods.storage.put(key, big)
    const url = pathOf(mods.storage.signer!.sign({ op: 'get', key, exp: Date.now() + 60_000 }))
    const full = await app.inject({ url })
    expect(full.statusCode).toBe(200)
    expect(full.headers['content-length']).toBe(String(big.length))
    expect(full.rawPayload.equals(big)).toBe(true)
    const first = await app.inject({ url, headers: { range: 'bytes=0-1023' } })
    expect(first.statusCode).toBe(206)
    expect(first.headers['content-range']).toBe(`bytes 0-1023/${big.length}`)
    expect(first.rawPayload.equals(big.subarray(0, 1024))).toBe(true)
    // Reanudar desde la mitad y saltar al final (avance en un reproductor).
    const resume = await app.inject({ url, headers: { range: `bytes=${3 * 1024 * 1024}-` } })
    expect(resume.statusCode).toBe(206)
    expect(resume.rawPayload.equals(big.subarray(3 * 1024 * 1024))).toBe(true)
    const tail = await app.inject({ url, headers: { range: 'bytes=-4096' } })
    expect(tail.rawPayload.equals(big.subarray(big.length - 4096))).toBe(true)
    expect((await app.inject({ url, headers: { range: `bytes=${big.length + 10}-` } })).statusCode).toBe(416)
  })

  it('material: el cartel redirige y la descarga lleva nombre de adjunto; tras cerrar sesión no hay acceso', async () => {
    const owner = await withPhoto()
    const source = (await app.inject({ url: `/api/generations/${owner.generationId}/media/source`, headers: { cookie: owner.cookie } })).json()
    const poster = makeJpeg(1080, 1350, 4)
    const media = { sourceHash: source.sourceHash, expectedVersion: 0, variant: 1, photoIds: [source.photos[0].id], poster: { templateId: 'elegante', selection: 'manual', drawId: null } }
    const done = (await directUpload(owner.cookie, { kind: 'poster', contentType: 'image/jpeg', size: poster.length, generationId: owner.generationId, media }, poster)).done!.json()
    const redirect = await app.inject({ url: `${done.media.url}&download=1`, headers: { cookie: owner.cookie } })
    expect(redirect.statusCode).toBe(302)
    const file = await app.inject({ url: pathOf(redirect.headers.location as string) })
    expect(file.headers['content-disposition']).toBe(`attachment; filename="estateforge-cartel-${owner.generationId}.jpg"`)
    expect(file.rawPayload.equals(poster)).toBe(true)
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: owner.cookie } })
    expect((await app.inject({ url: done.media.url, headers: { cookie: owner.cookie } })).statusCode).toBe(401)
  })
})

describe('caducidad de las URLs de lectura (DA-59)', () => {
  it('imágenes 10-15 min, audio 30-35 min y vídeo 60-65 min, en tramos de 5 min', async () => {
    const { readExpiry } = await import('../media/upload.service.js')
    const min = 60_000
    for (let offset = 0; offset < 5 * min; offset += 37_000) {
      const now = Date.UTC(2026, 10, 11, 12, 0, 0) + offset
      for (const [kind, low, high] of [['photo', 10, 15], ['thumb', 10, 15], ['poster', 10, 15], ['audio', 30, 35], ['video', 60, 65]] as const) {
        const left = readExpiry(kind, now).getTime() - now
        expect(left).toBeGreaterThanOrEqual(low * min)
        expect(left).toBeLessThanOrEqual(high * min)
        expect(readExpiry(kind, now).getTime() % (5 * min)).toBe(0)
      }
    }
  })
})
