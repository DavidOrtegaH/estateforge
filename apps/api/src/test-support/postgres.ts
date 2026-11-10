import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import pg from 'pg'

// PostgreSQL real para las pruebas de integración. Cada suite crea su propia base y la destruye.
// La conexión de administración sale de TEST_POSTGRES_ADMIN_URL y solo se admite localhost:
// estas pruebas nunca pueden alcanzar una base de desarrollo, compartida o de producción.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

const migrationsDir = resolve(import.meta.dirname, '../../prisma/migrations')

export function assertLocalTestServer(url: string): void {
  let host: string

  try {
    host = new URL(url).hostname
  } catch {
    throw new Error('TEST_POSTGRES_ADMIN_URL no es una URL válida.')
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error('Las pruebas de integración solo se ejecutan contra PostgreSQL en localhost.')
  }
}

export interface TestDatabase {
  name: string
  url: string
  drop: () => Promise<void>
}

export function adminUrl(): string {
  const url = process.env.TEST_POSTGRES_ADMIN_URL

  if (!url) {
    throw new Error('Define TEST_POSTGRES_ADMIN_URL para ejecutar las pruebas de integración con PostgreSQL.')
  }

  assertLocalTestServer(url)

  return url
}

export async function applyMigrations(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url })

  await client.connect()

  try {
    const folders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    for (const folder of folders) {
      await client.query(readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf8'))
    }
  } finally {
    await client.end()
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const admin = adminUrl()
  const name = `ef_test_${randomBytes(8).toString('hex')}`
  const client = new pg.Client({ connectionString: admin })

  await client.connect()
  await client.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`)
  await client.end()

  const parsed = new URL(admin)

  parsed.pathname = `/${name}`

  const url = parsed.toString()

  await applyMigrations(url)

  return {
    name,
    url,
    drop: async () => {
      const closer = new pg.Client({ connectionString: admin })

      await closer.connect()
      await closer.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await closer.end()
    },
  }
}
