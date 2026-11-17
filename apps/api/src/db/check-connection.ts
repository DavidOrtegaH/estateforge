import { pathToFileURL } from 'node:url'

import dotenv from 'dotenv'
import pg from 'pg'

import { buildPoolConfig } from './connection-config.js'

// Comprobación de la base de desarrollo antes de arrancar la API (scripts/dev/postgres-wsl.mjs).
// Usa la misma configuración que la API (apps/api/.env y buildPoolConfig) y se autentica con el rol de
// la aplicación. Imprime una sola línea JSON con el destino y el resultado: nunca el usuario, la
// contraseña ni la URL.

export type CheckResult =
  | { ok: true; host: string; port: number; database: string }
  | { ok: false; reason: CheckFailure; message: string; host?: string; port?: number; database?: string }

export type CheckFailure = 'config' | 'auth' | 'database' | 'unreachable' | 'protocol' | 'other'

export interface Probe {
  query(sql: string): Promise<unknown>
  end(): Promise<void>
  connect(): Promise<unknown>
}

const MESSAGES: Record<CheckFailure, string> = {
  config: 'DATABASE_URL no es una conexión PostgreSQL válida.',
  auth: 'PostgreSQL ha rechazado las credenciales de apps/api/.env.',
  database: 'La base de datos de DATABASE_URL no existe.',
  unreachable: 'No hay ningún PostgreSQL escuchando en el destino de DATABASE_URL.',
  protocol: 'En el puerto de DATABASE_URL responde un servicio que no es PostgreSQL, o la conexión se ha cortado.',
  other: 'No se ha podido comprobar la conexión con PostgreSQL.',
}

function classify(error: unknown): CheckFailure {
  const code = (error as { code?: unknown } | null)?.code
  const message = error instanceof Error ? error.message : ''
  if (code === '28P01' || code === '28000') return 'auth'
  if (code === '3D000') return 'database'
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || message.includes('timeout expired')) return 'unreachable'
  if (code === 'ECONNRESET' || code === 'EPIPE' || message.includes('Connection terminated') || message.includes('unexpected')) return 'protocol'
  return 'other'
}

export async function checkConnection(
  env: NodeJS.ProcessEnv,
  makeProbe: (config: pg.ClientConfig) => Probe = config => new pg.Client(config),
): Promise<CheckResult> {
  let config: ReturnType<typeof buildPoolConfig>
  try {
    config = buildPoolConfig(env)
  } catch {
    return { ok: false, reason: 'config', message: MESSAGES.config }
  }
  const url = new URL(config.connectionString as string)
  const target = { host: url.hostname, port: Number(url.port || 5432), database: url.pathname.replace(/^\//, '') }
  const probe = makeProbe({ connectionString: config.connectionString, connectionTimeoutMillis: 5_000, application_name: 'estateforge-dev-check' })
  try {
    await probe.connect()
    await probe.query('SELECT 1')
    return { ok: true, ...target }
  } catch (error) {
    const reason = classify(error)
    return { ok: false, reason, message: MESSAGES[reason], ...target }
  } finally {
    await probe.end().catch(() => {})
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config({ quiet: true })
  const result = await checkConnection(process.env)
  console.log(JSON.stringify(result))
  process.exitCode = result.ok ? 0 : 1
}
