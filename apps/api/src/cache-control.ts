// Política de caché de las respuestas de la API (endurecimiento).
//
// Sin Cache-Control propio, Vercel añade `public, max-age=0, must-revalidate`, que permite guardar
// la respuesta en cachés compartidas. Las respuestas de la API pueden llevar datos de la cuenta, así
// que por defecto se envían con `no-store`.
//
// Se conserva una política que haya fijado la ruta solo si ya impide guardarla en una caché
// compartida (`no-store` o `private`): p. ej., `private, no-cache` con ETag de los archivos de la
// galería, `private, max-age=N` de la reproducción firmada o `private, no-store` de las URL
// firmadas. Cualquier otra (o ninguna) se sustituye por `no-store`.

export const API_DEFAULT_CACHE_CONTROL = 'no-store'

function directives(value: unknown): string[] {
  const text = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : ''
  return text.split(',').map(part => part.trim().split('=')[0].trim().toLowerCase()).filter(Boolean)
}

/** true si la cabecera ya impide guardar la respuesta en una caché compartida. */
export function keepsRouteCacheControl(value: unknown): boolean {
  const list = directives(value)
  return list.includes('no-store') || list.includes('private')
}
