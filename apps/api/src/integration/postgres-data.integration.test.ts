import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { databaseUnavailableKind } from '../db/availability.js'
import { assertLocalTestServer, createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Tipos, identidad de email y ciclo de vida contra PostgreSQL real.

vi.mock('../services/turnstile.service.js', () => ({
  isTurnstileEnabled: () => false,
  verifyTurnstileToken: vi.fn(async () => true),
}))

vi.mock('../services/email.service.js', () => ({
  emailService: { sendVerificationEmail: vi.fn(async () => true), sendEmailVerificationEmail: vi.fn(async () => true) },
}))

let database: TestDatabase
let client: pg.Client
let prisma: typeof import('../db/prisma.js')['prisma']
let closeDatabase: typeof import('../db/prisma.js')['closeDatabase']
let app: FastifyInstance

const prismaDir = resolve(import.meta.dirname, '../../prisma')

const newProperty = (price: string, userId: string | null = null) => ({
  title: 't', operation: 'sale', type: 'house', price, address: 'a', city: 'c', neighborhood: '',
  area: 90.5, bedrooms: 1, bathrooms: 1, condition: 'good', additionalInformation: '', userId,
})

beforeAll(async () => {
  database = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', database.url)
  client = new pg.Client({ connectionString: database.url })
  await client.connect()

  ;({ prisma, closeDatabase } = await import('../db/prisma.js'))

  const { authRoutes } = await import('../routes/auth.routes.js')

  app = Fastify()
  await app.register((await import('@fastify/rate-limit')).default, { global: false })
  await app.register(authRoutes)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await closeDatabase()
  await client.end()
  vi.unstubAllEnvs()
  await database.drop()
})

describe('protección del entorno de pruebas', () => {
  it.each(['postgresql://u:p@db.example.com:5432/x', 'postgresql://u:p@10.0.0.5/x'])('rechaza un servidor no local', (url) => {
    expect(() => assertLocalTestServer(url)).toThrow(/localhost/)
  })

  it('admite solo localhost y usa una base propia', () => {
    expect(() => assertLocalTestServer('postgresql://u:p@127.0.0.1:5/x')).not.toThrow()
    expect(new URL(process.env.DATABASE_URL as string).pathname).toMatch(/^\/ef_test_/)
  })
})

describe('historia de migraciones', () => {
  it('la ruta activa contiene la línea base de PostgreSQL y solo las migraciones posteriores revisadas', () => {
    const active = readdirSync(resolve(prismaDir, 'migrations'))

    // DA-46: galería, cartel y vídeo; DA-51 a DA-55: galería de 50, plantillas y audio. Aditivas sobre la
    // línea base. Una migración nueva debe añadirse aquí.
    expect(active.filter((name) => name !== 'migration_lock.toml').sort()).toEqual(['0_postgresql_baseline', '20261110120000_add_property_photos_and_listing_media', '20261111120000_gallery_50_poster_templates_audio', '20261112120000_direct_uploads', '20261113120000_ai_media_byok', '20261114120000_ai_text_byok', '20261115120000_ai_provider_catalog', '20261115200000_ai_provider_trials', '20261118120000_maintenance_runs', '20261120090000_generation_language_drafts'])
    expect(readFileSync(resolve(prismaDir, 'migrations/migration_lock.toml'), 'utf8')).toContain('provider = "postgresql"')
  })

  it('la línea base se ordena antes que cualquier migración posterior', () => {
    const names = [...readdirSync(resolve(prismaDir, 'migrations')).filter((name) => name !== 'migration_lock.toml'), '20000101000000_antigua', '29991231235959_futura'].sort()

    expect(names[0]).toBe('0_postgresql_baseline')
  })

  it('la historia SQLite se conserva archivada', () => {
    const archived = readdirSync(resolve(prismaDir, 'sqlite-history')).filter((name) => /^\d{14}_/.test(name))

    expect(archived).toHaveLength(22)
    expect(existsSync(resolve(prismaDir, 'sqlite-history', archived[0], 'migration.sql'))).toBe(true)
  })

  it('las restricciones manuales están en la base', async () => {
    const { rows } = await client.query(`SELECT conname FROM pg_constraint WHERE contype = 'c' ORDER BY conname`)

    expect(rows.map((row) => row.conname)).toEqual(expect.arrayContaining([
      'ListingPublication_instance_key_matches_platform',
      'ListingPublication_other_position_range',
      'ListingPublication_published_requires_url',
      'User_email_lowercase',
    ]))

    const index = await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'ListingPublication_other_position_key'`)

    expect(index.rows[0].indexdef).toMatch(/UNIQUE INDEX.*WHERE.*platform.*other/)
  })
})

describe('importes', () => {
  it('la columna es numeric(12,2)', async () => {
    const { rows } = await client.query(`SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'Property' AND column_name = 'price'`)

    expect(rows[0]).toEqual({ data_type: 'numeric', numeric_precision: 12, numeric_scale: 2 })
  })

  it.each(['900.00', '10000.00', '250000.00', '250000.10', '1234.75', '0.01', '100000000.00'])('conserva exactamente %s', async (price) => {
    const { id } = await prisma.property.create({ data: newProperty(price) })
    const { rows } = await client.query(`SELECT price::text FROM "Property" WHERE id = $1`, [id])

    expect(rows[0].price).toBe(price)
  })

  it('la suma no acumula errores binarios', async () => {
    const created = await Promise.all(['0.10', '0.20'].map((price) => prisma.property.create({ data: newProperty(price) })))
    const { rows } = await client.query(`SELECT sum(price)::text AS total FROM "Property" WHERE id = ANY($1)`, [created.map((item) => item.id)])

    expect(rows[0].total).toBe('0.30')
  })

  it('rechaza un importe que no cabe', async () => {
    await expect(prisma.property.create({ data: newProperty('12345678901.00') })).rejects.toThrow()
  })

  it('la superficie no es un importe y admite decimales', async () => {
    const { id, area } = await prisma.property.create({ data: newProperty('1.00') })

    expect(area).toBe(90.5)
    expect(id).toBeTruthy()
  })
})

describe('fechas', () => {
  it('todas las fechas son timestamptz', async () => {
    const { rows } = await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('timestamp without time zone', 'date')`)

    expect(rows).toEqual([])
  })

  it('un instante no se desplaza con la zona horaria de la sesión', async () => {
    const instant = new Date('2026-03-29T01:30:00.000Z')
    const user = await prisma.user.create({ data: { email: 'zona@example.test', password: 'x', securityHoldAt: instant } })
    const other = new pg.Client({ connectionString: database.url })

    await other.connect()
    await other.query(`SET TIME ZONE 'Asia/Tokyo'`)

    const { rows } = await other.query(`SELECT "securityHoldAt" AS at, to_char("securityHoldAt", 'TZH') AS offset FROM "User" WHERE id = $1`, [user.id])

    await other.end()

    expect((rows[0].at as Date).toISOString()).toBe(instant.toISOString())
    expect(rows[0].offset).toBe('+09')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).securityHoldAt).toEqual(instant)
  })

  // Con una zona horaria por defecto del servidor o de la base distinta de UTC, Prisma (adapter-pg)
  // perdía el desplazamiento al leer timestamptz y desplazaba los instantes (caducidades incluidas).
  // El pool fija la zona de cada sesión en UTC; aquí la base tiene otra por defecto.
  it('el instante no cambia aunque la zona horaria por defecto de la base no sea UTC', async () => {
    const name = `ef-test-tz-${randomBytes(4).toString('hex')}`
    await client.query(`ALTER DATABASE "${database.name}" SET timezone TO 'Europe/Madrid'`)
    vi.resetModules()
    vi.stubEnv('DATABASE_APPLICATION_NAME', name)
    const own = await import('../db/prisma.js')
    try {
      // La base tiene otra zona por defecto, pero cada sesión del pool trabaja en UTC.
      expect((await own.prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`)[0].tz).toBe('UTC')
      const instant = new Date('2026-07-01T10:00:00.000Z')
      const user = await own.prisma.user.create({ data: { email: 'zona-base@example.test', password: 'x', securityHoldAt: instant } })
      const raw = (await client.query(`SELECT "securityHoldAt" AS at FROM "User" WHERE id = $1`, [user.id])).rows[0].at as Date
      expect(raw.toISOString()).toBe(instant.toISOString())
      expect((await own.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).securityHoldAt).toEqual(instant)

      await client.query(`INSERT INTO "User" (id, email, password, "updatedAt", "securityHoldAt") VALUES ('offset-tz', 'offset-tz@example.test', 'x', now(), '2026-07-01 12:00:00+02')`)
      expect((await own.prisma.user.findUniqueOrThrow({ where: { id: 'offset-tz' } })).securityHoldAt?.toISOString()).toBe('2026-07-01T10:00:00.000Z')
      // Comparaciones en SQL contra now(): un registro que caduca dentro de 30 minutos sigue vigente.
      await own.prisma.user.update({ where: { id: user.id }, data: { securityHoldAt: new Date(Date.now() + 30 * 60_000) } })
      expect(await own.prisma.user.count({ where: { id: user.id, securityHoldAt: { gt: new Date() } } })).toBe(1)
    } finally {
      await own.closeDatabase()
      await client.query(`ALTER DATABASE "${database.name}" RESET timezone`)
    }
  })

  it('un valor con desplazamiento se guarda como el mismo instante', async () => {
    await client.query(`INSERT INTO "User" (id, email, password, "updatedAt", "securityHoldAt") VALUES ('offset', 'offset@example.test', 'x', now(), '2026-07-01 12:00:00+02')`)

    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'offset' } })).securityHoldAt?.toISOString()).toBe('2026-07-01T10:00:00.000Z')
  })
})

describe('emails', () => {
  const PASSWORD = 'Clave-Larga-Segura-2026!'
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload })

  it('SQL rechaza un email con mayúsculas', async () => {
    await expect(client.query(`INSERT INTO "User" (id, email, password, "updatedAt") VALUES ('m', 'Mixto@Example.test', 'x', now())`)).rejects.toMatchObject({ constraint: 'User_email_lowercase' })
  })

  it('el registro normaliza y el inicio de sesión no distingue mayúsculas', async () => {
    const register = await post('/api/auth/register', { email: 'Persona@Example.TEST', password: PASSWORD })

    expect(register.statusCode).toBeLessThan(300)
    expect(await prisma.user.count({ where: { email: 'persona@example.test' } })).toBe(1)

    expect((await post('/api/auth/login', { email: 'PERSONA@example.test', password: PASSWORD })).statusCode).toBe(200)
  })

  it('no se puede registrar la misma identidad con otras mayúsculas', async () => {
    await post('/api/auth/register', { email: 'duplicada@example.test', password: PASSWORD })
    await post('/api/auth/register', { email: 'DUPLICADA@example.test', password: PASSWORD })

    expect(await prisma.user.count({ where: { email: { equals: 'duplicada@example.test', mode: 'insensitive' } } })).toBe(1)
  })

  it('la búsqueda de administración no distingue mayúsculas', async () => {
    await prisma.user.create({ data: { email: 'buscable@example.test', password: 'x' } })

    expect(await prisma.user.count({ where: { email: { contains: 'BUSCABLE', mode: 'insensitive' } } })).toBe(1)
  })
})

describe('pool de conexiones', () => {
  // Solo se cuentan las conexiones del pool probado, identificadas por su application_name. Contar
  // todas las de la base mezclaba las del pool del resto del archivo y procesos del servidor que no son
  // de ningún pool (en el primer CI de GitHub, 4 frente a 2 tras cerrar).
  const POOL_NAME = `ef-test-pool-${randomBytes(4).toString('hex')}`
  const connections = async () =>
    (await client.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1`, [POOL_NAME])).rows[0].n as number

  it('no abre una conexión por petición, y closeDatabase cierra el pool sin que el trabajo posterior reconecte (DA-38)', async () => {
    vi.resetModules()
    vi.stubEnv('DATABASE_APPLICATION_NAME', POOL_NAME)

    const own = await import('../db/prisma.js')
    expect(await connections()).toBe(0)

    await Promise.all(Array.from({ length: 60 }, () => own.prisma.user.count()))

    const open = await connections()
    expect(open).toBeGreaterThan(0)
    expect(open).toBeLessThanOrEqual(10)

    await own.closeDatabase()

    // El cliente ya ha cerrado sus conexiones; el servidor retira cada proceso de pg_stat_activity al
    // terminar, de forma asíncrona. Se espera a que no quede ninguna, con un límite: una fuga real no
    // llegaría a cero y la prueba fallaría.
    await expect.poll(connections, { timeout: 5_000, interval: 25 }).toBe(0)

    // Trabajo que llega después del cierre: falla como base no disponible y no abre conexiones.
    const late = await own.prisma.user.count().then(() => null, (error: unknown) => error)
    expect(databaseUnavailableKind(late)).toBe('pool_closed')
    expect(await connections()).toBe(0)

    // Idempotente: una segunda llamada no falla.
    await expect(own.closeDatabase()).resolves.toBeUndefined()
    expect(await connections()).toBe(0)
  })

  it('el arranque cierra el pool al final del cierre ordenado, no en un hook onClose', () => {
    const server = readFileSync(resolve(import.meta.dirname, '../server.ts'), 'utf8')

    expect(server).toMatch(/registerGracefulShutdown\(app, \{ closeResources: closeDatabase \}\)/)
    expect(server).not.toMatch(/\$disconnect|addHook\('onClose'/)
  })
})

describe('relaciones', () => {
  it('una clave foránea inexistente se rechaza', async () => {
    await expect(client.query(`INSERT INTO "Generation" (id, title, description, highlights, provider, tone, language, "propertyId", "updatedAt") VALUES ('g', 't', 'd', '[]', 'mock', 'casual', 'es', 'no-existe', now())`)).rejects.toMatchObject({ code: '23503' })
  })

  it('borrar un inmueble borra sus anuncios y su Checklist', async () => {
    const property = await prisma.property.create({ data: newProperty('1.00') })
    const generation = await prisma.generation.create({ data: { title: 't', description: 'd', highlights: '[]', provider: 'mock', tone: 'casual', language: 'es', propertyId: property.id } })

    await prisma.listingPublication.create({ data: { generationId: generation.id, platform: 'pisos' } })
    await prisma.property.delete({ where: { id: property.id } })

    expect(await prisma.generation.count({ where: { id: generation.id } })).toBe(0)
    expect(await prisma.listingPublication.count({ where: { generationId: generation.id } })).toBe(0)
  })
})
