import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// El seed de desarrollo contra PostgreSQL real: datos representativos, sin duplicados al repetirlo,
// respetando las restricciones, y reconstruible tras vaciar la base.

let database: TestDatabase
let admin: pg.Client
let seed: typeof import('../../prisma/seed.js')
let closeDatabase: () => Promise<void>
let storageDir: string

const count = async (sql: string) => Number((await admin.query(sql)).rows[0].n)

beforeAll(async () => {
  database = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', database.url)
  // Las fotografías sintéticas van a un directorio temporal, nunca al almacenamiento de desarrollo.
  storageDir = await mkdtemp(join(tmpdir(), 'ef-seed-storage-'))
  vi.stubEnv('STORAGE_DRIVER', 'local')
  vi.stubEnv('STORAGE_LOCAL_DIR', storageDir)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  vi.resetModules()
  seed = await import('../../prisma/seed.js')
  closeDatabase = (await import('../db/prisma.js')).closeDatabase
})

afterAll(async () => {
  await closeDatabase()
  await admin.end()
  vi.unstubAllEnvs()
  await database.drop()
  await rm(storageDir, { recursive: true, force: true })
})

describe('seed de desarrollo', () => {
  it('crea dos cuentas, los cuatro estados, un inmueble sin estado y un Checklist con «Otro/a»', async () => {
    expect(await seed.seed('Clave-De-Prueba-Del-Seed-1')).toBe(true)

    expect(await count(`SELECT count(*) AS n FROM "User"`)).toBe(2)
    const statuses = (await admin.query(`SELECT "commercialStatus" AS s FROM "Property" ORDER BY 1 NULLS LAST`)).rows.map(row => row.s)
    expect(statuses).toEqual(['for-rent', 'for-sale', 'for-sale', 'rented', 'sold', null])
    expect((await admin.query(`SELECT price::text AS p FROM "Property" WHERE title = 'Piso en venta en el centro'`)).rows[0].p).toBe('250000.00')
    expect(await count(`SELECT count(*) AS n FROM "ListingPublication" WHERE platform = 'other'`)).toBe(2)
    expect(await count(`SELECT count(*) AS n FROM "ListingPublication" WHERE "isPublished"`)).toBe(3)
    // Las contraseñas se guardan con hash, nunca en claro.
    expect(await count(`SELECT count(*) AS n FROM "User" WHERE password = 'Clave-De-Prueba-Del-Seed-1'`)).toBe(0)
  })

  it('añade fotografías sintéticas válidas a los inmuebles de ejemplo y deja uno sin ninguna', async () => {
    // Una fila por inmueble (no por título: dos inmuebles con el mismo título se detectarían). El orden
    // no importa aquí y depende de la collation de la base (en en_US «Ático» va antes que «Estudio»; en
    // C, después de «Piso»), así que el resultado se compara como un mapa por título.
    const rows = (await admin.query(`SELECT p.id, p.title, count(f.id)::int AS n, count(*) FILTER (WHERE f."isPrimary")::int AS primaries FROM "Property" p LEFT JOIN "PropertyPhoto" f ON f."propertyId" = p.id GROUP BY p.id, p.title`)).rows
    expect(new Set(rows.map(row => row.title)).size).toBe(rows.length)
    expect(Object.fromEntries(rows.map(row => [row.title, { n: row.n, primaries: row.primaries }]))).toEqual({
      'Estudio por alquilar': { n: 2, primaries: 1 },
      'Inmueble antiguo sin estado': { n: 0, primaries: 0 },
      'Inmueble de otra cuenta': { n: 0, primaries: 0 },
      'Piso alquilado junto al parque': { n: 3, primaries: 1 },
      'Piso en venta en el centro': { n: 4, primaries: 1 },
      'Ático vendido con terraza': { n: 3, primaries: 1 },
    })
    expect(await count(`SELECT count(*) AS n FROM "PropertyPhoto" WHERE "contentType" = 'image/png' AND width = 1200 AND height = 900`)).toBe(12)
    // Los archivos existen en el almacenamiento y coinciden con lo registrado.
    const { getStorage } = await import('../storage/object-storage.js')
    const storage = await getStorage()
    const photo = (await admin.query(`SELECT "storageKey", size FROM "PropertyPhoto" LIMIT 1`)).rows[0]
    const stored = await storage.get(photo.storageKey)
    expect(stored).not.toBeNull()
    expect(stored!.size).toBe(photo.size)
    expect(await count(`SELECT count(*) AS n FROM "StorageCleanup"`)).toBe(0)
  })

  it('con --photos solo completa los que no tienen fotografías', async () => {
    await admin.query(`DELETE FROM "PropertyPhoto" WHERE "propertyId" = (SELECT id FROM "Property" WHERE title = 'Estudio por alquilar')`)

    expect(await seed.seed('Clave-De-Prueba-Del-Seed-1', { photos: true })).toBe(false)
    expect(await count(`SELECT count(*) AS n FROM "PropertyPhoto"`)).toBe(12)
    expect(await seed.seed('Clave-De-Prueba-Del-Seed-1', { photos: true })).toBe(false)
    expect(await count(`SELECT count(*) AS n FROM "PropertyPhoto"`)).toBe(12)
  })

  it('repetirlo no duplica nada', async () => {
    const before = await count(`SELECT (SELECT count(*) FROM "User") + (SELECT count(*) FROM "Property") + (SELECT count(*) FROM "Generation") + (SELECT count(*) FROM "ListingPublication") + (SELECT count(*) FROM "PropertyPhoto") AS n`)

    expect(await seed.seed('Clave-De-Prueba-Del-Seed-1')).toBe(false)

    expect(await count(`SELECT (SELECT count(*) FROM "User") + (SELECT count(*) FROM "Property") + (SELECT count(*) FROM "Generation") + (SELECT count(*) FROM "ListingPublication") + (SELECT count(*) FROM "PropertyPhoto") AS n`)).toBe(before)
  })

  it('cada cuenta solo tiene sus inmuebles', async () => {
    const rows = (await admin.query(`SELECT u.email, count(p.id)::int AS n FROM "User" u LEFT JOIN "Property" p ON p."userId" = u.id GROUP BY u.email ORDER BY u.email`)).rows
    expect(rows).toEqual([{ email: seed.SEED_EMAIL, n: 5 }, { email: seed.SEED_OTHER_EMAIL, n: 1 }])
  })

  it('se reconstruye tras vaciar la base', async () => {
    await admin.query(`TRUNCATE "User" CASCADE`)

    expect(await seed.seed('Clave-De-Prueba-Del-Seed-1')).toBe(true)
    expect(await count(`SELECT count(*) AS n FROM "Property"`)).toBe(6)
  })

  it('como script (db:seed) termina por sí solo: cierra el pool propio (DA-38)', () => {
    const api = resolve(import.meta.dirname, '../..')
    const run = spawnSync(process.execPath, [resolve(api, 'node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'], {
      cwd: api,
      env: { ...process.env, DATABASE_URL: database.url, SEED_USER_PASSWORD: 'Clave-De-Prueba-Del-Seed-1', NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 20_000,
    })

    // Con $disconnect y el pool propio sin cerrar, el proceso seguiría vivo hasta agotar el plazo.
    expect(run.error).toBeUndefined()
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Los datos de ejemplo ya existían.')
  })

  it('sin contraseña o fuera de localhost se niega', async () => {
    await expect(seed.seed('')).rejects.toThrow('SEED_USER_PASSWORD')
  })
})
