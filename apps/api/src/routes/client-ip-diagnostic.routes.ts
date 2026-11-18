import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { clientIpOf, readClientIpSource } from '../client-ip.js'
import { requireOwner } from '../middleware/owner.middleware.js'

// Diagnóstico TEMPORAL de la IP del cliente para cerrar MD-4 (docs/despliegue/vercel-neon-blob.md,
// «IP del cliente detrás de Vercel»). Permite ver, desde dos redes y por los dos dominios (reescritura
// de la web y dominio propio de la API), qué dirección llega en el socket y en las cabeceras de proxy,
// antes de decidir si CLIENT_IP_SOURCE puede pasar a «vercel». No cambia ningún control: el rate-limit
// y Turnstile siguen usando CLIENT_IP_SOURCE.
//
// Garantías:
// - Desactivado por defecto: la ruta solo existe si CLIENT_IP_DIAGNOSTIC_UNTIL contiene una fecha ISO
//   8601 futura y como mucho a 72 h vista. Pasada esa fecha responde 404 aunque siga definida.
// - Solo OWNER (requireOwner: sesión, rol y sin incidente abierto). Cualquier otra cuenta, 403; sin
//   sesión, 401.
// - Devuelve solo direcciones IP de la propia petición del OWNER y el identificador de salto de Vercel;
//   ninguna cookie, secreto ni otra cabecera. Nada se registra (los valores no pasan por el logger).
// - Cache-Control: no-store; límite de 20 peticiones por minuto.
// Retirada: quitar CLIENT_IP_DIAGNOSTIC_UNTIL y volver a desplegar (o dejar que venza) y eliminar este
// archivo cuando MD-4 quede cerrado.

export const CLIENT_IP_DIAGNOSTIC_PATH = '/api/admin/diagnostics/client-ip'
export const CLIENT_IP_DIAGNOSTIC_MAX_WINDOW_MS = 72 * 60 * 60 * 1000
const HEADER_MAX = 200

export interface ClientIpDiagnosticOptions {
  env?: NodeJS.ProcessEnv
  now?: () => number
  /** Solo para pruebas: por defecto, requireOwner. */
  guard?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
}

/** Fin de la ventana si la variable es válida, futura y como mucho a 72 h; si no, null (desactivado). */
export function diagnosticWindowEnd(raw: string | undefined, now: number): number | null {
  const value = raw?.trim()
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const end = Date.parse(value)
  if (!Number.isFinite(end) || end <= now || end - now > CLIENT_IP_DIAGNOSTIC_MAX_WINDOW_MS) return null
  return end
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null
  const text = Array.isArray(value) ? value.join(', ') : value
  return text.length > HEADER_MAX ? `${text.slice(0, HEADER_MAX)}…` : text
}

export async function clientIpDiagnosticRoutes(app: FastifyInstance, options: ClientIpDiagnosticOptions = {}) {
  const env = options.env ?? process.env
  const now = options.now ?? Date.now
  if (!env.CLIENT_IP_DIAGNOSTIC_UNTIL?.trim()) return
  const guard = options.guard ?? requireOwner

  app.get(
    CLIENT_IP_DIAGNOSTIC_PATH,
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      // La ventana se comprueba antes que la sesión: vencida, la ruta es indistinguible de una inexistente.
      preHandler: [
        async (_request, reply) => {
          if (diagnosticWindowEnd(env.CLIENT_IP_DIAGNOSTIC_UNTIL, now()) === null) {
            reply.callNotFound()
            return reply
          }
        },
        guard,
      ],
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const end = diagnosticWindowEnd(env.CLIENT_IP_DIAGNOSTIC_UNTIL, now())
      let configuredSource: string
      try {
        configuredSource = readClientIpSource(env)
      } catch {
        configuredSource = 'invalid'
      }
      return {
        observedAt: new Date(now()).toISOString(),
        expiresAt: end === null ? null : new Date(end).toISOString(),
        // Dominio por el que llegó la petición: el de la web (reescritura /api/*) o el propio de la API.
        host: headerValue(request.headers.host),
        socketIp: clientIpOf(request, 'socket'),
        headers: {
          'x-forwarded-for': headerValue(request.headers['x-forwarded-for']),
          'x-vercel-forwarded-for': headerValue(request.headers['x-vercel-forwarded-for']),
          'x-real-ip': headerValue(request.headers['x-real-ip']),
          forwarded: headerValue(request.headers.forwarded),
          'x-vercel-id': headerValue(request.headers['x-vercel-id']),
        },
        // Qué IP usaría el rate-limit con cada valor de CLIENT_IP_SOURCE.
        clientIp: { configuredSource, socket: clientIpOf(request, 'socket'), vercel: clientIpOf(request, 'vercel') },
      }
    },
  )
}
