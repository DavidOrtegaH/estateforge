import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Paridad entre las restricciones manuales de SQLite y las previstas para PostgreSQL (DA-14).
// Prisma no representa los CHECK ni los índices parciales, así que nada más lo vigilaría.

const prismaDir = resolve(import.meta.dirname, '../../prisma')
const migrationsDir = join(prismaDir, 'migrations')

const latestMigration = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(join(migrationsDir, entry.name, 'migration.sql'), 'utf8'))
  .filter((sql) => sql.includes('CREATE TABLE "new_ListingPublication"'))
  .at(-1) as string

const postgres = readFileSync(join(prismaDir, 'postgresql', 'constraints.sql'), 'utf8')

const checks = (sql: string) =>
  Object.fromEntries(
    [...sql.matchAll(/CONSTRAINT "(ListingPublication_\w+)" (CHECK \(.*\))[,;]?\s*$/gm)].map((match) => [match[1], match[2]]),
  )

const partialIndex = (sql: string) =>
  sql.split('\n').find((line) => line.includes('ListingPublication_other_position_key'))

describe('restricciones para PostgreSQL', () => {
  it('declara los tres CHECK', () => {
    expect(Object.keys(checks(postgres)).sort()).toEqual([
      'ListingPublication_instance_key_matches_platform',
      'ListingPublication_other_position_range',
      'ListingPublication_published_requires_url',
    ])
  })

  it('los CHECK coinciden con la última migración de SQLite', () => {
    expect(checks(postgres)).toEqual(checks(latestMigration))
  })

  it('el índice parcial coincide', () => {
    expect(partialIndex(postgres)).toBeDefined()
    expect(partialIndex(postgres)).toBe(partialIndex(latestMigration))
  })

  it('no usa sintaxis propia de SQLite', () => {
    expect(postgres).not.toMatch(/PRAGMA|AUTOINCREMENT|DATETIME|new_ListingPublication/)
  })

  it('cada CHECK exige explícitamente sus columnas', () => {
    expect(checks(postgres).ListingPublication_other_position_range).toContain('"position" IS NOT NULL')
    expect(checks(postgres).ListingPublication_instance_key_matches_platform).toContain('"instanceKey" IS NOT NULL')
    expect(checks(postgres).ListingPublication_published_requires_url).toContain('"isPublished" IS NOT NULL')
  })
})
