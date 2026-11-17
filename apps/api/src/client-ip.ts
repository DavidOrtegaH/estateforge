import { isIP } from 'node:net'

import type { FastifyRequest } from 'fastify'

// Origen de la IP del cliente para el rate-limit y Turnstile (MD-4, DA-57).
//
// Fastify se construye sin trustProxy, así que request.ip es siempre la dirección del socket: nunca
// se lee X-Forwarded-For por defecto y un cliente no puede falsear su IP enviando esa cabecera.
//
// CLIENT_IP_SOURCE=vercel solo se admite dentro de Vercel (VERCEL=1). Vercel construye
// X-Forwarded-For a partir de la conexión TCP y sobrescribe el valor que envíe el cliente, y repite el
// mismo valor en X-Vercel-Forwarded-For (documentación de Vercel, «Request headers»). Fuera de Vercel
// esas cabeceras las puede escribir cualquiera, por eso el modo se rechaza al arrancar.
//
// Limitación: si delante de Vercel hay otro proxy (por ejemplo, la reescritura /api/* desde otro
// proyecto), Vercel pone la IP de ese proxy, no la del cliente. Debe verificarse en el despliegue.

export type ClientIpSource = 'socket' | 'vercel'

export class ClientIpConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClientIpConfigError'
  }
}

export function readClientIpSource(env: NodeJS.ProcessEnv): ClientIpSource {
  const raw = env.CLIENT_IP_SOURCE?.trim().toLowerCase()
  if (!raw || raw === 'socket') return 'socket'
  if (raw === 'vercel') {
    if (env.VERCEL !== '1') throw new ClientIpConfigError('CLIENT_IP_SOURCE=vercel solo se admite al ejecutarse en Vercel (VERCEL=1).')
    return 'vercel'
  }
  throw new ClientIpConfigError('CLIENT_IP_SOURCE debe ser «socket» o «vercel».')
}

/**
 * Una sola IP válida (IPv4 o IPv6), normalizada; null si el valor está vacío, no es una IP o contiene
 * varias (no se admite una lista: X-Vercel-Forwarded-For lleva una dirección y una lista indicaría un
 * valor inesperado). Las IPv4 mapeadas en IPv6 (::ffff:a.b.c.d) se devuelven como IPv4.
 */
export function singleIp(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    if (value.length !== 1) return null
    value = value[0]
  }
  const raw = value?.trim()
  if (!raw || raw.includes(',') || raw.length > 64) return null
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw)
  const candidate = mapped ? mapped[1] : raw
  const version = isIP(candidate)
  if (version === 4) return candidate
  if (version === 6) return candidate.toLowerCase()
  return null
}

/**
 * Socket: request.ip (sin trustProxy, nunca una cabecera). Vercel: solo X-Vercel-Forwarded-For, la
 * cabecera que escribe Vercel (no se mira X-Forwarded-For); si falta, está vacía, no es una IP o trae
 * varias, se usa la del socket, que en Vercel agrupa a los clientes en el mismo cupo (fallo seguro).
 */
export function clientIpOf(request: Pick<FastifyRequest, 'ip' | 'headers'>, source: ClientIpSource): string {
  if (source === 'vercel') return singleIp(request.headers['x-vercel-forwarded-for']) ?? request.ip
  return request.ip
}

let configured: ClientIpSource | null = null

/** Valida CLIENT_IP_SOURCE al construir la aplicación: una configuración insegura impide arrancar. */
export function configureClientIp(env: NodeJS.ProcessEnv = process.env): ClientIpSource {
  configured = readClientIpSource(env)
  return configured
}

/** IP del cliente con el origen configurado. Síncrona: se usa como keyGenerator del rate-limit. */
export function requestClientIp(request: Pick<FastifyRequest, 'ip' | 'headers'>): string {
  return clientIpOf(request, configured ?? 'socket')
}
