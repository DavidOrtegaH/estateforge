import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { htmlForPath, PRIVATE_PAGES, PUBLIC_PAGES, publicHeadTags, resolveSite, robotsTxt, sitemapXml } from './tooling/site.ts'
import { headersFor, loadVercelConfig } from './tooling/vercel-config.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Rutas limpias y SPA acotada, igual que en Vercel (vercel.json), para `vite` y `vite preview`.
const routing: Connect.NextHandleFunction = (req, _res, next) => {
  const [pathname, query] = (req.url ?? '/').split('?')
  const target = pathname === '/' ? '/index.html' : htmlForPath(pathname)
  if (target) req.url = target + (query ? `?${query}` : '')
  next()
}

function site(): Plugin {
  const config = resolveSite(process.env)
  const vercel = loadVercelConfig(path.join(__dirname, 'vercel.json'))
  return {
    name: 'estateforge-site',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const file = path.basename(ctx.filename)
        const page = PUBLIC_PAGES.find(entry => entry.file === file)
        return html.replace('<!--seo:head-->', page ? publicHeadTags(config, page.path) : '')
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(config) })
      const sitemap = sitemapXml(config)
      if (sitemap) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap })
    },
    configureServer(server) {
      server.middlewares.use(routing)
    },
    configurePreviewServer(server) {
      // La vista previa local aplica también las cabeceras de vercel.json (CSP incluida), para
      // probar con ellas antes de desplegar.
      // EF_CSP_REPORT=archivo: las pruebas E2E registran ahí cada violación de la CSP.
      const report = process.env.EF_CSP_REPORT?.trim()
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '/').split('?')[0]
        if (report && pathname === '/__csp-report' && req.method === 'POST') {
          let body = ''
          req.on('data', chunk => (body += chunk))
          req.on('end', () => {
            fs.appendFileSync(report, `${body.replace(/\s+/g, ' ')}\n`)
            res.statusCode = 204
            res.end()
          })
          return
        }
        for (const [key, value] of headersFor(vercel, pathname)) {
          res.setHeader(key, report && key === 'Content-Security-Policy' ? `${value}; report-uri /__csp-report` : value)
        }
        next()
      })
      server.middlewares.use(routing)
      // Lo que no es un archivo ni una ruta conocida recibe la página 404 con estado 404.
      return () => {
        server.middlewares.use((_req, res) => {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(fs.readFileSync(path.resolve(server.config.root, server.config.build.outDir, '404.html')))
        })
      }
    },
  }
}

const pages = Object.fromEntries(
  [...PUBLIC_PAGES, ...PRIVATE_PAGES].map(page => [page.file.replace('.html', ''), path.resolve(__dirname, page.file)]),
)

// Vista previa con la API bajo el mismo origen, como en producción: EF_PREVIEW_API=http://127.0.0.1:3000
const previewApi = process.env.EF_PREVIEW_API?.trim()

export default defineConfig({
  // Varias páginas: sin respuesta SPA para cualquier ruta (ver la función routing).
  appType: 'mpa',
  plugins: [react(), tailwindcss(), site()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: { input: pages },
  },
  preview: previewApi ? { proxy: { '/api': { target: previewApi, changeOrigin: false } } } : undefined,
})

// Evita que una entrada HTML se quede fuera de la construcción por error.
for (const file of Object.values(pages)) {
  if (!fs.existsSync(file)) throw new Error(`Falta la página ${file}`)
}
