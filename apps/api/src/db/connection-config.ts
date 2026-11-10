import type { PoolConfig } from 'pg'

// Configuración del único pool de conexiones del proceso. Los valores por defecto son
// razonables para una instancia; dependen de la plataforma y se ajustan por entorno.

function positiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${name} debe ser un entero positivo.`,
    )
  }

  return parsed
}

export function buildPoolConfig(
  env: NodeJS.ProcessEnv,
): PoolConfig {
  const connectionString = env.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está configurada.',
    )
  }

  // No se incluye el valor en el mensaje: puede contener credenciales.
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    throw new Error(
      'DATABASE_URL debe ser una conexión postgresql://.',
    )
  }

  return {
    connectionString,
    // Identifica las conexiones de la API en pg_stat_activity. Si la URL lo indica, prevalece.
    application_name: env.DATABASE_APPLICATION_NAME?.trim() || 'estateforge-api',
    max: positiveInteger(
      'DATABASE_POOL_MAX',
      env.DATABASE_POOL_MAX,
      10,
    ),
    connectionTimeoutMillis: positiveInteger(
      'DATABASE_CONNECT_TIMEOUT_MS',
      env.DATABASE_CONNECT_TIMEOUT_MS,
      5_000,
    ),
    idleTimeoutMillis: positiveInteger(
      'DATABASE_IDLE_TIMEOUT_MS',
      env.DATABASE_IDLE_TIMEOUT_MS,
      30_000,
    ),
  }
}
