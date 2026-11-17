import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { APP_ROUTE_PREFIXES, htmlForPath, PRIVATE_PAGES, PUBLIC_PAGES, publicHeadTags, resolveSite, robotsTxt, sitemapXml } from './site.ts'
import { compileSource, headersFor, loadVercelConfig, rewriteFor } from './vercel-config.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const vercel = loadVercelConfig(path.join(root, 'vercel.json'))

describe('origen e indexación', () => {
  it('sin SITE_URL ni Vercel no hay origen y no se indexa', () => {
    expect(resolveSite({})).toEqual({ url: null, indexable: false })
  })

  it('SITE_URL se normaliza al origen', () => {
    expect(resolveSite({ SITE_URL: 'https://Ejemplo.com/' })).toEqual({ url: 'https://ejemplo.com', indexable: true })
  })

  it('la producción de Vercel usa su dominio de producción', () => {
    expect(resolveSite({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'estateforge.vercel.app' }))
      .toEqual({ url: 'https://estateforge.vercel.app', indexable: true })
  })

  it('una vista previa de Vercel nunca se indexa, aunque tenga SITE_URL', () => {
    expect(resolveSite({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'estateforge.vercel.app' }))
      .toEqual({ url: null, indexable: false })
    expect(resolveSite({ VERCEL_ENV: 'preview', SITE_URL: 'https://ejemplo.com' }).indexable).toBe(false)
  })

  it('localhost se acepta para probar, pero no se indexa', () => {
    expect(resolveSite({ SITE_URL: 'http://localhost:4173' })).toEqual({ url: 'http://localhost:4173', indexable: false })
  })

  it.each(['ejemplo.com', 'http://ejemplo.com', 'https://ejemplo.com/ruta', 'https://ejemplo.com/?a=1', 'https://u:p@ejemplo.com'])(
    'rechaza SITE_URL=%s',
    value => {
      expect(() => resolveSite({ SITE_URL: value })).toThrow()
    },
  )
})

describe('robots.txt y sitemap.xml', () => {
  const production = resolveSite({ SITE_URL: 'https://ejemplo.com' })

  it('en producción apunta al mapa del sitio y excluye la API', () => {
    expect(robotsTxt(production)).toBe('User-agent: *\nDisallow: /api/\n\nSitemap: https://ejemplo.com/sitemap.xml\n')
  })

  it('el mapa contiene solo las páginas públicas canónicas', () => {
    const xml = sitemapXml(production) ?? ''
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])).toEqual([
      'https://ejemplo.com/',
      'https://ejemplo.com/privacidad',
      'https://ejemplo.com/condiciones',
    ])
  })

  it('sin origen indexable bloquea el rastreo y no genera mapa', () => {
    expect(robotsTxt(resolveSite({}))).toBe('User-agent: *\nDisallow: /\n')
    expect(sitemapXml(resolveSite({ VERCEL_ENV: 'preview' }))).toBeNull()
  })
})

describe('cabecera de las páginas públicas', () => {
  it('añade canónica, Open Graph y datos estructurados veraces en la portada', () => {
    const tags = publicHeadTags(resolveSite({ SITE_URL: 'https://ejemplo.com' }), '/')
    expect(tags).toContain('<link rel="canonical" href="https://ejemplo.com/" />')
    expect(tags).toContain('<meta property="og:image" content="https://ejemplo.com/og-image.png" />')
    expect(tags).not.toContain('noindex')
    const json = JSON.parse(tags.match(/<script type="application\/ld\+json">(.*)<\/script>/)?.[1] ?? '{}')
    expect(json).toEqual({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'EstateForge', url: 'https://ejemplo.com/', inLanguage: 'es' })
  })

  it('sin origen no inventa URLs y pide no indexar', () => {
    expect(publicHeadTags(resolveSite({}), '/privacidad')).toBe('<meta name="robots" content="noindex" />')
  })

  it.each(PUBLIC_PAGES)('$file tiene título, descripción, idioma y el marcador de SEO', ({ file }) => {
    const html = read(file)
    expect(html).toMatch(/<html lang="es">/)
    expect(html).toMatch(/<title>[^<]{10,70}<\/title>/)
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]{50,160}"/)
    expect(html).toContain('<!--seo:head-->')
    expect(html).not.toMatch(/noindex/)
    expect(html).toMatch(/<h1>[^<]+<\/h1>/)
  })

  it.each(PRIVATE_PAGES)('$file no se indexa', ({ file }) => {
    expect(read(file)).toMatch(/<meta name="robots" content="noindex/)
  })

  it('ninguna página menciona dominios ni datos inventados', () => {
    for (const { file } of [...PUBLIC_PAGES, ...PRIVATE_PAGES]) {
      const html = read(file)
      expect(html).not.toMatch(/localhost|example\.com|ejemplo\.com|TFM|Máster|testimonio|€/i)
    }
  })
})

describe('rutas de la aplicación', () => {
  const routes = [...read('src/App.tsx').matchAll(/<Route\s+path=(?:"([^"]+)"|\{APP_HOME\})/g)].map(match => match[1] ?? '/panel')

  it('cada ruta de App.tsx cuelga de un prefijo conocido (o es «/» y el comodín)', () => {
    const outside = routes.filter(route => route !== '/' && route !== '*' && !APP_ROUTE_PREFIXES.some(prefix => route === prefix || route.startsWith(`${prefix}/`)))
    expect(outside).toEqual([])
    expect(routes).toContain('/panel')
  })

  it('cada prefijo corresponde a alguna ruta de App.tsx', () => {
    expect(APP_ROUTE_PREFIXES.filter(prefix => !routes.some(route => route === prefix || route.startsWith(`${prefix}/`)))).toEqual([])
  })

  it.each([
    ['/', null],
    ['/privacidad', '/privacidad.html'],
    ['/condiciones', '/condiciones.html'],
    ['/panel', '/app.html'],
    ['/inmuebles/12', '/app.html'],
    ['/recuperar-cuenta/solicitar', '/app.html'],
    ['/inmueblesx', null],
    ['/no-existe', null],
    ['/api/auth/me', null],
  ])('%s → %s', (pathname, expected) => {
    expect(htmlForPath(pathname)).toBe(expected)
  })
})

describe('vercel.json', () => {
  it('reescribe a la SPA exactamente los prefijos de la aplicación, y nada más', () => {
    expect(vercel.cleanUrls).toBe(true)
    const appRewrites = (vercel.rewrites ?? []).filter(rule => rule.destination === '/app')
    expect(appRewrites.map(rule => rule.source)).toEqual(APP_ROUTE_PREFIXES.map(prefix => `${prefix}/:path*`))
    const apiRewrites = (vercel.rewrites ?? []).filter(rule => rule.destination !== '/app')
    expect(apiRewrites).toEqual([{ source: '/api/:path*', destination: 'https://estateforge-api.vercel.app/api/:path*' }])
    expect(vercel.rewrites?.[0]).toEqual(apiRewrites[0])
  })

  it('no reescribe las páginas públicas, la API, robots.txt ni sitemap.xml a la SPA', () => {
    for (const pathname of ['/', '/privacidad', '/condiciones', '/robots.txt', '/sitemap.xml', '/no-existe']) {
      expect(rewriteFor(vercel, pathname), pathname).toBeNull()
    }
    expect(rewriteFor(vercel, '/api/auth/me')).toBe('https://estateforge-api.vercel.app/api/:path*')
  })

  it('las rutas privadas y la API llevan X-Robots-Tag; las públicas no', () => {
    for (const pathname of ['/app', '/panel', '/inmuebles/3', '/cuenta', '/admin', '/login', '/registro', '/verificar-email', '/api/x']) {
      expect(headersFor(vercel, pathname).get('X-Robots-Tag'), pathname).toMatch(/noindex/)
    }
    for (const pathname of ['/', '/privacidad', '/condiciones', '/robots.txt', '/sitemap.xml']) {
      expect(headersFor(vercel, pathname).has('X-Robots-Tag'), pathname).toBe(false)
    }
  })

  it('todas las respuestas llevan las cabeceras de seguridad y una CSP sin scripts en línea ni eval', () => {
    const headers = headersFor(vercel, '/inmuebles/1')
    for (const key of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy']) {
      expect(headers.has(key), key).toBe(true)
    }
    const csp = headers.get('Content-Security-Policy') ?? ''
    const scripts = csp.split(';').find(part => part.trim().startsWith('script-src')) ?? ''
    expect(scripts).not.toMatch(/unsafe-inline|unsafe-eval|\*(?!\.)/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    // Vercel ya fuerza HTTPS; en http://localhost la directiva convertía en https las redirecciones
    // firmadas de las fotografías y estas dejaban de cargarse.
    expect(csp).not.toContain('upgrade-insecure-requests')
    expect(headers.get('Permissions-Policy')).toContain('microphone=()')
  })

  it('los recursos con huella se guardan un año; el HTML no', () => {
    expect(headersFor(vercel, '/assets/index-abc.js').get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(headersFor(vercel, '/').has('Cache-Control')).toBe(false)
  })

  it('usa solo el dominio estable de la API, sin marcadores ni destinos locales', () => {
    const text = read('vercel.json')
    expect(text).not.toMatch(/<[^>]+>|localhost/)
    expect(text.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/g)).toEqual(['https://estateforge-api.vercel.app'])
  })

  it('el lector solo acepta los patrones que entiende', () => {
    expect(() => compileSource('/:path((?!api/).*)')).toThrow()
    expect(compileSource('/cuenta/:path*')('/cuenta')).toBe(true)
    expect(compileSource('/cuenta/:path*')('/cuentas')).toBe(false)
  })
})
