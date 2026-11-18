import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { makeJpeg, makePng } from '../test-support/images.js'
import { makeMp3 } from '../test-support/media-files.js'
import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'
import type { LocalStorage as LocalStorageClass } from '../storage/local-storage.js'

// Limpieza del almacenamiento y ciclo de vida de las subidas directas contra PostgreSQL real, con el
// simulador local de Blob (STORAGE_LOCAL_SIGNED_URLS). Comprueba las garantías del mantenimiento:
// - nunca se borra un archivo que siga referenciado (fotografía, miniatura, material, pista, subida en
//   curso o resultado de IA pendiente de revisión);
// - dos ejecuciones simultáneas (la programada y una manual) no se cuentan fallos que no lo son ni
//   pierden filas de la cola;
// - un fallo parcial del almacenamiento deja solo esa fila pendiente, con el intento anotado;
// - una confirmación en curso no pierde su archivo aunque el intento venza mientras se valida, y
//   cancelar o confirmar a la vez acaba siempre en un estado coherente.
// No usa el servicio real de Vercel Blob.

const CRON_SECRET = 'cron-secret-de-prueba-0123456789abcdef'

let database: TestDatabase
let admin: pg.Client
let root: string
let app: FastifyInstance
let cron: FastifyInstance
let storage: ControlledStorage
let mods: {
  createSession: typeof import('../services/session.service.js')['createSession']
  expireUploads: typeof import('../media/upload.service.js')['expireUploads']
  drain: typeof import('../media/storage-cleanup.js')['drainStorageCleanup']
  processingGraceMs: number
  closeDatabase: () => Promise<void>
}

type ControlledStorage = LocalStorageClass & {
  holdNextGet: () => { reached: Promise<void>; release: () => void }
  failDelete: Set<string>
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
     VALUES ($1, 'Piso de prueba', 'sale', 'apartment', 250000, 'Calle Ficticia 1', 'Madrid', 'Centro', 80, 2, 1, 'good', 'for-sale', '', $2, now())`,
    [propertyId, userId],
  )
  const generationId = id('g')
  await admin.query(
    `INSERT INTO "Generation" (id, title, description, highlights, "callToAction", provider, tone, language, "propertyId", "updatedAt")
     VALUES ($1, 'Anuncio de prueba', 'Texto', '["Uno"]', 'Llama', 'mock', 'professional', 'español', $2, now())`,
    [generationId, propertyId],
  )
  return { propertyId, generationId }
}

const pathOf = (url: string) => {
  const parsed = new URL(url)
  return parsed.pathname + parsed.search
}
const prepare = (cookie: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/uploads', remoteAddress: ipFor(cookie), headers: { cookie, 'content-type': 'application/json' }, payload: body })
const transfer = (prepared: { upload: { url: string; headers: Record<string, string> } }, body: Buffer) =>
  app.inject({ method: 'PUT', url: pathOf(prepared.upload.url), headers: { 'content-type': prepared.upload.headers['Content-Type'] }, payload: body })
const complete = (cookie: string, attemptId: string) => app.inject({ method: 'POST', url: `/api/uploads/${attemptId}/complete`, remoteAddress: ipFor(cookie), headers: { cookie } })
const cancel = (cookie: string, attemptId: string) => app.inject({ method: 'DELETE', url: `/api/uploads/${attemptId}`, remoteAddress: ipFor(cookie), headers: { cookie } })

/** Prepara y envía una fotografía; devuelve el intento pendiente (sin confirmar) y su clave. */
async function uploaded(cookie: string, propertyId: string, seed: number) {
  const image = makePng(40 + (seed % 50), 30, seed)
  const prepared = (await prepare(cookie, { kind: 'photo', contentType: 'image/png', size: image.length, propertyId })).json() as { attemptId: string; upload: { url: string; headers: Record<string, string> } }
  expect((await transfer(prepared, image)).statusCode).toBe(200)
  const key = (await admin.query(`SELECT "storageKey" FROM "UploadAttempt" WHERE id = $1`, [prepared.attemptId])).rows[0].storageKey as string
  return { attemptId: prepared.attemptId, key }
}

const exists = async (key: string) => (await storage.head(key)) !== null
const queued = async (key: string) => (await admin.query(`SELECT attempts, "lastError" FROM "StorageCleanup" WHERE "storageKey" = $1`, [key])).rows[0] ?? null
const queueSize = async () => (await admin.query(`SELECT count(*)::int AS n FROM "StorageCleanup"`)).rows[0].n as number

/** Archivo sin referencia en la cola, como lo dejan los triggers tras un borrado o una sustitución. */
async function orphanQueued(userId: string, propertyId: string): Promise<string> {
  const key = `u/${userId}/p/${propertyId}/photos/${crypto.randomUUID()}.png`
  await storage.put(key, makePng(10, 10, 1))
  await admin.query(`INSERT INTO "StorageCleanup" ("storageKey", reason) VALUES ($1, 'test:orphan')`, [key])
  return key
}

const runCron = () => cron.inject({ method: 'GET', url: '/api/internal/cron/storage-cleanup', headers: { authorization: `Bearer ${CRON_SECRET}`, 'user-agent': 'vercel-cron/1.0' } })

beforeAll(async () => {
  database = await createTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'ef-storage-maint-'))
  vi.stubEnv('DATABASE_URL', database.url)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  vi.resetModules()
  const { LocalStorage } = await import('../storage/local-storage.js')
  const { LocalSigner } = await import('../storage/local-signer.js')

  // Simulador local con dos controles de prueba: detener la siguiente lectura (para intercalar otra
  // operación mientras se valida una subida) y hacer fallar el borrado de claves concretas.
  class Controlled extends LocalStorage {
    failDelete = new Set<string>()
    private gate: { reached: () => void; wait: Promise<void> } | null = null
    holdNextGet() {
      let reached!: () => void
      let release!: () => void
      const reachedPromise = new Promise<void>(resolve => (reached = resolve))
      const wait = new Promise<void>(resolve => (release = resolve))
      this.gate = { reached, wait }
      return { reached: reachedPromise, release }
    }
    override async get(key: string, range?: { start: number; end: number }) {
      const gate = this.gate
      if (gate) {
        this.gate = null
        gate.reached()
        await gate.wait
      }
      return super.get(key, range)
    }
    override async delete(key: string) {
      if (this.failDelete.has(key)) throw new Error('fallo simulado del almacenamiento')
      return super.delete(key)
    }
  }
  storage = new Controlled(root, { signer: new LocalSigner('http://localhost'), directTransfers: true }) as ControlledStorage
  ;(await import('../storage/object-storage.js')).setStorageForTests(storage)
  const upload = await import('../media/upload.service.js')
  mods = {
    createSession: (await import('../services/session.service.js')).createSession,
    expireUploads: upload.expireUploads,
    drain: (await import('../media/storage-cleanup.js')).drainStorageCleanup,
    processingGraceMs: upload.UPLOAD_PROCESSING_GRACE_MS,
    closeDatabase: (await import('../db/prisma.js')).closeDatabase,
  }
  app = await (await import('../app.js')).buildApp()
  await app.ready()
  const { maintenanceRoutes } = await import('../routes/maintenance.routes.js')
  cron = Fastify()
  await cron.register(maintenanceRoutes, { env: { CRON_SECRET } })
  await cron.ready()
})

afterAll(async () => {
  await cron.close()
  await app.close()
  await mods.closeDatabase()
  await admin.end()
  vi.unstubAllEnvs()
  await database.drop()
  rmSync(root, { recursive: true, force: true })
})

describe('la cola de limpieza nunca borra un archivo referenciado', () => {
  it('fotografía, miniatura, pista, subida en curso, material y resultado de IA pendiente: se conservan y salen de la cola', async () => {
    const owner = await account()
    const { propertyId, generationId } = await property(owner.userId)

    // Fotografía confirmada y su miniatura.
    // Semilla 50: 40 × 30, la misma proporción que la miniatura.
    const photo = await uploaded(owner.cookie, propertyId, 50)
    const done = await complete(owner.cookie, photo.attemptId)
    expect(done.statusCode).toBe(200)
    const photoId = done.json().photo.id as string
    const thumbBody = makeJpeg(40, 30, 2)
    const thumb = (await prepare(owner.cookie, { kind: 'thumbnail', contentType: 'image/jpeg', size: thumbBody.length, propertyId, photoId })).json()
    expect((await transfer(thumb, thumbBody)).statusCode).toBe(200)
    expect((await complete(owner.cookie, thumb.attemptId)).statusCode).toBe(200)
    const thumbKey = (await admin.query(`SELECT "thumbKey" FROM "PropertyPhoto" WHERE id = $1`, [photoId])).rows[0].thumbKey as string

    // Pista de audio confirmada.
    const mp3 = makeMp3(2, { seed: 4 })
    const track = (await prepare(owner.cookie, { kind: 'audio', contentType: 'audio/mpeg', size: mp3.length, fileName: 'pista.mp3', rightsConfirmed: true })).json()
    expect((await transfer(track, mp3)).statusCode).toBe(200)
    expect((await complete(owner.cookie, track.attemptId)).statusCode).toBe(200)
    const trackKey = (await admin.query(`SELECT "storageKey" FROM "AudioTrack" WHERE "userId" = $1`, [owner.userId])).rows[0].storageKey as string

    // Subida enviada pero todavía sin confirmar (vigente).
    const pending = await uploaded(owner.cookie, propertyId, 5)

    // Material guardado y resultado de IA listo para revisión (filas mínimas válidas).
    const mediaKey = `u/${owner.userId}/g/${generationId}/poster/${crypto.randomUUID()}.png`
    await storage.put(mediaKey, makePng(20, 25, 6))
    await admin.query(
      `INSERT INTO "ListingMedia" (id, "generationId", kind, "storageKey", "contentType", size, width, height, variant, "sourceHash", "photoIds", "updatedAt")
       VALUES ($1, $2, 'poster', $3, 'image/png', 100, 20, 25, 0, $4, '[]', now())`,
      [id('m'), generationId, mediaKey, 'a'.repeat(64)],
    )
    const aiKey = `u/${owner.userId}/g/${generationId}/ai/${crypto.randomUUID()}.png`
    await storage.put(aiKey, makePng(20, 25, 7))
    await admin.query(
      `INSERT INTO "AiMediaJob" (id, "userId", "generationId", "propertyId", kind, provider, model, status, "idempotencyKey", "sourceHash", "expectedVersion", "resultKey", "resultContentType", "resultSize", "moderationStatus", "updatedAt")
       VALUES ($1, $2, $3, $4, 'poster', 'simulator', 'sim', 'ready', $5, $6, 0, $7, 'image/png', 100, 'passed', now())`,
      [id('j'), owner.userId, generationId, propertyId, id('k'), 'b'.repeat(64), aiKey],
    )

    const referenced = [photo.key, thumbKey, trackKey, pending.key, mediaKey, aiKey]
    for (const key of referenced) await admin.query(`INSERT INTO "StorageCleanup" ("storageKey", reason) VALUES ($1, 'test:referenced') ON CONFLICT DO NOTHING`, [key])
    const orphan = await orphanQueued(owner.userId, propertyId)

    const result = await mods.drain(null, [...referenced, orphan], 50)
    expect(result).toEqual({ deleted: referenced.length + 1, failed: 0 })
    for (const key of referenced) {
      expect(await exists(key)).toBe(true)
      expect(await queued(key)).toBeNull()
    }
    expect(await exists(orphan)).toBe(false)
    // La subida pendiente se puede seguir confirmando.
    expect((await complete(owner.cookie, pending.attemptId)).statusCode).toBe(200)
  })
})

describe('ejecuciones simultáneas y fallos parciales', () => {
  it('dos limpiezas a la vez sobre las mismas filas: cada archivo se borra una vez y no se cuentan fallos', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const keys = await Promise.all(Array.from({ length: 12 }, () => orphanQueued(owner.userId, propertyId)))
    const [a, b] = await Promise.all([mods.drain(null, keys, 50), mods.drain(null, keys, 50)])
    expect(a.failed + b.failed).toBe(0)
    expect(a.deleted + b.deleted).toBe(keys.length)
    for (const key of keys) {
      expect(await exists(key)).toBe(false)
      expect(await queued(key)).toBeNull()
    }
  })

  it('un borrado que falla deja solo esa fila pendiente, con el intento y el nombre del error; la siguiente ejecución la completa', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const [broken, ...rest] = await Promise.all(Array.from({ length: 4 }, () => orphanQueued(owner.userId, propertyId)))
    storage.failDelete.add(broken)
    try {
      expect(await mods.drain(null, [broken, ...rest], 50)).toEqual({ deleted: 3, failed: 1 })
      expect(await queued(broken)).toEqual({ attempts: 1, lastError: 'Error' })
      expect(await exists(broken)).toBe(true)
      for (const key of rest) expect(await queued(key)).toBeNull()
    } finally {
      storage.failDelete.delete(broken)
    }
    expect(await mods.drain(null, [broken], 50)).toEqual({ deleted: 1, failed: 0 })
    expect(await exists(broken)).toBe(false)
  })

  it('mantenimiento programado y manual a la vez: ambos 200, contadores coherentes y cola vacía', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    await admin.query(`DELETE FROM "StorageCleanup"`)
    const keys = await Promise.all(Array.from({ length: 30 }, () => orphanQueued(owner.userId, propertyId)))
    const [first, second] = await Promise.all([runCron(), runCron()])
    expect([first.statusCode, second.statusCode]).toEqual([200, 200])
    for (const response of [first, second]) {
      expect(response.headers['cache-control']).toBe('no-store')
      expect(Object.keys(response.json()).sort()).toEqual(['auditDeleted', 'deleted', 'failed', 'status'])
    }
    expect(first.json().failed + second.json().failed).toBe(0)
    expect(first.json().deleted + second.json().deleted).toBe(keys.length)
    expect(await queueSize()).toBe(0)
    for (const key of keys) expect(await exists(key)).toBe(false)
  })

  it('cada ejecución autorizada deja una fila MaintenanceRun con su disparador; una petición sin secreto, ninguna', async () => {
    await admin.query(`DELETE FROM "MaintenanceRun"`)
    expect((await runCron()).statusCode).toBe(200)
    expect((await cron.inject({ method: 'GET', url: '/api/internal/cron/storage-cleanup', headers: { authorization: `Bearer ${CRON_SECRET}`, 'user-agent': 'curl/8.9.1' } })).statusCode).toBe(200)
    expect((await cron.inject({ method: 'GET', url: '/api/internal/cron/storage-cleanup', headers: { 'user-agent': 'vercel-cron/1.0' } })).statusCode).toBe(401)
    const rows = (await admin.query(`SELECT trigger, status, "storageDeleted", "storageFailed", "auditDeleted", "queuePending", "durationMs" >= 0 AS timed, "finishedAt" >= "startedAt" AS ordered FROM "MaintenanceRun" ORDER BY "startedAt"`)).rows
    expect(rows).toEqual([
      { trigger: 'vercel-cron', status: 'ok', storageDeleted: 0, storageFailed: 0, auditDeleted: 0, queuePending: 0, timed: true, ordered: true },
      { trigger: 'manual', status: 'ok', storageDeleted: 0, storageFailed: 0, auditDeleted: 0, queuePending: 0, timed: true, ordered: true },
    ])
    // La restricción de la tabla rechaza valores fuera de lo previsto.
    await expect(admin.query(`INSERT INTO "MaintenanceRun" (id, trigger, status, "durationMs", "startedAt") VALUES ('x', 'otro', 'ok', 0, now())`)).rejects.toThrow(/MaintenanceRun_values_allowed/)
  })

  it('el lote de una ejecución está acotado a 50: lo que queda se procesa en la siguiente', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    await admin.query(`DELETE FROM "StorageCleanup"`)
    await Promise.all(Array.from({ length: 55 }, () => orphanQueued(owner.userId, propertyId)))
    expect((await runCron()).json()).toMatchObject({ status: 'ok', deleted: 50, failed: 0 })
    expect(await queueSize()).toBe(5)
    expect((await runCron()).json()).toMatchObject({ status: 'ok', deleted: 5, failed: 0 })
    expect(await queueSize()).toBe(0)
  })
})

describe('confirmación, cancelación y caducidad a la vez', () => {
  it('una confirmación en curso conserva su archivo aunque el intento venza mientras se valida', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const { attemptId, key } = await uploaded(owner.cookie, propertyId, 21)
    const hold = storage.holdNextGet()
    const confirming = complete(owner.cookie, attemptId)
    await hold.reached
    // Mientras la API lee el archivo, el plazo vence y otra petición del usuario caduca sus intentos.
    await admin.query(`UPDATE "UploadAttempt" SET "expiresAt" = now() - interval '1 second' WHERE id = $1`, [attemptId])
    await mods.expireUploads(null)
    hold.release()
    const done = await confirming
    expect(done.statusCode).toBe(200)
    expect(await exists(key)).toBe(true)
    expect(await queued(key)).toBeNull()
    expect((await admin.query(`SELECT status FROM "UploadAttempt" WHERE id = $1`, [attemptId])).rows[0].status).toBe('completed')
    expect((await admin.query(`SELECT "storageKey" FROM "PropertyPhoto" WHERE id = $1`, [done.json().photo.id])).rows[0].storageKey).toBe(key)
  })

  it('una confirmación que quedó colgada caduca pasado el margen y su archivo se limpia', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const { attemptId, key } = await uploaded(owner.cookie, propertyId, 22)
    await admin.query(`UPDATE "UploadAttempt" SET status = 'processing', "expiresAt" = now() - make_interval(secs => $2::double precision) WHERE id = $1`, [attemptId, mods.processingGraceMs / 1000 + 1])
    expect(await mods.expireUploads(null)).toBeGreaterThanOrEqual(1)
    expect((await admin.query(`SELECT status FROM "UploadAttempt" WHERE id = $1`, [attemptId])).rows[0].status).toBe('expired')
    expect(await exists(key)).toBe(false)
  })

  it('si el intento deja de estar en curso antes de guardar, la confirmación responde un error controlado, no 500', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const { attemptId, key } = await uploaded(owner.cookie, propertyId, 23)
    const hold = storage.holdNextGet()
    const confirming = complete(owner.cookie, attemptId)
    await hold.reached
    // Cierre externo (por ejemplo, el borrado de la cuenta o una intervención manual) mientras se valida.
    await admin.query(`UPDATE "UploadAttempt" SET status = 'expired' WHERE id = $1`, [attemptId])
    hold.release()
    const done = await confirming
    expect(done.statusCode).toBe(410)
    expect(done.json()).toMatchObject({ code: 'UPLOAD_EXPIRED' })
    expect((await admin.query(`SELECT count(*)::int AS n FROM "PropertyPhoto" WHERE "propertyId" = $1`, [propertyId])).rows[0].n).toBe(0)
    // El archivo, que nadie referencia, se limpia.
    expect(await exists(key)).toBe(false)
  })

  it('cancelar y confirmar a la vez: o hay fotografía con su archivo o no hay ninguna de las dos (20 repeticiones)', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    for (let round = 0; round < 20; round += 1) {
      const { attemptId, key } = await uploaded(owner.cookie, propertyId, 100 + round)
      const [confirmed, cancelled] = await Promise.all([complete(owner.cookie, attemptId), cancel(owner.cookie, attemptId)])
      expect(cancelled.statusCode).toBe(204)
      const status = (await admin.query(`SELECT status FROM "UploadAttempt" WHERE id = $1`, [attemptId])).rows[0].status
      const photos = (await admin.query(`SELECT count(*)::int AS n FROM "PropertyPhoto" WHERE "storageKey" = $1`, [key])).rows[0].n
      if (status === 'completed') {
        expect(confirmed.statusCode).toBe(200)
        expect(photos).toBe(1)
        expect(await exists(key)).toBe(true)
      } else {
        expect(status).toBe('cancelled')
        expect(confirmed.statusCode).not.toBe(500)
        expect(photos).toBe(0)
        expect(await exists(key)).toBe(false)
      }
      expect(await queued(key)).toBeNull()
    }
  })

  it('dos confirmaciones simultáneas: una sola fotografía y ninguna respuesta 500', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const { attemptId } = await uploaded(owner.cookie, propertyId, 31)
    const responses = await Promise.all([complete(owner.cookie, attemptId), complete(owner.cookie, attemptId), complete(owner.cookie, attemptId)])
    expect(responses.every(r => r.statusCode === 200 || r.json().code === 'VERSION_CONFLICT')).toBe(true)
    expect(responses.some(r => r.statusCode === 200)).toBe(true)
    expect((await admin.query(`SELECT count(*)::int AS n FROM "PropertyPhoto" WHERE "propertyId" = $1`, [propertyId])).rows[0].n).toBe(1)
  })
})

describe('contrato del almacenamiento (simulador local de Blob)', () => {
  const withQuota = async (mb: string, run: () => Promise<void>) => {
    const previous = process.env.STORAGE_USER_QUOTA_MB
    process.env.STORAGE_USER_QUOTA_MB = mb
    try {
      await run()
    } finally {
      if (previous === undefined) delete process.env.STORAGE_USER_QUOTA_MB
      else process.env.STORAGE_USER_QUOTA_MB = previous
    }
  }
  const reservedAndUsed = async (userId: string) =>
    Number(
      (await admin.query(
        `SELECT (SELECT COALESCE(SUM(size), 0) FROM "UploadAttempt" WHERE "userId" = $1 AND status IN ('pending', 'processing') AND "expiresAt" > now())
              + (SELECT COALESCE(SUM(f.size + COALESCE(f."thumbSize", 0)), 0) FROM "PropertyPhoto" f JOIN "Property" p ON p.id = f."propertyId" WHERE p."userId" = $1)
              + (SELECT COALESCE(SUM(size), 0) FROM "AudioTrack" WHERE "userId" = $1) AS total`,
        [userId],
      )).rows[0].total,
    )

  it('cuota con subidas simultáneas de distinto tipo y en dos inmuebles: nunca se supera', async () => {
    await withQuota('10', async () => {
      const owner = await account()
      const first = await property(owner.userId)
      const second = await property(owner.userId)
      const big = 3_500_000
      const requests = [
        ...Array.from({ length: 4 }, () => ({ kind: 'photo', contentType: 'image/png', size: big, propertyId: first.propertyId })),
        ...Array.from({ length: 4 }, () => ({ kind: 'photo', contentType: 'image/jpeg', size: big, propertyId: second.propertyId })),
        ...Array.from({ length: 4 }, () => ({ kind: 'audio', contentType: 'audio/mpeg', size: big, fileName: 'p.mp3', rightsConfirmed: true })),
      ]
      const results = await Promise.all(requests.map(body => prepare(owner.cookie, body)))
      // 10 MB / 3,5 MB: caben dos reservas; el resto se rechaza por cuota, no por otro motivo.
      expect(results.filter(r => r.statusCode === 201)).toHaveLength(2)
      expect(results.filter(r => r.statusCode !== 201).every(r => r.json().code === 'QUOTA_EXCEEDED')).toBe(true)
      expect(await reservedAndUsed(owner.userId)).toBeLessThanOrEqual(10 * 1024 * 1024)
    })
  })

  it('dos confirmaciones simultáneas dentro de la cuota: ambas se guardan y el total no la supera', async () => {
    await withQuota('10', async () => {
      const owner = await account()
      const { propertyId } = await property(owner.userId)
      const one = await uploaded(owner.cookie, propertyId, 61)
      const two = await uploaded(owner.cookie, propertyId, 62)
      const [x, y] = await Promise.all([complete(owner.cookie, one.attemptId), complete(owner.cookie, two.attemptId)])
      expect([x.statusCode, y.statusCode]).toEqual([200, 200])
      expect(await reservedAndUsed(owner.userId)).toBeLessThanOrEqual(10 * 1024 * 1024)
    })
  })

  it('la URL de lectura firmada se puede reutilizar hasta que caduca (no es de un solo uso) y después se rechaza', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const { attemptId, key } = await uploaded(owner.cookie, propertyId, 63)
    const photo = (await complete(owner.cookie, attemptId)).json().photo
    const access = await app.inject({ url: `${photo.url}&as=url`, remoteAddress: ipFor(owner.cookie), headers: { cookie: owner.cookie } })
    expect(access.headers['cache-control']).toBe('private, no-store')
    const signed = pathOf(access.json().url)
    const reads = await Promise.all([app.inject({ url: signed }), app.inject({ url: signed }), app.inject({ url: signed })])
    expect(reads.map(r => r.statusCode)).toEqual([200, 200, 200])
    for (const read of reads) {
      expect(read.headers['cache-control']).toMatch(/^private, max-age=\d+$/)
      expect(read.headers['x-content-type-options']).toBe('nosniff')
    }
    const expired = storage.signer!.sign({ op: 'get', key, exp: Date.now() - 1 })
    expect((await app.inject({ url: pathOf(expired) })).statusCode).toBe(403)
  })

  it('Range: válidos (206), fuera del archivo (416) y mal formados (se ignoran: 200 completo)', async () => {
    const key = `u/${id('u')}/g/${id('g')}/video/00000000-0000-4000-8000-00000000beef.mp4`
    const body = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
    await storage.put(key, body)
    const url = pathOf(storage.signer!.sign({ op: 'get', key, exp: Date.now() + 60_000 }))
    const get = (range: string) => app.inject({ url, headers: { range } })
    const valid = await get('bytes=10-19')
    expect(valid.statusCode).toBe(206)
    expect(valid.headers['content-range']).toBe('bytes 10-19/1000')
    expect(valid.headers['content-length']).toBe('10')
    expect(valid.rawPayload.equals(body.subarray(10, 20))).toBe(true)
    expect((await get('bytes=990-5000')).headers['content-range']).toBe('bytes 990-999/1000')
    expect((await get('bytes=-2000')).rawPayload.equals(body)).toBe(true)
    for (const unsatisfiable of ['bytes=1000-', 'bytes=1500-1600', 'bytes=-0', 'bytes=20-10']) {
      const response = await get(unsatisfiable)
      expect(response.statusCode, unsatisfiable).toBe(416)
      expect(response.headers['content-range']).toBe('bytes */1000')
    }
    // Sintaxis no válida o varios rangos: el servidor puede ignorar Range y enviar el archivo completo.
    for (const ignored of ['bytes=-', 'bytes=abc', 'items=0-10', 'bytes=0-1,5-6', 'bytes= 0-1']) {
      const response = await get(ignored)
      expect(response.statusCode, ignored).toBe(200)
      expect(response.headers['content-range'], ignored).toBeUndefined()
      expect(response.rawPayload.equals(body), ignored).toBe(true)
    }
  })

  it('sustituir una fotografía borra su archivo y su miniatura anteriores; borrarla, los dos; borrar el inmueble, todo', async () => {
    const owner = await account()
    const { propertyId } = await property(owner.userId)
    const first = await uploaded(owner.cookie, propertyId, 50)
    const photoId = (await complete(owner.cookie, first.attemptId)).json().photo.id as string
    const thumb = makeJpeg(40, 30, 9)
    const t = (await prepare(owner.cookie, { kind: 'thumbnail', contentType: 'image/jpeg', size: thumb.length, propertyId, photoId })).json()
    await transfer(t, thumb)
    expect((await complete(owner.cookie, t.attemptId)).statusCode).toBe(200)
    const oldThumb = (await admin.query(`SELECT "thumbKey" FROM "PropertyPhoto" WHERE id = $1`, [photoId])).rows[0].thumbKey as string

    const replacement = makePng(80, 60, 64)
    const r = (await prepare(owner.cookie, { kind: 'photo-replace', contentType: 'image/png', size: replacement.length, propertyId, photoId })).json()
    await transfer(r, replacement)
    expect((await complete(owner.cookie, r.attemptId)).statusCode).toBe(200)
    const newKey = (await admin.query(`SELECT "storageKey" FROM "PropertyPhoto" WHERE id = $1`, [photoId])).rows[0].storageKey as string
    expect(await exists(first.key)).toBe(false)
    expect(await exists(oldThumb)).toBe(false)
    expect(await exists(newKey)).toBe(true)

    const other = await uploaded(owner.cookie, propertyId, 65)
    expect((await complete(owner.cookie, other.attemptId)).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/api/properties/${propertyId}/photos/${photoId}`, remoteAddress: ipFor(owner.cookie), headers: { cookie: owner.cookie } })).statusCode).toBe(204)
    expect(await exists(newKey)).toBe(false)
    expect(await exists(other.key)).toBe(true)

    expect((await app.inject({ method: 'DELETE', url: `/api/properties/${propertyId}`, remoteAddress: ipFor(owner.cookie), headers: { cookie: owner.cookie } })).statusCode).toBe(200)
    expect(await exists(other.key)).toBe(false)
    expect(await storage.list(`u/${owner.userId}/p/${propertyId}/`)).toEqual([])
    expect(await queued(other.key)).toBeNull()
  })
})
