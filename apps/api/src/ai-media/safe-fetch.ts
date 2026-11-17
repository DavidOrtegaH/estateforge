import { AiMediaError } from './errors.js'

// Cliente HTTP de las llamadas a proveedores de IA (DA-73, OWASP SSRF). Solo admite https, hosts de una
// lista cerrada que define el registro (nunca el usuario; una entrada «.dominio» admite sus subdominios,
// para los hosts de entrega que el proveedor documenta como variables), sin puerto ni credenciales y sin
// seguir redirecciones. Limita el tiempo y los bytes leídos. Nunca registra la URL, las cabeceras ni el
// cuerpo, y sus errores no incluyen la respuesta del proveedor.

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>

export interface SafeFetchOptions {
  allowedHosts: readonly string[]
  timeoutMs: number
  maxBytes: number
  fetchImpl?: FetchImpl
  signal?: AbortSignal
}

export interface SafeResponse {
  status: number
  bytes: Buffer
  contentType: string | null
  json<T = unknown>(): T | null
}

/** Comprueba que una URL apunta a un host autorizado. Lanza si no. */
export function assertAllowedUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AiMediaError('AI_SSRF_BLOCKED', 'Destino no permitido.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new AiMediaError('AI_SSRF_BLOCKED', 'Destino no permitido.')
  }
  const host = url.hostname.toLowerCase()
  // Una IP literal nunca es un host de proveedor (redes privadas, metadatos de la nube…).
  if (/^[0-9.]+$/.test(host) || host.includes(':') || host.startsWith('[')) throw new AiMediaError('AI_SSRF_BLOCKED', 'Destino no permitido.')
  const matches = (allowed: string) => {
    const entry = allowed.toLowerCase()
    return entry.startsWith('.') ? host.endsWith(entry) && host.length > entry.length : host === entry
  }
  if (!allowedHosts.some(matches)) throw new AiMediaError('AI_SSRF_BLOCKED', 'Destino no permitido.')
  return url
}

export async function safeFetch(raw: string, init: RequestInit, options: SafeFetchOptions): Promise<SafeResponse> {
  const url = assertAllowedUrl(raw, options.allowedHosts)
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url.toString(), { ...init, redirect: 'error', signal })
  } catch (error) {
    if (error instanceof AiMediaError) throw error
    // Sin detalles: el mensaje de fetch podría incluir la URL.
    throw new AiMediaError(timeout.aborted ? 'AI_PROVIDER_UNCERTAIN' : 'AI_PROVIDER_UNAVAILABLE', timeout.aborted ? 'El proveedor no ha respondido a tiempo.' : 'No se ha podido conectar con el proveedor.')
  }
  // Una redirección nunca se sigue (redirect: 'error' ya la convierte en error; esto cubre opaqueredirect).
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new AiMediaError('AI_SSRF_BLOCKED', 'El proveedor ha intentado redirigir la petición.')
  }
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > options.maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new AiMediaError('AI_INVALID_OUTPUT', 'La respuesta del proveedor supera el tamaño máximo.')
  }
  const chunks: Buffer[] = []
  let total = 0
  if (response.body) {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new AiMediaError('AI_PROVIDER_UNCERTAIN', 'Se ha interrumpido la respuesta del proveedor.')
      })
      if (done) break
      total += value.byteLength
      if (total > options.maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new AiMediaError('AI_INVALID_OUTPUT', 'La respuesta del proveedor supera el tamaño máximo.')
      }
      chunks.push(Buffer.from(value))
    }
  }
  const bytes = Buffer.concat(chunks)
  return {
    status: response.status,
    bytes,
    contentType: response.headers.get('content-type'),
    json<T>() {
      try {
        return JSON.parse(bytes.toString('utf8')) as T
      } catch {
        return null
      }
    },
  }
}
