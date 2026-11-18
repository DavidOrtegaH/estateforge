import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ruta de Vercel Cron para la cola StorageCleanup. Sin base de datos ni almacenamiento reales:
// Prisma y el almacenamiento son dobles, y nunca se ejecuta una limpieza real.

const fake = vi.hoisted(() => {
  const queue: { id: string; storageKey: string }[] = []
  const referenced = new Set<string>()
  const countFor = (field: string) => vi.fn(async (args: { where: Record<string, unknown> }) => (referenced.has(String(args.where[field])) ? 1 : 0))
  const prisma = {
    storageCleanup: {
      findMany: vi.fn(async (args: { take: number }) => queue.slice(0, args.take)),
      // drainStorageCleanup retira cada fila con deleteMany (una ejecución simultánea pudo retirarla ya).
      deleteMany: vi.fn(async () => ({ count: 1 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => queue.length),
    },
    propertyPhoto: { count: vi.fn(async (args: { where: Record<string, unknown> }) => (referenced.has(String(args.where.storageKey ?? args.where.thumbKey)) ? 1 : 0)) },
    listingMedia: { count: countFor('storageKey') },
    audioTrack: { count: countFor('storageKey') },
    uploadAttempt: { count: countFor('storageKey') },
    aiMediaJob: { count: countFor('resultKey') },
    maintenanceRun: { create: vi.fn(async () => ({ id: 'run' })) },
    user: { delete: vi.fn(), deleteMany: vi.fn() },
    session: { deleteMany: vi.fn() },
    adminAuditLog: { deleteMany: vi.fn() },
  }
  const storage = { delete: vi.fn(async () => undefined), list: vi.fn(async () => [] as string[]) }
  return { queue, referenced, prisma, storage }
})

vi.mock('../db/prisma.js', () => ({ prisma: fake.prisma }))
vi.mock('../storage/object-storage.js', () => ({ getStorage: async () => fake.storage }))

import {
  CRON_SECRET_MIN_LENGTH,
  configuredCronSecret,
  cronAuthorizationMatches,
  maintenanceRoutes,
  type MaintenanceRoutesOptions,
  STORAGE_CLEANUP_CRON_BATCH,
  STORAGE_CLEANUP_CRON_PATH,
} from './maintenance.routes.js'
import { AUDIT_RETENTION_BATCH, AUDIT_RETENTION_MAX_BATCH } from '../services/audit-retention.service.js'

const SECRET = 'cron-secret-de-prueba-0123456789'

// La retención de auditoría es un doble en todas las pruebas de esta ruta: nunca se borra nada real.
// Su lógica se prueba en audit-retention.service.test.ts y en la integración con PostgreSQL efímero.
const purgeAuditSpy = vi.fn(async (_options: { batchSize: number }) => ({ deleted: 0 }))

async function appWith(env: NodeJS.ProcessEnv, drain?: MaintenanceRoutesOptions['drain'], purgeAudit: MaintenanceRoutesOptions['purgeAudit'] = purgeAuditSpy) {
  const app = Fastify()
  await app.register(maintenanceRoutes, { env, drain, purgeAudit })
  await app.ready()
  return app
}

const drainSpy = () => vi.fn(async () => ({ deleted: 0, failed: 0 }))

beforeEach(() => {
  fake.queue.length = 0
  fake.referenced.clear()
  vi.clearAllMocks()
})

describe('autenticación de la limpieza programada', () => {
  it('sin CRON_SECRET responde 503 y no ejecuta nada, aunque la cabecera coincida con un valor vacío', async () => {
    const drain = drainSpy()
    const app = await appWith({}, drain)

    for (const authorization of [undefined, 'Bearer ', 'Bearer undefined']) {
      const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: authorization === undefined ? {} : { authorization } })
      expect(response.statusCode).toBe(503)
    }
    expect(drain).not.toHaveBeenCalled()
  })

  it('un CRON_SECRET demasiado corto o solo con espacios se trata como ausente', async () => {
    expect(configuredCronSecret({ CRON_SECRET: 'a'.repeat(CRON_SECRET_MIN_LENGTH - 1) })).toBeNull()
    expect(configuredCronSecret({ CRON_SECRET: ' '.repeat(40) })).toBeNull()
    expect(configuredCronSecret({ CRON_SECRET: SECRET })).toBe(SECRET)

    const drain = drainSpy()
    const app = await appWith({ CRON_SECRET: 'corto' }, drain)
    const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: 'Bearer corto' } })
    expect(response.statusCode).toBe(503)
    expect(drain).not.toHaveBeenCalled()
  })

  it('sin cabecera, con otro esquema, con otro secreto o con variaciones responde 401 sin ejecutar nada', async () => {
    const drain = drainSpy()
    const app = await appWith({ CRON_SECRET: SECRET }, drain)

    const attempts: Record<string, string>[] = [
      {},
      { authorization: SECRET },
      { authorization: `Basic ${SECRET}` },
      { authorization: `bearer ${SECRET}` },
      { authorization: `Bearer ${SECRET} ` },
      { authorization: `Bearer ${SECRET.slice(0, -1)}` },
      { authorization: `Bearer ${SECRET}x` },
      { authorization: 'Bearer otro-secreto-cualquiera-123456' },
    ]
    for (const headers of attempts) {
      const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers })
      expect(response.statusCode).toBe(401)
      expect(response.body).not.toContain(SECRET)
    }
    expect(drain).not.toHaveBeenCalled()
  })

  it('solo acepta GET (el método de Vercel Cron)', async () => {
    const drain = drainSpy()
    const app = await appWith({ CRON_SECRET: SECRET }, drain)
    const response = await app.inject({ method: 'POST', url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })
    expect(response.statusCode).toBe(404)
    expect(drain).not.toHaveBeenCalled()
  })

  it('la comparación acepta solo la cabecera exacta, de cualquier longitud, sin lanzar', () => {
    expect(cronAuthorizationMatches(`Bearer ${SECRET}`, SECRET)).toBe(true)
    // Longitudes distintas: timingSafeEqual lanzaría con buffers desiguales; los resúmenes lo evitan.
    expect(cronAuthorizationMatches('Bearer x', SECRET)).toBe(false)
    expect(cronAuthorizationMatches(`Bearer ${SECRET}${'x'.repeat(10_000)}`, SECRET)).toBe(false)
    expect(cronAuthorizationMatches(undefined, SECRET)).toBe(false)
    expect(cronAuthorizationMatches(['Bearer', SECRET], SECRET)).toBe(false)
  })

  it('con el secreto correcto delega un único lote acotado de la cola, sin claves concretas', async () => {
    const drain = vi.fn(async () => ({ deleted: 3, failed: 1 }))
    const app = await appWith({ CRON_SECRET: SECRET }, drain)

    const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ status: 'ok', deleted: 3, failed: 1, auditDeleted: 0 })
    expect(drain).toHaveBeenCalledTimes(1)
    expect(drain).toHaveBeenCalledWith(expect.anything(), undefined, STORAGE_CLEANUP_CRON_BATCH)
    expect(STORAGE_CLEANUP_CRON_BATCH).toBeLessThanOrEqual(200)
  })

  it('un error inesperado responde 500 sin detalles y no impide la retención de auditoría', async () => {
    const drain = vi.fn(async () => { throw new Error('postgresql://usuario:secreto@db/x') })
    const app = await appWith({ CRON_SECRET: SECRET }, drain)

    const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toMatch(/secreto|postgresql/)
    expect(purgeAuditSpy).toHaveBeenCalledTimes(1)
  })

  it('sin autorización (o sin CRON_SECRET) no ejecuta la retención de auditoría', async () => {
    const unconfigured = await appWith({})
    await unconfigured.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })
    const configured = await appWith({ CRON_SECRET: SECRET })
    await configured.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: 'Bearer incorrecto-0123456789abcdef' } })
    await configured.inject({ url: STORAGE_CLEANUP_CRON_PATH })

    expect(purgeAuditSpy).not.toHaveBeenCalled()
  })
})

describe('retención de AdminAuditLog en el mantenimiento diario', () => {
  it('ejecuta un único lote acotado y devuelve solo el recuento', async () => {
    const purge = vi.fn(async () => ({ deleted: 7 }))
    const app = await appWith({ CRON_SECRET: SECRET }, drainSpy(), purge)

    const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', deleted: 0, failed: 0, auditDeleted: 7 })
    expect(purge).toHaveBeenCalledTimes(1)
    expect(purge).toHaveBeenCalledWith({ batchSize: AUDIT_RETENTION_BATCH })
    expect(AUDIT_RETENTION_BATCH).toBeLessThanOrEqual(AUDIT_RETENTION_MAX_BATCH)
  })

  it('un fallo de la retención responde 500 sin datos y la limpieza de archivos sí se ejecuta', async () => {
    const drain = drainSpy()
    const purge = vi.fn(async () => { throw new Error('DELETE … usuario@example.test postgresql://u:secreto@db/x') })
    const app = await appWith({ CRON_SECRET: SECRET }, drain, purge)

    const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ status: 'error' })
    expect(response.body).not.toMatch(/usuario|secreto|postgresql|DELETE/)
    expect(drain).toHaveBeenCalledTimes(1)
  })
})

describe('delegación en drainStorageCleanup (mecanismo existente, dobles de Prisma y almacenamiento)', () => {
  it('lee solo la cola StorageCleanup con el lote acotado y no borra archivos que sigan referenciados', async () => {
    fake.queue.push({ id: 'c1', storageKey: 'u/libre.jpg' }, { id: 'c2', storageKey: 'u/referenciado.jpg' })
    fake.referenced.add('u/referenciado.jpg')
    const app = await appWith({ CRON_SECRET: SECRET })

    const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', deleted: 2, failed: 0, auditDeleted: 0 })
    expect(fake.prisma.storageCleanup.findMany).toHaveBeenCalledTimes(1)
    expect(fake.prisma.storageCleanup.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, take: STORAGE_CLEANUP_CRON_BATCH }))
    // Solo el archivo sin referencias se borra del almacenamiento; el referenciado sale de la cola
    // sin tocar el archivo, como ya hacía el mecanismo existente.
    expect(fake.storage.delete).toHaveBeenCalledTimes(1)
    expect(fake.storage.delete).toHaveBeenCalledWith('u/libre.jpg')
    expect(fake.prisma.storageCleanup.deleteMany).toHaveBeenCalledTimes(2)
    expect(fake.prisma.storageCleanup.deleteMany).toHaveBeenCalledWith({ where: { id: 'c1' } })
    expect(fake.prisma.storageCleanup.deleteMany).toHaveBeenCalledWith({ where: { id: 'c2' } })
  })

  it('no busca huérfanos ni toca cuentas ni sesiones; la auditoría solo mediante su retención', async () => {
    fake.queue.push({ id: 'c1', storageKey: 'u/libre.jpg' })
    const app = await appWith({ CRON_SECRET: SECRET })

    await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })

    expect(fake.storage.list).not.toHaveBeenCalled()
    expect(fake.prisma.user.delete).not.toHaveBeenCalled()
    expect(fake.prisma.user.deleteMany).not.toHaveBeenCalled()
    expect(fake.prisma.session.deleteMany).not.toHaveBeenCalled()
    expect(fake.prisma.adminAuditLog.deleteMany).not.toHaveBeenCalled()
  })

  it('sin autorización no llega a leer la cola', async () => {
    fake.queue.push({ id: 'c1', storageKey: 'u/libre.jpg' })
    const app = await appWith({ CRON_SECRET: SECRET })

    await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: 'Bearer incorrecto-0123456789abcdef' } })
    await app.inject({ url: STORAGE_CLEANUP_CRON_PATH })

    expect(fake.prisma.storageCleanup.findMany).not.toHaveBeenCalled()
    expect(fake.storage.delete).not.toHaveBeenCalled()
  })
})

describe('constancia de cada ejecución (MaintenanceRun)', () => {
  it('Vercel Cron (user-agent vercel-cron/1.0) y una llamada manual se distinguen; solo contadores y duración', async () => {
    const records: unknown[] = []
    const app = Fastify()
    await app.register(maintenanceRoutes, {
      env: { CRON_SECRET: SECRET },
      drain: vi.fn(async () => ({ deleted: 4, failed: 1 })),
      purgeAudit: vi.fn(async () => ({ deleted: 2 })),
      countPending: vi.fn(async () => 7),
      recordRun: vi.fn(async record => void records.push(record)),
    })
    await app.ready()

    const scheduled = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}`, 'user-agent': 'vercel-cron/1.0' } })
    const manual = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}`, 'user-agent': 'curl/8.0' } })
    // La respuesta no cambia: el disparador solo se anota.
    expect(scheduled.json()).toEqual({ status: 'ok', deleted: 4, failed: 1, auditDeleted: 2 })
    expect(manual.json()).toEqual(scheduled.json())
    expect(records).toHaveLength(2)
    expect(records[0]).toEqual({ trigger: 'vercel-cron', status: 'ok', storageDeleted: 4, storageFailed: 1, auditDeleted: 2, queuePending: 7, durationMs: expect.any(Number), startedAt: expect.any(Date) })
    expect(records[1]).toMatchObject({ trigger: 'manual', status: 'ok' })
    // Variaciones de la cabecera no cuentan como Vercel Cron.
    for (const agent of ['vercel-cron/1.0 ', 'Vercel-Cron/1.0', 'vercel-cron/2.0', 'x vercel-cron/1.0']) {
      await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}`, 'user-agent': agent } })
      expect(records.at(-1)).toMatchObject({ trigger: 'manual' })
    }
  })

  it('una ejecución con fallo queda anotada como error, con los contadores que sí se obtuvieron', async () => {
    const recordRun = vi.fn(async () => undefined)
    const app = Fastify()
    await app.register(maintenanceRoutes, {
      env: { CRON_SECRET: SECRET },
      drain: vi.fn(async () => { throw new Error('cola no disponible') }),
      purgeAudit: vi.fn(async () => ({ deleted: 3 })),
      countPending: vi.fn(async () => { throw new Error('sin base') }),
      recordRun,
    })
    await app.ready()
    const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })
    expect(response.statusCode).toBe(500)
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'manual', status: 'error', storageDeleted: null, storageFailed: null, auditDeleted: 3, queuePending: null }))
  })

  it('si no se puede anotar la ejecución, el mantenimiento responde igual', async () => {
    const app = Fastify()
    await app.register(maintenanceRoutes, { env: { CRON_SECRET: SECRET }, drain: drainSpy(), purgeAudit: purgeAuditSpy, countPending: vi.fn(async () => 0), recordRun: vi.fn(async () => { throw new Error('tabla no migrada') }) })
    await app.ready()
    const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}` } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', deleted: 0, failed: 0, auditDeleted: 0 })
  })

  it('sin autorización o sin CRON_SECRET no se anota nada (una petición anónima no puede escribir filas)', async () => {
    const recordRun = vi.fn(async () => undefined)
    for (const env of [{ CRON_SECRET: SECRET }, {}]) {
      const app = Fastify()
      await app.register(maintenanceRoutes, { env, drain: drainSpy(), purgeAudit: purgeAuditSpy, countPending: vi.fn(async () => 0), recordRun })
      await app.ready()
      const response = await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: 'Bearer otro-secreto-cualquiera-123456', 'user-agent': 'vercel-cron/1.0' } })
      expect([401, 503]).toContain(response.statusCode)
    }
    expect(recordRun).not.toHaveBeenCalled()
  })

  it('por defecto escribe en MaintenanceRun solo los campos cerrados', async () => {
    const app = await appWith({ CRON_SECRET: SECRET }, drainSpy())
    await app.inject({ url: STORAGE_CLEANUP_CRON_PATH, headers: { authorization: `Bearer ${SECRET}`, 'user-agent': 'vercel-cron/1.0' } })
    expect(fake.prisma.maintenanceRun.create).toHaveBeenCalledTimes(1)
    const [args] = fake.prisma.maintenanceRun.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    expect(Object.keys(args.data).sort()).toEqual(['auditDeleted', 'durationMs', 'queuePending', 'startedAt', 'status', 'storageDeleted', 'storageFailed', 'trigger'])
    expect(JSON.stringify(args.data)).not.toContain(SECRET)
  })
})
