import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { makeJpeg, makeMp4, makePng, makeWebm, makeWebp, uniqueSeed } from '../test-support/images.js'
import { makeM4a, makeMp3, makeOgg, makeVideo, makeWav } from '../test-support/media-files.js'
import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'
import type { ObjectStorage, StoredObject } from '../storage/object-storage.js'

// Galería, cartel y vídeo contra PostgreSQL real y la aplicación completa (buildApp: sesiones,
// manejador de errores, límites de tamaño y de peticiones). El almacenamiento es local, en un
// directorio temporal, envuelto para inyectar fallos de subida y de borrado.

let database: TestDatabase
let admin: pg.Client
let root: string
let mods: {
  buildApp: typeof import('../app.js')['buildApp']
  createSession: typeof import('../services/session.service.js')['createSession']
  storageModule: typeof import('../storage/object-storage.js')
  LocalStorage: typeof import('../storage/local-storage.js')['LocalStorage']
  drain: typeof import('../media/storage-cleanup.js')['drainStorageCleanup']
  drawPosterTemplate: typeof import('../media/listing-media.service.js')['drawPosterTemplate']
  findOrphans: typeof import('../media/storage-cleanup.js')['findOrphans']
  closeDatabase: () => Promise<void>
}

class FaultyStorage implements ObjectStorage {
  readonly driver = 'local' as const
  failPut = false
  failDelete = false
  directTransfers = false
  constructor(private readonly inner: ObjectStorage) {}
  head(key: string) {
    return this.inner.head(key)
  }
  presignPut(key: string, options: Parameters<ObjectStorage['presignPut']>[1]) {
    return this.inner.presignPut(key, options)
  }
  presignGet(key: string, options: Parameters<ObjectStorage['presignGet']>[1]) {
    return this.inner.presignGet(key, options)
  }
  async put(key: string, body: Buffer, type: string) {
    if (this.failPut) throw new Error('fallo simulado al subir')
    return this.inner.put(key, body, type)
  }
  get(key: string): Promise<StoredObject | null> {
    return this.inner.get(key)
  }
  async delete(key: string) {
    if (this.failDelete) throw new Error('fallo simulado al borrar')
    return this.inner.delete(key)
  }
  list(prefix: string) {
    return this.inner.list(prefix)
  }
}

let storage: FaultyStorage
const apps: FastifyInstance[] = []

async function newApp() {
  const app = await mods.buildApp()
  await app.ready()
  apps.push(app)
  return app
}

const id = (prefix: string) => `c${prefix}${randomBytes(10).toString('hex')}`.slice(0, 25)

async function account() {
  const userId = id('u')
  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt", "emailVerifiedAt") VALUES ($1, $2, 'x', now(), now())`, [userId, `${userId}@example.test`])
  const { token } = await mods.createSession(userId)
  return { userId, cookie: `estateforge_session=${token}` }
}

async function property(userId: string, price = '250000.00') {
  const propertyId = id('p')
  await admin.query(
    `INSERT INTO "Property" (id, title, operation, type, price, address, city, neighborhood, area, bedrooms, bathrooms, condition, "commercialStatus", "additionalInformation", "userId", "updatedAt")
     VALUES ($1, 'Piso luminoso', 'sale', 'apartment', $2, 'Calle Privada 7', 'Madrid', 'Chamberí', 92, 3, 2, 'good', 'for-sale', '', $3, now())`,
    [propertyId, price, userId],
  )
  const generationId = id('g')
  await admin.query(
    `INSERT INTO "Generation" (id, title, description, highlights, "callToAction", provider, tone, language, "propertyId", "updatedAt")
     VALUES ($1, 'Vive en Chamberí', 'Piso exterior', '["Exterior","Reformado"]', 'Pide visita', 'mock', 'professional', 'español', $2, now())`,
    [generationId, propertyId],
  )
  return { propertyId, generationId }
}

const objects = async () => (await storage.list('u/')).length

beforeAll(async () => {
  database = await createTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'ef-media-'))
  vi.stubEnv('DATABASE_URL', database.url)
  vi.stubEnv('STORAGE_LOCAL_DIR', root)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  vi.resetModules()
  const cleanup = await import('../media/storage-cleanup.js')
  mods = {
    buildApp: (await import('../app.js')).buildApp,
    createSession: (await import('../services/session.service.js')).createSession,
    storageModule: await import('../storage/object-storage.js'),
    LocalStorage: (await import('../storage/local-storage.js')).LocalStorage,
    drain: cleanup.drainStorageCleanup,
    drawPosterTemplate: (await import('../media/listing-media.service.js')).drawPosterTemplate,
    findOrphans: cleanup.findOrphans,
    closeDatabase: (await import('../db/prisma.js')).closeDatabase,
  }
  storage = new FaultyStorage(new mods.LocalStorage(root))
  mods.storageModule.setStorageForTests(storage)
})

afterEach(async () => {
  storage.failPut = false
  storage.failDelete = false
  await admin.query(`DROP TRIGGER IF EXISTS fail_media ON "ListingMedia"; DROP TRIGGER IF EXISTS fail_photo ON "PropertyPhoto"; DROP FUNCTION IF EXISTS fail_now()`)
})

afterAll(async () => {
  await Promise.all(apps.map(app => app.close()))
  await mods.closeDatabase()
  await admin.end()
  vi.unstubAllEnvs()
  await database.drop()
  rmSync(root, { recursive: true, force: true })
})

async function failOn(table: 'ListingMedia' | 'PropertyPhoto', op: 'INSERT' | 'UPDATE') {
  await admin.query(`CREATE OR REPLACE FUNCTION fail_now() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo simulado de la base'; END $$`)
  await admin.query(`CREATE TRIGGER ${table === 'ListingMedia' ? 'fail_media' : 'fail_photo'} BEFORE ${op} ON "${table}" FOR EACH ROW EXECUTE FUNCTION fail_now()`)
}

// Cada cuenta escribe desde su propia IP, como usuarios reales: el rate-limit es por IP.
const ipFor = (cookie: string) => {
  let h = 0
  for (const ch of cookie) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `10.${(h >> 16) & 255}.${(h >> 8) & 255}.${h & 255}`
}

const upload = (app: FastifyInstance, cookie: string, propertyId: string, body: Buffer, type = 'image/png', name = 'salón.png') =>
  app.inject({ method: 'POST', url: `/api/properties/${propertyId}/photos`, remoteAddress: ipFor(cookie), headers: { cookie, 'content-type': type, 'x-file-name': encodeURIComponent(name) }, payload: body })

const listPhotos = async (app: FastifyInstance, cookie: string, propertyId: string) =>
  (await app.inject({ url: `/api/properties/${propertyId}/photos`, headers: { cookie } })).json().photos as { id: string; position: number; isPrimary: boolean; url: string }[]

async function source(app: FastifyInstance, cookie: string, generationId: string) {
  return (await app.inject({ url: `/api/generations/${generationId}/media/source`, headers: { cookie } })).json() as {
    sourceHash: string
    property: { id: string; price: string; city: string }
    photos: { id: string; url: string }[]
  }
}

interface AudioOpts {
  source: 'none' | 'preset' | 'library'
  track?: string
  volume?: number
  fadeIn?: number
  fadeOut?: number
}

function putMedia(
  app: FastifyInstance,
  cookie: string,
  generationId: string,
  kind: 'poster' | 'video',
  body: Buffer,
  opts: { hash: string; version: number; photoIds: string[]; type?: string; duration?: number; variant?: number; template?: string; selection?: 'manual' | 'random'; drawId?: string; audio?: AudioOpts },
) {
  const audio = opts.audio ?? { source: 'none' }
  return app.inject({
    method: 'PUT',
    url: `/api/generations/${generationId}/media/${kind}`,
    headers: {
      cookie,
      'content-type': opts.type ?? (kind === 'poster' ? 'image/png' : 'video/webm'),
      'x-source-hash': opts.hash,
      'x-expected-version': String(opts.version),
      'x-media-variant': String(opts.variant ?? 1),
      'x-photo-ids': opts.photoIds.join(','),
      ...(kind === 'video' && { 'x-media-duration-ms': String(opts.duration ?? 12_000), 'x-audio-source': audio.source }),
      ...(kind === 'video' && audio.source !== 'none' && {
        'x-audio-track': audio.track ?? '',
        'x-audio-volume': String(audio.volume ?? 80),
        'x-audio-fade-in-ms': String(audio.fadeIn ?? 500),
        'x-audio-fade-out-ms': String(audio.fadeOut ?? 1500),
      }),
      ...(kind === 'poster' && { 'x-template-id': opts.template ?? 'fotografico', 'x-template-selection': opts.selection ?? 'manual' }),
      ...(opts.drawId && { 'x-template-draw': opts.drawId }),
    },
    payload: body,
  })
}

async function withPhotos(app: FastifyInstance, count: number) {
  const owner = await account()
  const ids = await property(owner.userId)
  for (let i = 0; i < count; i += 1) expect((await upload(app, owner.cookie, ids.propertyId, makePng(80, 60, uniqueSeed()))).statusCode).toBe(201)
  return { ...owner, ...ids }
}

describe('galería de fotografías', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await newApp()
  })

  it('galería vacía: lista vacía con el límite de 50 y los límites de tamaño', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const response = await app.inject({ url: `/api/properties/${propertyId}/photos`, headers: { cookie: owner.cookie } })
    expect(response.json()).toEqual({ photos: [], limit: 50, maxBytes: 4 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024, totalBytes: 0 })
  })

  it('sube una fotografía válida: la primera es la principal y se sirve con cabeceras seguras', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const image = makePng(120, 90, 7)
    const response = await upload(app, owner.cookie, propertyId, image)
    expect(response.statusCode).toBe(201)
    const photo = response.json()
    expect(photo).toMatchObject({ position: 0, isPrimary: true, contentType: 'image/png', width: 120, height: 90, originalName: 'salón.png' })
    const file = await app.inject({ url: photo.url, headers: { cookie: owner.cookie } })
    expect(file.statusCode).toBe(200)
    expect(file.rawPayload.equals(image)).toBe(true)
    expect(file.headers).toMatchObject({ 'content-type': 'image/png', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-cache', vary: 'Cookie' })
    expect(file.headers.etag).toMatch(/^"p-[0-9a-f]{32}"$/)
    // Ni el campo ni una clave interna («u/<usuario>/p/<inmueble>/photos/…»); un id que termine en «u» no cuenta.
    expect(JSON.stringify(photo)).not.toMatch(/storageKey|"u\/|\/u\/[a-z0-9]+\/(?:p|g)\//)
  })

  it.each([
    ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1'), 'image/gif', 415],
    ['texto disfrazado de JPEG', Buffer.from('<?php echo 1; ?>'), 'image/jpeg', 400],
    ['PNG declarado como JPEG', makePng(), 'image/jpeg', 415],
    ['SVG', Buffer.from('<svg/>'), 'image/svg+xml', 415],
  ])('rechaza un formato no permitido o falseado: %s', async (_label, body, type, status) => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const response = await upload(app, owner.cookie, propertyId, body, type)
    expect(response.statusCode).toBe(status)
    expect(await listPhotos(app, owner.cookie, propertyId)).toEqual([])
  })

  it('rechaza un archivo de más de 4 MB sin almacenarlo', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const before = await objects()
    const big = Buffer.concat([makePng(), Buffer.alloc(4 * 1024 * 1024)])
    expect((await upload(app, owner.cookie, propertyId, big)).statusCode).toBe(413)
    expect(await objects()).toBe(before)
  })

  it('rechaza una fotografía repetida en el mismo inmueble', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const image = makePng(50, 50, 99)
    expect((await upload(app, owner.cookie, propertyId, image)).statusCode).toBe(201)
    expect((await upload(app, owner.cookie, propertyId, image)).json()).toMatchObject({ code: 'DUPLICATE' })
  })

  it.each([1, 16, 49])('con %i fotografías se admite una más (el límite anterior de 16 ya no se aplica)', async count => {
    const owner = await withPhotos(app, count)
    expect((await upload(app, owner.cookie, owner.propertyId, makePng(30, 30, 4242 + count))).statusCode).toBe(201)
    const photos = await listPhotos(app, owner.cookie, owner.propertyId)
    expect(photos.map(photo => photo.position)).toEqual([...Array(count + 1).keys()])
    expect(photos.filter(photo => photo.isPrimary)).toHaveLength(1)
  })

  it('admite 50 y rechaza la número 51', async () => {
    const owner = await withPhotos(app, 50)
    const before = await objects()
    const response = await upload(app, owner.cookie, owner.propertyId, makePng(30, 30, 424242))
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'LIMIT_REACHED' })
    expect(response.json().message).toContain('50')
    expect(await objects()).toBe(before)
    const photos = await listPhotos(app, owner.cookie, owner.propertyId)
    expect(photos.map(photo => photo.position)).toEqual([...Array(50).keys()])
  })

  it('60 subidas simultáneas: exactamente 50 guardadas, posiciones 0-49, una principal y ningún archivo huérfano', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const before = await objects()
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => upload(app, owner.cookie, propertyId, makePng(40, 40, 5000 + i))))
    expect(results.filter(r => r.statusCode === 201)).toHaveLength(50)
    expect(results.filter(r => r.statusCode !== 201).every(r => r.json().code === 'LIMIT_REACHED')).toBe(true)
    const rows = (await admin.query(`SELECT position, "isPrimary" FROM "PropertyPhoto" WHERE "propertyId" = $1 ORDER BY position`, [propertyId])).rows
    expect(rows.map(row => row.position)).toEqual([...Array(50).keys()])
    expect(rows.filter(row => row.isPrimary)).toHaveLength(1)
    expect(await objects()).toBe(before + 50)
  })

  it('reordena las 50: invierte el orden y mueve la principal sin perder ninguna', async () => {
    const owner = await withPhotos(app, 50)
    const photos = await listPhotos(app, owner.cookie, owner.propertyId)
    const reversed = photos.map(photo => photo.id).reverse()
    const response = await app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/order`, headers: { cookie: owner.cookie }, payload: { photoIds: reversed } })
    expect(response.statusCode).toBe(200)
    expect(response.json().photos.map((photo: { id: string }) => photo.id)).toEqual(reversed)
    const last = photos[0]
    expect((await app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/${reversed[10]}/primary`, headers: { cookie: owner.cookie } })).statusCode).toBe(200)
    const after = await listPhotos(app, owner.cookie, owner.propertyId)
    expect(after.filter(photo => photo.isPrimary).map(photo => photo.id)).toEqual([reversed[10]])
    expect(after.at(-1)?.id).toBe(last.id)
    // Eliminar y sustituir siguen funcionando con la galería llena.
    expect((await app.inject({ method: 'DELETE', url: `/api/properties/${owner.propertyId}/photos/${reversed[10]}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204)
    const remaining = await listPhotos(app, owner.cookie, owner.propertyId)
    expect(remaining.map(photo => photo.position)).toEqual([...Array(49).keys()])
    expect(remaining.filter(photo => photo.isPrimary)).toHaveLength(1)
  })

  it('elimina: reordena las restantes y reasigna la principal; borra el archivo', async () => {
    const owner = await withPhotos(app, 3)
    const [first, second, third] = await listPhotos(app, owner.cookie, owner.propertyId)
    const before = await objects()
    expect((await app.inject({ method: 'DELETE', url: `/api/properties/${owner.propertyId}/photos/${first.id}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204)
    const after = await listPhotos(app, owner.cookie, owner.propertyId)
    expect(after.map(photo => [photo.id, photo.position, photo.isPrimary])).toEqual([[second.id, 0, true], [third.id, 1, false]])
    expect(await objects()).toBe(before - 1)
    expect((await admin.query(`SELECT count(*)::int AS n FROM "StorageCleanup"`)).rows[0].n).toBe(0)
  })

  it('sustituye una fotografía: URL nueva, mismo lugar y el archivo anterior se borra', async () => {
    const owner = await withPhotos(app, 2)
    const [photo] = await listPhotos(app, owner.cookie, owner.propertyId)
    const before = await objects()
    const replacement = makeWebp(640, 480)
    const response = await app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/${photo.id}/file`, headers: { cookie: owner.cookie, 'content-type': 'image/webp' }, payload: replacement })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: photo.id, position: 0, isPrimary: true, contentType: 'image/webp', width: 640 })
    expect(response.json().url).not.toBe(photo.url)
    expect(await objects()).toBe(before)
  })

  it('caché privada revalidada: 304 con la misma versión, archivo nuevo tras sustituir', async () => {
    const owner = await withPhotos(app, 1)
    const [photo] = await listPhotos(app, owner.cookie, owner.propertyId)
    const first = await app.inject({ url: photo.url, headers: { cookie: owner.cookie } })
    const etag = first.headers.etag as string
    const again = await app.inject({ url: photo.url, headers: { cookie: owner.cookie, 'if-none-match': etag } })
    expect(again.statusCode).toBe(304)
    expect(again.rawPayload.length).toBe(0)
    expect(again.headers).toMatchObject({ etag, 'cache-control': 'private, no-cache' })
    expect((await app.inject({ url: photo.url, headers: { cookie: owner.cookie, 'if-none-match': `W/${etag}, "otra"` } })).statusCode).toBe(304)
    await app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/${photo.id}/file`, headers: { cookie: owner.cookie, 'content-type': 'image/webp' }, payload: makeWebp(320, 240) })
    const stale = await app.inject({ url: `/api/properties/${owner.propertyId}/photos/${photo.id}/file`, headers: { cookie: owner.cookie, 'if-none-match': etag } })
    expect(stale.statusCode).toBe(200)
    expect(stale.headers['content-type']).toBe('image/webp')
    expect(stale.headers.etag).not.toBe(etag)
  })

  it('si falla la subida al sustituir, la fotografía anterior sigue intacta', async () => {
    const owner = await withPhotos(app, 1)
    const [photo] = await listPhotos(app, owner.cookie, owner.propertyId)
    storage.failPut = true
    const response = await app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/${photo.id}/file`, headers: { cookie: owner.cookie, 'content-type': 'image/webp' }, payload: makeWebp() })
    expect(response.statusCode).toBe(500)
    storage.failPut = false
    expect((await app.inject({ url: photo.url, headers: { cookie: owner.cookie } })).statusCode).toBe(200)
  })

  it('si falla la base de datos al añadir, no queda archivo huérfano', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const before = await objects()
    await failOn('PropertyPhoto', 'INSERT')
    expect((await upload(app, owner.cookie, propertyId, makePng(33, 33, 77))).statusCode).toBe(500)
    expect(await objects()).toBe(before)
  })

  it('reordena y elige la principal manteniendo una sola', async () => {
    const owner = await withPhotos(app, 3)
    const [a, b, c] = await listPhotos(app, owner.cookie, owner.propertyId)
    const reordered = await app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/order`, headers: { cookie: owner.cookie }, payload: { photoIds: [c.id, a.id, b.id] } })
    expect(reordered.json().photos.map((photo: { id: string }) => photo.id)).toEqual([c.id, a.id, b.id])
    const primary = await app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/${b.id}/primary`, headers: { cookie: owner.cookie } })
    expect(primary.json().photos.filter((photo: { isPrimary: boolean }) => photo.isPrimary).map((photo: { id: string }) => photo.id)).toEqual([b.id])
    const bad = await app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/order`, headers: { cookie: owner.cookie }, payload: { photoIds: [a.id, b.id] } })
    expect(bad.json()).toMatchObject({ code: 'INVALID_ORDER' })
  })

  it('la base impide dos principales y más de 50 aunque se salte la aplicación', async () => {
    const owner = await withPhotos(app, 2)
    await expect(admin.query(`UPDATE "PropertyPhoto" SET "isPrimary" = true WHERE "propertyId" = $1`, [owner.propertyId])).rejects.toMatchObject({ code: '23505' })
    await expect(admin.query(`UPDATE "PropertyPhoto" SET position = 50 WHERE "propertyId" = $1`, [owner.propertyId])).rejects.toMatchObject({ code: '23514' })
    await admin.query(`UPDATE "PropertyPhoto" SET position = 49 WHERE "propertyId" = $1 AND position = 1`, [owner.propertyId])
    const full = await withPhotos(app, 50)
    await expect(
      admin.query(
        `INSERT INTO "PropertyPhoto" (id, "propertyId", "storageKey", "contentType", size, width, height, sha256, position, "updatedAt") VALUES ('cextra000000000000000000x', $1, 'u/x/p/x/photos/00000000-0000-0000-0000-000000000000.png', 'image/png', 10, 1, 1, $2, 0, now())`,
        [full.propertyId, 'a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'PropertyPhoto_max_photos' })
  })
})

describe('seguridad entre usuarios', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await newApp()
  })

  it('la revalidación no salta la autorización: con la etiqueta correcta, otra cuenta recibe 404 y sin sesión 401', async () => {
    const owner = await withPhotos(app, 1)
    const intruder = await account()
    const [photo] = await listPhotos(app, owner.cookie, owner.propertyId)
    const etag = (await app.inject({ url: photo.url, headers: { cookie: owner.cookie } })).headers.etag as string
    expect((await app.inject({ url: photo.url, headers: { cookie: intruder.cookie, 'if-none-match': etag } })).statusCode).toBe(404)
    expect((await app.inject({ url: photo.url, headers: { 'if-none-match': etag } })).statusCode).toBe(401)
  })

  it('sin sesión: 401 en todas las rutas', async () => {
    const owner = await withPhotos(app, 1)
    const [photo] = await listPhotos(app, owner.cookie, owner.propertyId)
    for (const request of [
      { url: `/api/properties/${owner.propertyId}/photos` },
      { url: photo.url },
      { method: 'POST' as const, url: `/api/properties/${owner.propertyId}/photos`, headers: { 'content-type': 'image/png' }, payload: makePng() },
      { method: 'DELETE' as const, url: `/api/properties/${owner.propertyId}/photos/${photo.id}` },
      { url: `/api/generations/${owner.generationId}/media` },
      { url: `/api/generations/${owner.generationId}/media/source` },
    ]) {
      expect((await app.inject(request)).statusCode).toBe(401)
    }
  })

  it('otro usuario no puede listar, ver, subir, sustituir, borrar, reordenar ni elegir la principal (404)', async () => {
    const owner = await withPhotos(app, 2)
    const intruder = await account()
    const [photo, second] = await listPhotos(app, owner.cookie, owner.propertyId)
    const c = intruder.cookie
    const responses = await Promise.all([
      app.inject({ url: `/api/properties/${owner.propertyId}/photos`, headers: { cookie: c } }),
      app.inject({ url: photo.url, headers: { cookie: c } }),
      upload(app, c, owner.propertyId, makePng(20, 20, 31337)),
      app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/${photo.id}/file`, headers: { cookie: c, 'content-type': 'image/png' }, payload: makePng(21, 21, 1) }),
      app.inject({ method: 'DELETE', url: `/api/properties/${owner.propertyId}/photos/${photo.id}`, headers: { cookie: c } }),
      app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/order`, headers: { cookie: c }, payload: { photoIds: [second.id, photo.id] } }),
      app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/${second.id}/primary`, headers: { cookie: c } }),
    ])
    expect(responses.map(r => r.statusCode)).toEqual([404, 404, 404, 404, 404, 404, 404])
    expect((await listPhotos(app, owner.cookie, owner.propertyId)).map(p => p.id)).toEqual([photo.id, second.id])
  })

  it('identificadores manipulados: una foto de otro inmueble no se alcanza a través del mío', async () => {
    const owner = await withPhotos(app, 1)
    const victim = await withPhotos(app, 1)
    const [foreign] = await listPhotos(app, victim.cookie, victim.propertyId)
    const response = await app.inject({ url: `/api/properties/${owner.propertyId}/photos/${foreign.id}/file`, headers: { cookie: owner.cookie } })
    expect(response.statusCode).toBe(404)
    expect((await app.inject({ url: `/api/properties/..%2F..%2Fetc/photos`, headers: { cookie: owner.cookie } })).statusCode).toBe(400)
  })

  it('otro usuario no puede leer, regenerar ni descargar el material de un anuncio ajeno', async () => {
    const owner = await withPhotos(app, 1)
    const intruder = await account()
    const src = await source(app, owner.cookie, owner.generationId)
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 3), { hash: src.sourceHash, version: 0, photoIds: [src.photos[0].id] })).statusCode).toBe(200)
    const c = intruder.cookie
    const statuses = await Promise.all([
      app.inject({ url: `/api/generations/${owner.generationId}/media`, headers: { cookie: c } }),
      app.inject({ url: `/api/generations/${owner.generationId}/media/source`, headers: { cookie: c } }),
      app.inject({ url: `/api/generations/${owner.generationId}/media/poster/file?download=1`, headers: { cookie: c } }),
      putMedia(app, c, owner.generationId, 'poster', makePng(1080, 1350, 4), { hash: src.sourceHash, version: 1, photoIds: [src.photos[0].id] }),
    ])
    expect(statuses.map(r => r.statusCode)).toEqual([404, 404, 404, 404])
  })

  it('no se pueden asociar fotografías de otro inmueble a un anuncio propio', async () => {
    const owner = await withPhotos(app, 1)
    const other = await withPhotos(app, 1)
    const mine = await source(app, owner.cookie, owner.generationId)
    const theirs = await source(app, other.cookie, other.generationId)
    const response = await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 5), { hash: mine.sourceHash, version: 0, photoIds: [theirs.photos[0].id] })
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toContain('solo puede usar fotografías de este inmueble')
  })
})

describe('cartel', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await newApp()
  })

  it('sin fotografías: explica que hay que añadir alguna', async () => {
    const owner = await account()
    const { generationId } = await property(owner.userId)
    const src = await source(app, owner.cookie, generationId)
    expect(src.photos).toEqual([])
    const response = await putMedia(app, owner.cookie, generationId, 'poster', makePng(1080, 1350), { hash: src.sourceHash, version: 0, photoIds: ['c' + 'x'.repeat(24)] })
    expect(response.json()).toMatchObject({ code: 'NO_PHOTOS' })
  })

  it.each([1, 3, 50])('genera el cartel con %i fotografías del inmueble correcto y lo descarga', async count => {
    const owner = await withPhotos(app, count)
    const src = await source(app, owner.cookie, owner.generationId)
    expect(src.property).toMatchObject({ id: owner.propertyId, price: '250000.00', city: 'Madrid' })
    expect(JSON.stringify(src)).not.toContain('Calle Privada')
    expect(src.photos).toHaveLength(count)
    const poster = makePng(1080, 1350, count)
    // La plantilla «fotografico» usa hasta 4: con 50 en la galería, el cartel toma las 4 primeras.
    const used = src.photos.slice(0, 4).map(p => p.id)
    const response = await putMedia(app, owner.cookie, owner.generationId, 'poster', poster, { hash: src.sourceHash, version: 0, photoIds: used })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ kind: 'poster', version: 1, width: 1080, height: 1350, photoCount: Math.min(count, 4), templateId: 'fotografico', templateName: 'Fotográfico', templateVersion: 1, selectionMode: 'manual' })
    const file = await app.inject({ url: `/api/generations/${owner.generationId}/media/poster/file?download=1`, headers: { cookie: owner.cookie } })
    expect(file.rawPayload.equals(poster)).toBe(true)
    expect(file.headers['content-disposition']).toBe(`attachment; filename="estateforge-cartel-${owner.generationId}.png"`)
  })

  it('el cartel guardado en el navegador se revalida: 304 sin cambios y 200 con el regenerado', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, photoIds: src.photos.map(p => p.id) }
    await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 21), { ...opts, version: 0 })
    const url = `/api/generations/${owner.generationId}/media/poster/file`
    const first = await app.inject({ url, headers: { cookie: owner.cookie } })
    const etag = first.headers.etag as string
    expect(etag).toMatch(/^"m-[0-9a-f]{32}"$/)
    expect(etag).not.toContain('u/')
    expect((await app.inject({ url, headers: { cookie: owner.cookie, 'if-none-match': etag } })).statusCode).toBe(304)
    const intruder = await account()
    expect((await app.inject({ url, headers: { cookie: intruder.cookie, 'if-none-match': etag } })).statusCode).toBe(404)
    await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 22), { ...opts, version: 1, variant: 4 })
    const fresh = await app.inject({ url, headers: { cookie: owner.cookie, 'if-none-match': etag } })
    expect(fresh.statusCode).toBe(200)
    expect(fresh.headers.etag).not.toBe(etag)
  })

  it('regenerar sustituye el cartel y borra el anterior; no toca el vídeo', async () => {
    const owner = await withPhotos(app, 2)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, photoIds: src.photos.map(p => p.id) }
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12, { seed: 1 }), { ...opts, version: 0 })).statusCode).toBe(200)
    await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 10), { ...opts, version: 0 })
    const before = await objects()
    const second = makePng(1080, 1350, 11)
    const response = await putMedia(app, owner.cookie, owner.generationId, 'poster', second, { ...opts, version: 1, variant: 2 })
    expect(response.json()).toMatchObject({ version: 2, variant: 2 })
    expect(await objects()).toBe(before)
    const media = (await app.inject({ url: `/api/generations/${owner.generationId}/media`, headers: { cookie: owner.cookie } })).json()
    expect(media.video.version).toBe(1)
    expect((await app.inject({ url: media.poster.url, headers: { cookie: owner.cookie } })).rawPayload.equals(second)).toBe(true)
  })

  it.each([
    ['falla la subida', 'put'],
    ['falla la base de datos', 'db'],
  ])('si %s, se conserva el cartel anterior y no queda ningún archivo nuevo', async (_label, failure) => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, photoIds: [src.photos[0].id] }
    const first = makePng(1080, 1350, 20)
    await putMedia(app, owner.cookie, owner.generationId, 'poster', first, { ...opts, version: 0 })
    const before = await objects()
    if (failure === 'put') storage.failPut = true
    else await failOn('ListingMedia', 'UPDATE')
    const response = await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 21), { ...opts, version: 1 })
    expect(response.statusCode).toBe(500)
    expect(await objects()).toBe(before)
    const media = (await app.inject({ url: `/api/generations/${owner.generationId}/media`, headers: { cookie: owner.cookie } })).json()
    expect(media.poster.version).toBe(1)
    expect((await app.inject({ url: media.poster.url, headers: { cookie: owner.cookie } })).rawPayload.equals(first)).toBe(true)
  })

  it('si no se puede borrar el archivo anterior, el cartel nuevo funciona y la limpieza queda pendiente hasta reintentarla', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, photoIds: [src.photos[0].id] }
    await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 30), { ...opts, version: 0 })
    storage.failDelete = true
    const response = await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 31), { ...opts, version: 1 })
    expect(response.statusCode).toBe(200)
    const pending = (await admin.query(`SELECT attempts, "lastError" FROM "StorageCleanup"`)).rows
    expect(pending).toEqual([{ attempts: 1, lastError: 'Error' }])
    storage.failDelete = false
    expect(await mods.drain(null)).toEqual({ deleted: 1, failed: 0 })
    expect((await admin.query(`SELECT count(*)::int AS n FROM "StorageCleanup"`)).rows[0].n).toBe(0)
    expect(await mods.findOrphans()).toEqual([])
  })

  it('si los datos o las fotografías cambian durante la generación, se rechaza y se conserva el anterior', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    await admin.query(`UPDATE "Property" SET price = 260000 WHERE id = $1`, [owner.propertyId])
    const response = await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 40), { hash: src.sourceHash, version: 0, photoIds: [src.photos[0].id] })
    expect(response.json()).toMatchObject({ code: 'SOURCE_CHANGED' })
  })

  it('dos regeneraciones simultáneas: una gana, la otra recibe 409 y no queda ningún archivo de más', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, photoIds: [src.photos[0].id] }
    await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 50), { ...opts, version: 0 })
    const before = await objects()
    const results = await Promise.all([51, 52, 53].map(seed => putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, seed), { ...opts, version: 1 })))
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409, 409])
    expect(await objects()).toBe(before)
    const row = (await admin.query(`SELECT version FROM "ListingMedia" WHERE "generationId" = $1 AND kind = 'poster'`, [owner.generationId])).rows[0]
    expect(row.version).toBe(2)
  })

  it('rechaza un cartel que no es una imagen válida o falsea su tipo', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, version: 0, photoIds: [src.photos[0].id] }
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makeWebm(), { ...opts, type: 'image/png' })).statusCode).toBe(400)
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(), { ...opts, type: 'image/jpeg' })).statusCode).toBe(415)
  })
})

describe('vídeo', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await newApp()
  })

  it.each([
    ['WebM con 1 fotografía', 1, makeVideo('webm', 20, { seed: 1 }), 'video/webm'],
    ['MP4 con 3 fotografías', 3, makeVideo('mp4', 20, { seed: 2 }), 'video/mp4'],
    ['WebM con 25 fotografías (máximo del vídeo)', 25, makeVideo('webm', 20, { seed: 3 }), 'video/webm'],
  ])('%s: se guarda, se descarga y conserva su formato', async (_label, count, video, type) => {
    const owner = await withPhotos(app, count)
    const src = await source(app, owner.cookie, owner.generationId)
    const response = await putMedia(app, owner.cookie, owner.generationId, 'video', video, { hash: src.sourceHash, version: 0, photoIds: src.photos.map(p => p.id), type, duration: 20_000 })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ kind: 'video', contentType: type, photoCount: count, hasAudio: false, audioSource: 'none', audioName: null })
    expect(Math.abs(response.json().durationMs - 20_000)).toBeLessThanOrEqual(100)
    const file = await app.inject({ url: `/api/generations/${owner.generationId}/media/video/file?download=1`, headers: { cookie: owner.cookie } })
    expect(file.headers['content-type']).toBe(type)
    expect(file.rawPayload.equals(video)).toBe(true)
  })

  it('regenerar el vídeo lo sustituye y no toca el cartel; si falla, se conserva el anterior', async () => {
    const owner = await withPhotos(app, 2)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, photoIds: src.photos.map(p => p.id) }
    await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 60), { ...opts, version: 0 })
    await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12, { seed: 61 }), { ...opts, version: 0 })
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12, { seed: 62 }), { ...opts, version: 1 })).json()).toMatchObject({ version: 2 })
    storage.failPut = true
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12, { seed: 63 }), { ...opts, version: 2 })).statusCode).toBe(500)
    storage.failPut = false
    const media = (await app.inject({ url: `/api/generations/${owner.generationId}/media`, headers: { cookie: owner.cookie } })).json()
    expect([media.poster.version, media.video.version]).toEqual([1, 2])
  })

  it('rechaza tamaño excesivo, duración inválida y contenido que no es vídeo', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, version: 0, photoIds: [src.photos[0].id] }
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makeWebm(4 * 1024 * 1024 + 10), opts)).statusCode).toBe(413)
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makeWebm(), { ...opts, duration: 120_000 })).statusCode).toBe(400)
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makePng(), { ...opts, type: 'video/webm' })).statusCode).toBe(400)
    // Cabecera WebM sin pistas ni bloques: no es un vídeo utilizable.
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makeWebm(8192), opts)).json()).toMatchObject({ code: 'INVALID_FILE' })
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makeMp4(8192), { ...opts, type: 'video/mp4' })).json()).toMatchObject({ code: 'INVALID_FILE' })
    // Duración declarada que no coincide con la del archivo.
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 5), { ...opts, duration: 30_000 })).json()).toMatchObject({ code: 'INVALID_FILE' })
  })

  it('más de 25 fotografías en el vídeo: se rechaza', async () => {
    const owner = await withPhotos(app, 26)
    const src = await source(app, owner.cookie, owner.generationId)
    const response = await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12), { hash: src.sourceHash, version: 0, photoIds: src.photos.map(p => p.id) })
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toContain('25')
  })
})

describe('borrado en cascada', () => {
  it('borrar el inmueble borra sus fotografías y su material del almacenamiento', async () => {
    const app = await newApp()
    const owner = await withPhotos(app, 2)
    const src = await source(app, owner.cookie, owner.generationId)
    await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 70), { hash: src.sourceHash, version: 0, photoIds: src.photos.map(p => p.id) })
    const before = await objects()
    expect((await app.inject({ method: 'DELETE', url: `/api/properties/${owner.propertyId}`, headers: { cookie: owner.cookie } })).statusCode).toBe(200)
    expect(await objects()).toBe(before - 3)
    expect((await admin.query(`SELECT count(*)::int AS n FROM "StorageCleanup"`)).rows[0].n).toBe(0)
    expect(await mods.findOrphans()).toEqual([])
  })
})

// ------------------------------------------------------------------ DA-51 a DA-55

const putThumb = (app: FastifyInstance, cookie: string, propertyId: string, photoId: string, body: Buffer, type = 'image/jpeg') =>
  app.inject({ method: 'PUT', url: `/api/properties/${propertyId}/photos/${photoId}/thumbnail`, headers: { cookie, 'content-type': type }, payload: body })

const uploadTrack = (app: FastifyInstance, cookie: string, body: Buffer, type: string, name = 'mi pista.wav', rights = 'yes') =>
  app.inject({ method: 'POST', url: '/api/audio-tracks', remoteAddress: ipFor(cookie), headers: { cookie, 'content-type': type, 'x-file-name': encodeURIComponent(name), 'x-rights-confirmed': rights }, payload: body })

const listTracks = async (app: FastifyInstance, cookie: string) => (await app.inject({ url: '/api/audio-tracks', headers: { cookie } })).json()

describe('miniaturas de la galería (DA-51)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await newApp()
  })

  it('guarda la miniatura, la sirve con su propia etiqueta y la retira al sustituir y al borrar la fotografía', async () => {
    const owner = await withPhotos(app, 2)
    const [photo, other] = await listPhotos(app, owner.cookie, owner.propertyId)
    expect((photo as unknown as { thumbUrl: string | null }).thumbUrl).toBeNull()
    const before = await objects()
    const thumb = makeJpeg(480, 360, 9)
    const saved = await putThumb(app, owner.cookie, owner.propertyId, photo.id, thumb)
    expect(saved.statusCode).toBe(200)
    const thumbUrl = saved.json().thumbUrl as string
    expect(thumbUrl).toContain('size=thumb')
    expect(await objects()).toBe(before + 1)
    const served = await app.inject({ url: thumbUrl, headers: { cookie: owner.cookie } })
    expect(served.headers['content-type']).toBe('image/jpeg')
    expect(served.rawPayload.equals(thumb)).toBe(true)
    expect(served.headers.etag).toMatch(/^"t-[0-9a-f]{32}-\d+"$/)
    expect(served.headers['cache-control']).toBe('private, no-cache')
    // Sin miniatura, la URL de miniatura sirve la original.
    expect((await app.inject({ url: `${other.url}&size=thumb`, headers: { cookie: owner.cookie } })).headers['content-type']).toBe('image/png')
    // Sustituir la fotografía retira la miniatura y su archivo.
    const replaced = await app.inject({ method: 'PUT', url: `/api/properties/${owner.propertyId}/photos/${photo.id}/file`, headers: { cookie: owner.cookie, 'content-type': 'image/webp' }, payload: makeWebp(400, 300) })
    expect(replaced.json().thumbUrl).toBeNull()
    expect(await objects()).toBe(before)
    // Una miniatura nueva y después borrar la fotografía: se van los dos archivos.
    expect((await putThumb(app, owner.cookie, owner.propertyId, photo.id, makeJpeg(400, 300, 10))).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/api/properties/${owner.propertyId}/photos/${photo.id}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204)
    expect(await objects()).toBe(before - 1)
    expect((await admin.query(`SELECT count(*)::int AS n FROM "StorageCleanup"`)).rows[0].n).toBe(0)
  })

  it('rechaza miniaturas que no son JPEG, demasiado grandes, de otra proporción o de una fotografía ajena', async () => {
    const owner = await withPhotos(app, 1)
    const intruder = await account()
    const [photo] = await listPhotos(app, owner.cookie, owner.propertyId)
    const before = await objects()
    expect((await putThumb(app, owner.cookie, owner.propertyId, photo.id, makePng(80, 60), 'image/png')).json()).toMatchObject({ code: 'INVALID_FILE' })
    expect((await putThumb(app, owner.cookie, owner.propertyId, photo.id, makeJpeg(960, 720))).json()).toMatchObject({ code: 'INVALID_FILE' })
    expect((await putThumb(app, owner.cookie, owner.propertyId, photo.id, makeJpeg(300, 300))).json()).toMatchObject({ code: 'INVALID_FILE' })
    expect((await putThumb(app, owner.cookie, owner.propertyId, photo.id, makeJpeg(480, 360), 'image/png')).statusCode).toBe(415)
    expect((await putThumb(app, intruder.cookie, owner.propertyId, photo.id, makeJpeg(480, 360))).statusCode).toBe(404)
    expect(await objects()).toBe(before)
  })
})

describe('límites de almacenamiento (DA-51)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await newApp()
  })

  it('suma máxima por inmueble: 100 MB aunque no se hayan alcanzado las 50 fotografías', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    // 25 filas de 4 MB (100 MB) insertadas directamente: el archivo no hace falta para la comprobación.
    for (let i = 0; i < 25; i += 1) {
      await admin.query(
        `INSERT INTO "PropertyPhoto" (id, "propertyId", "storageKey", "contentType", size, width, height, sha256, position, "isPrimary", "updatedAt") VALUES ($1, $2, $3, 'image/jpeg', 4194304, 10, 10, $4, $5, $6, now())`,
        [id('f'), propertyId, `u/${owner.userId}/p/${propertyId}/photos/00000000-0000-4000-8000-${String(i).padStart(12, '0')}.jpg`, i.toString(16).padStart(64, '0'), i, i === 0],
      )
    }
    const before = await objects()
    const response = await upload(app, owner.cookie, propertyId, makePng(30, 30, 777))
    expect(response.statusCode).toBe(409)
    expect(response.json().message).toContain('100 MB')
    expect(await objects()).toBe(before)
  })

  it('cuota por usuario (STORAGE_USER_QUOTA_MB): se rechaza lo que la supera, sin archivos huérfanos', async () => {
    const previous = process.env.STORAGE_USER_QUOTA_MB
    process.env.STORAGE_USER_QUOTA_MB = '10'
    try {
      const owner = await account()
      const { propertyId } = await property(owner.userId)
      const big = (seed: number) => Buffer.concat([makePng(20, 20, seed), Buffer.alloc(3_500_000, seed)])
      expect((await upload(app, owner.cookie, propertyId, big(1))).statusCode).toBe(201)
      expect((await upload(app, owner.cookie, propertyId, big(2))).statusCode).toBe(201)
      const before = await objects()
      const third = await upload(app, owner.cookie, propertyId, big(3))
      expect(third.json()).toMatchObject({ code: 'QUOTA_EXCEEDED' })
      expect(await objects()).toBe(before)
      // También cuenta la biblioteca de audio: una pista que no cabe se rechaza.
      const track = await uploadTrack(app, owner.cookie, Buffer.concat([makeWav(1), Buffer.alloc(0)]), 'audio/wav')
      expect(track.statusCode).toBe(201)
      // 7 MB de fotografías + 4 MB de pista superan los 10 MiB (10 485 760 bytes) de la cuota.
      const heavy = makeWav(250, { sampleRate: 8000 })
      expect(heavy.length).toBeGreaterThan(3_900_000)
      expect((await uploadTrack(app, owner.cookie, heavy, 'audio/wav', 'larga.wav')).json()).toMatchObject({ code: 'QUOTA_EXCEEDED' })
    } finally {
      if (previous === undefined) delete process.env.STORAGE_USER_QUOTA_MB
      else process.env.STORAGE_USER_QUOTA_MB = previous
    }
  })
})

describe('plantillas de cartel y selección aleatoria (DA-52)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await newApp()
  })

  const draw = (cookie: string, generationId: string) => app.inject({ method: 'POST', url: `/api/generations/${generationId}/media/poster/template-draw`, headers: { cookie } })

  it('plantilla elegida a mano: se guarda la plantilla, su versión y el modo manual; las desconocidas se rechazan', async () => {
    const owner = await withPhotos(app, 5)
    const src = await source(app, owner.cookie, owner.generationId)
    const base = { hash: src.sourceHash, version: 0 }
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 1), { ...base, photoIds: [src.photos[0].id], template: 'aleatoria' })).statusCode).toBe(400)
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 1), { ...base, photoIds: [src.photos[0].id], template: '' })).statusCode).toBe(400)
    // Elegante usa una sola fotografía: con tres se rechaza.
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 1), { ...base, photoIds: src.photos.slice(0, 3).map(p => p.id), template: 'elegante' })).statusCode).toBe(400)
    const saved = await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 2), { ...base, photoIds: src.photos.slice(0, 3).map(p => p.id), template: 'editorial' })
    expect(saved.json()).toMatchObject({ templateId: 'editorial', templateName: 'Editorial', templateVersion: 1, selectionMode: 'manual', photoCount: 3 })
    // Regenerar con otra plantilla concreta: se usa exactamente esa.
    const again = await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 3), { ...base, version: 1, photoIds: [src.photos[0].id], template: 'minimalista' })
    expect(again.json()).toMatchObject({ version: 2, templateId: 'minimalista', selectionMode: 'manual' })
    const row = (await admin.query(`SELECT "templateId", "templateVersion", "selectionMode", "photoIds" FROM "ListingMedia" WHERE "generationId" = $1`, [owner.generationId])).rows[0]
    expect(row).toEqual({ templateId: 'minimalista', templateVersion: 1, selectionMode: 'manual', photoIds: JSON.stringify([src.photos[0].id]) })
  })

  it('aleatoria: la API sortea, el cartel se guarda con la plantilla sorteada y el sorteo no se puede reutilizar ni cambiar', async () => {
    const owner = await withPhotos(app, 4)
    const src = await source(app, owner.cookie, owner.generationId)
    const drawn = (await draw(owner.cookie, owner.generationId)).json()
    expect(drawn.templateId).toMatch(/^(elegante|minimalista|editorial|premium|fotografico|moderno)$/)
    expect(drawn.templateVersion).toBe(1)
    const other = ['elegante', 'minimalista', 'editorial', 'premium', 'fotografico', 'moderno'].find(t => t !== drawn.templateId)!
    const base = { hash: src.sourceHash, photoIds: [src.photos[0].id], selection: 'random' as const }
    // Sin sorteo, con la plantilla cambiada o con un identificador inventado: no.
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 1), { ...base, version: 0, template: drawn.templateId })).statusCode).toBe(400)
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 1), { ...base, version: 0, template: other, drawId: drawn.drawId })).statusCode).toBe(400)
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 1), { ...base, version: 0, template: drawn.templateId, drawId: 'c' + 'z'.repeat(24) })).statusCode).toBe(400)
    // Un sorteo hecho a mano no es aleatorio.
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 1), { ...base, version: 0, template: drawn.templateId, drawId: drawn.drawId, selection: 'manual' })).statusCode).toBe(400)
    const saved = await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 2), { ...base, version: 0, template: drawn.templateId, drawId: drawn.drawId })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({ templateId: drawn.templateId, selectionMode: 'random', templateVersion: 1 })
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 3), { ...base, version: 1, template: drawn.templateId, drawId: drawn.drawId })).statusCode).toBe(400)
    // Regenerar con «Aleatoria» hace un sorteo nuevo.
    const second = (await draw(owner.cookie, owner.generationId)).json()
    expect(second.drawId).not.toBe(drawn.drawId)
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 4), { ...base, version: 1, template: second.templateId, drawId: second.drawId })).json()).toMatchObject({ version: 2, selectionMode: 'random', templateId: second.templateId })
  })

  it('un sorteo de otro anuncio o de otra cuenta no sirve; sortear en un anuncio ajeno da 404', async () => {
    const owner = await withPhotos(app, 1)
    const other = await withPhotos(app, 1)
    expect((await draw(other.cookie, owner.generationId)).statusCode).toBe(404)
    expect((await draw('estateforge_session=' + 'b'.repeat(64), owner.generationId)).statusCode).toBe(401)
    const foreign = (await draw(other.cookie, other.generationId)).json()
    const src = await source(app, owner.cookie, owner.generationId)
    const response = await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 9), { hash: src.sourceHash, version: 0, photoIds: [src.photos[0].id], selection: 'random', template: foreign.templateId, drawId: foreign.drawId })
    expect(response.statusCode).toBe(400)
  })

  it('distribución uniforme: con una fuente que recorre todos los valores, cada plantilla sale las mismas veces', async () => {
    const owner = await withPhotos(app, 1)
    let i = 0
    const counts = new Map<string, number>()
    for (let n = 0; n < 60; n += 1) {
      const drawn = await mods.drawPosterTemplate(owner.userId, owner.generationId, size => i++ % size)
      counts.set(drawn.templateId, (counts.get(drawn.templateId) ?? 0) + 1)
    }
    expect([...counts.entries()].sort()).toEqual([['editorial', 10], ['elegante', 10], ['fotografico', 10], ['minimalista', 10], ['moderno', 10], ['premium', 10]])
    // Con la fuente real (crypto.randomInt), todas las plantillas aparecen en 300 sorteos.
    const real = new Set<string>()
    for (let n = 0; n < 300; n += 1) real.add((await mods.drawPosterTemplate(owner.userId, owner.generationId)).templateId)
    expect(real.size).toBe(6)
  })

  it('si falla el guardado de un cartel aleatorio, se conserva el anterior y el sorteo sigue sin usarse', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, photoIds: [src.photos[0].id] }
    await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 1), { ...opts, version: 0, template: 'premium' })
    const drawn = (await draw(owner.cookie, owner.generationId)).json()
    await failOn('ListingMedia', 'UPDATE')
    expect((await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 2), { ...opts, version: 1, template: drawn.templateId, drawId: drawn.drawId, selection: 'random' })).statusCode).toBe(500)
    const media = (await app.inject({ url: `/api/generations/${owner.generationId}/media`, headers: { cookie: owner.cookie } })).json()
    expect(media.poster).toMatchObject({ version: 1, templateId: 'premium', selectionMode: 'manual' })
    expect((await admin.query(`SELECT "usedAt" FROM "MediaTemplateDraw" WHERE id = $1`, [drawn.drawId])).rows[0].usedAt).toBeNull()
  })
})

describe('biblioteca de audio (DA-55)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await newApp()
  })

  it.each([
    ['WAV', makeWav(3), 'audio/wav', 'wav', 3000],
    ['WAV con alias audio/x-wav', makeWav(2, { seed: 7 }), 'audio/x-wav', 'wav', 2000],
    ['MP3', makeMp3(4), 'audio/mpeg', 'mp3', 4000],
    ['Ogg Vorbis', makeOgg(5, 'vorbis'), 'audio/ogg', 'ogg', 5000],
    ['Ogg Opus', makeOgg(6, 'opus'), 'audio/ogg', 'ogg', 6000],
    ['M4A', makeM4a(7), 'audio/x-m4a', 'm4a', 7000],
  ])('sube una pista %s válida con su formato y duración', async (_label, body, type, format, duration) => {
    const owner = await account()
    const response = await uploadTrack(app, owner.cookie, body, type, `pista.${format}`)
    expect(response.statusCode).toBe(201)
    const track = response.json()
    expect(track).toMatchObject({ name: 'pista', format })
    expect(Math.abs(track.durationMs - duration)).toBeLessThanOrEqual(60)
    expect(JSON.stringify(track)).not.toMatch(/storageKey|"u\//)
    const file = await app.inject({ url: track.url, headers: { cookie: owner.cookie } })
    expect(file.rawPayload.equals(body)).toBe(true)
    expect(file.headers).toMatchObject({ 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' })
    expect((await app.inject({ url: track.url, headers: { cookie: owner.cookie, 'if-none-match': file.headers.etag as string } })).statusCode).toBe(304)
  })

  it.each([
    ['tipo falsificado (WAV declarado como MP3)', makeWav(2), 'audio/mpeg', 415],
    ['archivo dañado (WAV truncado)', makeWav(2).subarray(0, 30), 'audio/wav', 400],
    ['imagen declarada como audio', makePng(), 'audio/mpeg', 400],
    ['vídeo declarado como audio', makeVideo('webm', 3), 'audio/ogg', 400],
    ['formato no admitido (FLAC)', Buffer.from('fLaC0000'), 'audio/flac', 415],
    ['demasiado corta', makeWav(0.5), 'audio/wav', 400],
    ['demasiado larga (más de 5 minutos)', makeOgg(301, 'opus'), 'audio/ogg', 413],
    ['más de 4 MB', Buffer.concat([makeMp3(2), Buffer.alloc(4 * 1024 * 1024)]), 'audio/mpeg', 413],
  ])('rechaza %s sin guardar nada', async (_label, body, type, status) => {
    const owner = await account()
    const before = await objects()
    expect((await uploadTrack(app, owner.cookie, body, type)).statusCode).toBe(status)
    expect(await objects()).toBe(before)
    expect((await listTracks(app, owner.cookie)).tracks).toEqual([])
  })

  it('exige la declaración de derechos y no admite duplicados', async () => {
    const owner = await account()
    expect((await uploadTrack(app, owner.cookie, makeWav(2), 'audio/wav', 'a.wav', 'no')).json()).toMatchObject({ code: 'INVALID_REQUEST' })
    expect((await uploadTrack(app, owner.cookie, makeWav(2), 'audio/wav')).statusCode).toBe(201)
    expect((await uploadTrack(app, owner.cookie, makeWav(2), 'audio/wav')).json()).toMatchObject({ code: 'DUPLICATE' })
  })

  it('admite 20 pistas por usuario y rechaza la número 21', async () => {
    const owner = await account()
    for (let i = 0; i < 20; i += 1) expect((await uploadTrack(app, owner.cookie, makeWav(1, { seed: i + 1 }), 'audio/wav', `p${i}.wav`)).statusCode).toBe(201)
    const response = await uploadTrack(app, owner.cookie, makeWav(1, { seed: 99 }), 'audio/wav')
    expect(response.json()).toMatchObject({ code: 'LIMIT_REACHED' })
    expect((await listTracks(app, owner.cookie)).tracks).toHaveLength(20)
  })

  it('cada usuario ve solo su biblioteca; otro no puede escuchar, descargar ni borrar sus pistas', async () => {
    const owner = await account()
    const intruder = await account()
    const track = (await uploadTrack(app, owner.cookie, makeWav(2, { seed: 3 }), 'audio/wav')).json()
    expect((await listTracks(app, intruder.cookie)).tracks).toEqual([])
    expect((await app.inject({ url: track.url, headers: { cookie: intruder.cookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/audio-tracks/${track.id}`, headers: { cookie: intruder.cookie } })).statusCode).toBe(404)
    expect((await app.inject({ url: track.url })).statusCode).toBe(401)
    expect((await app.inject({ url: '/api/audio-tracks' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/audio-tracks', headers: { 'content-type': 'audio/wav' }, payload: makeWav(1) })).statusCode).toBe(401)
    expect((await listTracks(app, owner.cookie)).tracks).toHaveLength(1)
  })

  it('borrar una pista elimina su archivo y no cambia los vídeos que ya la llevan', async () => {
    const owner = await withPhotos(app, 1)
    const track = (await uploadTrack(app, owner.cookie, makeWav(3, { seed: 5 }), 'audio/wav', 'Brisa.wav')).json()
    const src = await source(app, owner.cookie, owner.generationId)
    const video = makeVideo('mp4', 12, { audio: true, seed: 5 })
    const saved = await putMedia(app, owner.cookie, owner.generationId, 'video', video, { hash: src.sourceHash, version: 0, photoIds: [src.photos[0].id], type: 'video/mp4', audio: { source: 'library', track: track.id, volume: 70 } })
    expect(saved.json()).toMatchObject({ hasAudio: true, audioSource: 'library', audioTrackId: track.id, audioName: 'Brisa', audioVolume: 70, audioFadeInMs: 500, audioFadeOutMs: 1500 })
    const before = await objects()
    expect((await app.inject({ method: 'DELETE', url: `/api/audio-tracks/${track.id}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204)
    expect(await objects()).toBe(before - 1)
    const media = (await app.inject({ url: `/api/generations/${owner.generationId}/media`, headers: { cookie: owner.cookie } })).json()
    expect(media.video).toMatchObject({ hasAudio: true, audioName: 'Brisa' })
    expect((await app.inject({ url: media.video.url, headers: { cookie: owner.cookie } })).rawPayload.equals(video)).toBe(true)
  })
})

describe('vídeo con sonido (DA-54)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await newApp()
  })

  it('pista predeterminada: se guarda con audio, volumen y fundidos; una pista inexistente se rechaza', async () => {
    const owner = await withPhotos(app, 2)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, version: 0, photoIds: src.photos.map(p => p.id) }
    expect((await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12, { audio: true }), { ...opts, audio: { source: 'preset', track: 'no-existe' } })).statusCode).toBe(400)
    const saved = await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12, { audio: true }), { ...opts, audio: { source: 'preset', track: 'piano-sereno', volume: 65, fadeIn: 1000, fadeOut: 2000 } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({ hasAudio: true, audioSource: 'preset', audioTrackId: 'piano-sereno', audioName: 'Piano sereno', audioVolume: 65, audioFadeInMs: 1000, audioFadeOutMs: 2000 })
  })

  it('no se guarda un vídeo sin la pista elegida, ni uno con audio declarado como silencioso', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, version: 0, photoIds: [src.photos[0].id] }
    const before = await objects()
    const silent = await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('mp4', 12), { ...opts, type: 'video/mp4', audio: { source: 'preset', track: 'acustico-suave' } })
    expect(silent.json()).toMatchObject({ code: 'INVALID_FILE' })
    expect(silent.json().message).toContain('pista de audio')
    const noisy = await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('mp4', 12, { audio: true }), { ...opts, type: 'video/mp4' })
    expect(noisy.json()).toMatchObject({ code: 'INVALID_FILE' })
    expect(await objects()).toBe(before)
  })

  it('la misma pista personal sirve para vídeos de distintos anuncios; la de otro usuario no', async () => {
    const owner = await withPhotos(app, 1)
    const secondProperty = await property(owner.userId)
    await upload(app, owner.cookie, secondProperty.propertyId, makePng(60, 40, 8181))
    const intruder = await account()
    const mine = (await uploadTrack(app, owner.cookie, makeOgg(8, 'opus', 3), 'audio/ogg', 'sintonía.ogg')).json()
    const theirs = (await uploadTrack(app, intruder.cookie, makeOgg(8, 'opus', 4), 'audio/ogg')).json()
    for (const generationId of [owner.generationId, secondProperty.generationId]) {
      const src = await source(app, owner.cookie, generationId)
      const response = await putMedia(app, owner.cookie, generationId, 'video', makeVideo('webm', 12, { audio: true }), { hash: src.sourceHash, version: 0, photoIds: [src.photos[0].id], audio: { source: 'library', track: mine.id } })
      expect(response.json()).toMatchObject({ audioSource: 'library', audioTrackId: mine.id, audioName: 'sintonía' })
    }
    const src = await source(app, owner.cookie, owner.generationId)
    const foreign = await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12, { audio: true }), { hash: src.sourceHash, version: 1, photoIds: [src.photos[0].id], audio: { source: 'library', track: theirs.id } })
    expect(foreign.statusCode).toBe(404)
  })

  it('cambiar de pista al regenerar: versión nueva, archivo anterior borrado y el cartel intacto', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, photoIds: [src.photos[0].id] }
    await putMedia(app, owner.cookie, owner.generationId, 'poster', makePng(1080, 1350, 5), { ...opts, version: 0 })
    await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12, { audio: true, seed: 1 }), { ...opts, version: 0, audio: { source: 'preset', track: 'hogar-calido' } })
    const before = await objects()
    const changed = await putMedia(app, owner.cookie, owner.generationId, 'video', makeVideo('webm', 12, { seed: 2 }), { ...opts, version: 1, audio: { source: 'none' } })
    expect(changed.json()).toMatchObject({ version: 2, hasAudio: false, audioSource: 'none', audioTrackId: null })
    expect(await objects()).toBe(before)
    const media = (await app.inject({ url: `/api/generations/${owner.generationId}/media`, headers: { cookie: owner.cookie } })).json()
    expect(media.poster.version).toBe(1)
  })

  it('sin sonido no admite pista ni volumen; volumen y fundidos fuera de rango se rechazan', async () => {
    const owner = await withPhotos(app, 1)
    const src = await source(app, owner.cookie, owner.generationId)
    const opts = { hash: src.sourceHash, version: 0, photoIds: [src.photos[0].id] }
    const raw = (headers: Record<string, string>) =>
      app.inject({
        method: 'PUT',
        url: `/api/generations/${owner.generationId}/media/video`,
        headers: { cookie: owner.cookie, 'content-type': 'video/webm', 'x-source-hash': opts.hash, 'x-expected-version': '0', 'x-media-variant': '1', 'x-photo-ids': opts.photoIds.join(','), 'x-media-duration-ms': '12000', ...headers },
        payload: makeVideo('webm', 12, { audio: headers['x-audio-source'] !== 'none' }),
      })
    expect((await raw({ 'x-audio-source': 'none', 'x-audio-track': 'piano-sereno' })).statusCode).toBe(400)
    expect((await raw({ 'x-audio-source': 'preset', 'x-audio-track': 'piano-sereno', 'x-audio-volume': '150', 'x-audio-fade-in-ms': '0', 'x-audio-fade-out-ms': '0' })).statusCode).toBe(400)
    expect((await raw({ 'x-audio-source': 'preset', 'x-audio-track': 'piano-sereno', 'x-audio-volume': '50', 'x-audio-fade-in-ms': '9000', 'x-audio-fade-out-ms': '0' })).statusCode).toBe(400)
    expect((await raw({ 'x-audio-source': 'otra' })).statusCode).toBe(400)
    expect((await raw({ 'x-audio-source': 'preset', 'x-audio-track': 'piano-sereno', 'x-audio-volume': '50', 'x-audio-fade-in-ms': '0', 'x-audio-fade-out-ms': '0', 'x-media-codecs': 'video/webm;codecs=vp9,opus' })).statusCode).toBe(200)
  })
})
