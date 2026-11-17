import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

// Arranque real de la API con una configuración de base de datos ausente o no válida. El proceso se
// lanza desde un directorio vacío: dotenv busca el .env en el directorio de trabajo, así que la prueba
// no depende del .env del desarrollador ni lo lee. No necesita PostgreSQL.

const API = resolve(import.meta.dirname, '..')
const TSX = resolve(API, 'node_modules/tsx/dist/cli.mjs')
const SERVER = resolve(API, 'src/server.ts')
const EMPTY_DIR = mkdtempSync(join(tmpdir(), 'ef-sin-env-'))

afterAll(() => rmSync(EMPTY_DIR, { recursive: true, force: true }))

function start(overrides: Record<string, string | undefined>) {
  // BYOK (DA-77): el servidor arranca sin ninguna API key de proveedores de IA en el entorno.
  const env: Record<string, string | undefined> = { ...process.env, PORT: '0', NODE_OPTIONS: '', ...overrides }
  delete env.GEMINI_API_KEY
  delete env.OPENAI_API_KEY
  for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete env[key]
  const run = spawnSync(process.execPath, [TSX, SERVER], { cwd: EMPTY_DIR, env, encoding: 'utf8', timeout: 30_000 })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

describe('arranque con una configuración de base de datos ausente o no válida', () => {
  it.each([
    ['ausente', undefined, 'received undefined'],
    ['vacía', '', 'DATABASE_URL es requerida'],
    ['SQLite (sin vuelta silenciosa a dev.db)', 'file:./dev.db', 'DATABASE_URL debe ser una conexión postgresql://'],
    ['MySQL', 'mysql://usuario:clave-mysql@127.0.0.1:3306/base', 'DATABASE_URL debe ser una conexión postgresql://'],
  ])('DATABASE_URL %s: el proceso termina con 1 por ese motivo y sin mostrar la URL', (_label, value, reason) => {
    const { status, output } = start({ DATABASE_URL: value })

    expect(status).toBe(1)
    expect(output).toContain('DATABASE_URL')
    expect(output).toContain(reason)
    if (value) expect(output).not.toContain(value)
  })

  it('PORT no válido: el proceso termina con 1', () => {
    const { status, output } = start({ DATABASE_URL: 'postgresql://usuario:clave@127.0.0.1:1/base', PORT: '99999' })

    expect(status).toBe(1)
    expect(output).toContain('PORT debe ser un entero entre 1 y 65535.')
    expect(output).not.toContain('clave@')
  })
})
