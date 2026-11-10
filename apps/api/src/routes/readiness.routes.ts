import type { FastifyInstance } from 'fastify'

import { prisma } from '../db/prisma.js'
import { safeErrorName } from '../services/log-safety.js'

// Comprobación de disponibilidad para el balanceador o el orquestador. `/health` (en app.ts)
// solo indica que el proceso responde; `/health/ready` comprueba además PostgreSQL. La respuesta
// no incluye detalles internos: el motivo se registra, sin datos de conexión.

export const READINESS_TIMEOUT_MS = 2_000

type Probe = () => Promise<unknown>

export async function databaseIsReachable(
  probe: Probe,
  timeoutMs = READINESS_TIMEOUT_MS,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  let timer: NodeJS.Timeout | undefined

  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tiempo de espera agotado')), timeoutMs)
      }),
    ])

    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  } finally {
    clearTimeout(timer)
  }
}

export async function readinessRoutes(
  app: FastifyInstance,
  options: { probe?: Probe; timeoutMs?: number } = {},
) {
  const probe = options.probe ?? (() => prisma.$queryRaw`SELECT 1`)

  app.get('/health/ready', async (request, reply) => {
    const result = await databaseIsReachable(probe, options.timeoutMs)

    if (result.ok) {
      return { status: 'ok', database: 'ok' }
    }

    request.log.error(
      { errorName: safeErrorName(result.error) },
      'PostgreSQL no está disponible',
    )

    return reply.code(503).send({ status: 'unavailable', database: 'unavailable' })
  })
}
