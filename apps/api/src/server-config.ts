// Dirección de escucha. La plataforma de despliegue suele fijar PORT; HOST permite escuchar en
// todas las interfaces (0.0.0.0) cuando el servidor está detrás de un proxy o un contenedor.

export interface ServerAddress {
  port: number
  host: string
}

export function readServerAddress(
  env: NodeJS.ProcessEnv,
): ServerAddress {
  const rawPort = env.PORT?.trim()
  const port = rawPort ? Number(rawPort) : 3000

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.')
  }

  return {
    port,
    host: env.HOST?.trim() || 'localhost',
  }
}
