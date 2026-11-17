// Páginas públicas, rutas de la aplicación y SEO de la web. Lo usan vite.config.ts (construcción,
// desarrollo y vista previa) y las pruebas, que comprueban que vercel.json dice lo mismo.

/** Páginas estáticas e indexables. El archivo HTML está en apps/web y se sirve sin extensión. */
export const PUBLIC_PAGES = [
  { file: 'index.html', path: '/' },
  { file: 'privacidad.html', path: '/privacidad' },
  { file: 'condiciones.html', path: '/condiciones' },
] as const

/** Entradas HTML que no se indexan nunca: la SPA y la página de error. */
export const PRIVATE_PAGES = [
  { file: 'app.html', path: '/app' },
  { file: '404.html', path: '/404' },
] as const

/**
 * Prefijos de las rutas de la SPA (App.tsx). El servidor responde a cada uno, y a todo lo que
 * cuelga de él, con app.html. Cualquier otra ruta que no sea un archivo es un 404 real.
 */
export const APP_ROUTE_PREFIXES = [
  '/panel',
  '/inmuebles',
  '/historial',
  '/cuenta',
  '/admin',
  '/login',
  '/registro',
  '/recuperar-contrasena',
  '/restablecer-contrasena',
  '/recuperar-cuenta',
  '/verificar-email',
] as const

export type SiteEnv = Partial<Record<'SITE_URL' | 'VERCEL_ENV' | 'VERCEL_PROJECT_PRODUCTION_URL', string>>

export type Site = {
  /** Origen canónico (https://dominio, sin barra final) o null si no se conoce. */
  url: string | null
  /** Solo se indexa una construcción de producción con un origen conocido. */
  indexable: boolean
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseOrigin(value: string, source: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${source} no es una URL válida.`)
  }
  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${source} debe usar https:// (http:// solo en localhost).`)
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`${source} debe ser solo un origen, por ejemplo https://ejemplo.com, sin ruta ni parámetros.`)
  }
  return url.origin
}

/**
 * Origen e indexación según el entorno de construcción.
 * - SITE_URL, si está definida, manda (por ejemplo, un dominio propio).
 * - En Vercel, la producción usa VERCEL_PROJECT_PRODUCTION_URL y las vistas previas no se indexan.
 * - Fuera de Vercel y sin SITE_URL no hay origen: ni canónica ni mapa del sitio, y no se indexa.
 */
export function resolveSite(env: SiteEnv): Site {
  const explicit = env.SITE_URL?.trim()
  const vercelEnv = env.VERCEL_ENV?.trim()
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()

  let url: string | null = null
  if (explicit) {
    url = parseOrigin(explicit, 'SITE_URL')
  } else if (vercelEnv === 'production' && production) {
    url = parseOrigin(`https://${production}`, 'VERCEL_PROJECT_PRODUCTION_URL')
  }

  const preview = Boolean(vercelEnv) && vercelEnv !== 'production'
  const local = url !== null && LOCAL_HOSTS.has(new URL(url).hostname)
  return { url, indexable: url !== null && !preview && !local }
}

export function robotsTxt(site: Site): string {
  if (!site.indexable || !site.url) {
    return 'User-agent: *\nDisallow: /\n'
  }
  return `User-agent: *\nDisallow: /api/\n\nSitemap: ${site.url}/sitemap.xml\n`
}

export function sitemapXml(site: Site): string | null {
  if (!site.indexable || !site.url) return null
  const urls = PUBLIC_PAGES.map(page => `  <url>\n    <loc>${site.url}${page.path}</loc>\n  </url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Etiquetas que sustituyen a <!--seo:head--> en una página pública. */
export function publicHeadTags(site: Site, path: string): string {
  const tags: string[] = []
  if (!site.indexable) tags.push('<meta name="robots" content="noindex" />')
  if (site.url) {
    const href = escapeAttr(`${site.url}${path}`)
    tags.push(`<link rel="canonical" href="${href}" />`)
    tags.push(`<meta property="og:url" content="${href}" />`)
    tags.push(`<meta property="og:image" content="${escapeAttr(`${site.url}/og-image.png`)}" />`)
    tags.push('<meta property="og:image:width" content="1200" />')
    tags.push('<meta property="og:image:height" content="630" />')
    tags.push('<meta property="og:image:alt" content="EstateForge: anuncios inmobiliarios, carteles y vídeos" />')
    if (path === '/') {
      const data = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'EstateForge', url: `${site.url}/`, inLanguage: 'es' }
      tags.push(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`)
    }
  }
  return tags.join('\n    ')
}

/** Página HTML que corresponde a una ruta pedida en desarrollo o en la vista previa local. */
export function htmlForPath(pathname: string): string | null {
  const page = [...PUBLIC_PAGES, ...PRIVATE_PAGES].find(entry => entry.path === pathname && entry.path !== '/')
  if (page) return `/${page.file}`
  const app = APP_ROUTE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
  return app ? '/app.html' : null
}
