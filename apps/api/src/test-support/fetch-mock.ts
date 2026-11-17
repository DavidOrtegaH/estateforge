import type { FetchImpl } from '../ai-media/safe-fetch.js'

// fetch simulado para las pruebas de contrato de los proveedores de IA: registra cada llamada (URL, método,
// cabeceras y cuerpo) y responde lo que diga la prueba. Ninguna prueba llama a un proveedor real.

export interface RecordedCall {
  url: string
  method: string
  headers: Headers
  /** Cuerpo JSON ya interpretado, o los campos de un formulario multipart; undefined si no hay cuerpo. */
  body: Record<string, unknown> | undefined
  redirect: RequestRedirect | undefined
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
export const bytesResponse = (bytes: Buffer, contentType: string, status = 200) => new Response(new Uint8Array(bytes), { status, headers: { 'content-type': contentType } })

export function fetchMock(handler: (call: RecordedCall, index: number) => Response | Promise<Response>) {
  const calls: RecordedCall[] = []
  const impl: FetchImpl = async (url, init) => {
    let body: Record<string, unknown> | undefined
    if (typeof init.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>
    else if (init.body instanceof FormData) body = Object.fromEntries([...init.body.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : '[archivo]']))
    const call: RecordedCall = { url, method: init.method ?? 'GET', headers: new Headers(init.headers), body, redirect: init.redirect }
    calls.push(call)
    return handler(call, calls.length - 1)
  }
  return { impl, calls }
}

/** Todo lo que salió hacia el proveedor, en texto: para comprobar que una clave no viaja donde no debe. */
export function serialized(calls: RecordedCall[], part: 'url' | 'body'): string {
  return calls.map(call => (part === 'url' ? call.url : JSON.stringify(call.body ?? {}))).join('\n')
}
