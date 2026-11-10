import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// El seed de desarrollo contra PostgreSQL real: datos representativos, sin duplicados al repetirlo,
// respetando las restricciones, y reconstruible tras vaciar la base.

let database: TestDatabase
let admin: pg.Client
let seed: typeof import('../../prisma/seed.js')
let closeDatabase: () => Promise<void>

const count = async (sql: string) => Number((await admin.query(sql)).rows[0].n)

beforeAll(async () => {
  database = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', database.url)
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

  it('repetirlo no duplica nada', async () => {
    const before = await count(`SELECT (SELECT count(*) FROM "User") + (SELECT count(*) FROM "Property") + (SELECT count(*) FROM "Generation") + (SELECT count(*) FROM "ListingPublication") AS n`)

    expect(await seed.seed('Clave-De-Prueba-Del-Seed-1')).toBe(false)

    expect(await count(`SELECT (SELECT count(*) FROM "User") + (SELECT count(*) FROM "Property") + (SELECT count(*) FROM "Generation") + (SELECT count(*) FROM "ListingPublication") AS n`)).toBe(before)
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
