// Lectura de vercel.json para la vista previa local y las pruebas. Solo admite el subconjunto de
// patrones que usa este proyecto, y lo exige: un patrón distinto falla en vez de interpretarse mal.
//   /ruta exacta · /prefijo/:path* (el prefijo y todo lo que cuelga de él) · /(.*) (todo)
import fs from 'node:fs'

export type VercelHeaderRule = { source: string; headers: { key: string; value: string }[] }
export type VercelRewrite = { source: string; destination: string }
export type VercelConfig = {
  cleanUrls?: boolean
  trailingSlash?: boolean
  headers?: VercelHeaderRule[]
  rewrites?: VercelRewrite[]
  [key: string]: unknown
}

const SEGMENT = /^[a-z0-9._-]+$/

export function compileSource(source: string): (pathname: string) => boolean {
  if (source === '/(.*)') return () => true
  const wildcard = source.endsWith('/:path*')
  const base = wildcard ? source.slice(0, -'/:path*'.length) : source
  const segments = base.split('/').slice(1)
  if (!base.startsWith('/') || (base !== '/' && segments.some(segment => !SEGMENT.test(segment)))) {
    throw new Error(`Patrón de vercel.json no admitido: ${source}`)
  }
  if (!wildcard) return pathname => pathname === base
  return pathname => pathname === base || pathname.startsWith(`${base}/`)
}

export function loadVercelConfig(file: string): VercelConfig {
  const config = JSON.parse(fs.readFileSync(file, 'utf8')) as VercelConfig
  for (const rule of config.headers ?? []) compileSource(rule.source)
  for (const rule of config.rewrites ?? []) compileSource(rule.source)
  return config
}

/** Cabeceras que Vercel añadiría a una ruta: todas las reglas que coinciden, en orden. */
export function headersFor(config: VercelConfig, pathname: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const rule of config.headers ?? []) {
    if (!compileSource(rule.source)(pathname)) continue
    for (const header of rule.headers) result.set(header.key, header.value)
  }
  return result
}

/** Destino de la primera reescritura que coincide (Vercel solo reescribe si no hay archivo). */
export function rewriteFor(config: VercelConfig, pathname: string): string | null {
  return (config.rewrites ?? []).find(rule => compileSource(rule.source)(pathname))?.destination ?? null
}
