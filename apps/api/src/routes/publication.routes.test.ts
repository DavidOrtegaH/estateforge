import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../middleware/auth.middleware.js', () => ({
  requireAuth: async () => undefined,
}))

vi.mock('../services/generation.service.js', () => ({
  generateListing: vi.fn(),
  generateListingForExistingProperty: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: {} }))

import { generationRoutes } from './generation.routes.js'

// Guardas de la decisión de producto: EstateForge registra publicaciones, no las realiza.

const root = resolve(import.meta.dirname, '../../../..')

const SOURCES = ['apps/api/src', 'apps/web/src', 'packages/shared/src']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)

    if (name === 'generated' || name === 'node_modules') {
      return []
    }

    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const productionFiles = SOURCES.flatMap((source) => walk(join(root, source)))
  .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
  .map((path) => ({
    path: relative(root, path).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }))

describe('sin publicación automática', () => {
  it('el Checklist solo expone lectura y guardado', async () => {
    const routes: string[] = []
    const app = Fastify()

    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) {
        if (route.url.includes('publication') && method !== 'HEAD') {
          routes.push(`${method} ${route.url}`)
        }
      }
    })

    await app.register(generationRoutes)
    await app.ready()
    await app.close()

    expect(routes.sort()).toEqual([
      'GET /api/generations/:id/publications',
      'PUT /api/generations/:id/publications',
    ])
  })

  it('ninguna ruta publica, republica o sincroniza con un portal', () => {
    const route = /\.(?:get|post|put|patch|delete)\(\s*['"`]([^'"`]+)/g
    const urls = productionFiles
      .filter(({ path }) => path.includes('/routes/'))
      .flatMap(({ text }) => [...text.matchAll(route)].map((match) => match[1]))

    expect(urls.length).toBeGreaterThan(20)
    expect(urls.filter((url) => /publish|publicar|republi|sync|portal|webhook/i.test(url))).toEqual([])
  })

  it('solo el catálogo central nombra los dominios de los portales', () => {
    const domains = /idealista\.|fotocasa\.|pisos\.com|yaencontre\.|habitaclia\./i

    expect(
      productionFiles.filter(({ text }) => domains.test(text)).map(({ path }) => path),
    ).toEqual(['packages/shared/src/publications.ts'])
  })

  it('la interfaz no ofrece acciones de publicar', () => {
    const action = />\s*(?:Re)?[Pp]ublicar\b|>\s*Sincronizar\b|publicar autom/i

    expect(
      productionFiles
        .filter(({ path, text }) => path.endsWith('.tsx') && action.test(text))
        .map(({ path }) => path),
    ).toEqual([])
  })

  it('no hay tareas programadas ni colas para publicar', () => {
    for (const manifest of ['apps/api/package.json', 'apps/web/package.json']) {
      expect(readFileSync(join(root, manifest), 'utf8')).not.toMatch(/cron|bull|agenda|bree/i)
    }

    expect(
      productionFiles
        .filter(({ text }) => /schedule\(|new CronJob/.test(text))
        .map(({ path }) => path),
    ).toEqual([])
  })

  it('la validación y las rutas del Checklist nunca hacen peticiones de red', () => {
    for (const file of ['packages/shared/src/publications.ts', 'apps/api/src/routes/publication.routes.ts']) {
      expect(
        productionFiles.find(({ path }) => path === file)?.text,
      ).not.toMatch(/\bfetch\(|https?\.request|axios|undici/)
    }
  })

  it('las integraciones compartidas siguen presentes', () => {
    for (const file of [
      'apps/api/src/services/email.service.ts',
      'apps/api/src/services/turnstile.service.ts',
      'apps/api/src/ai/gemini.provider.ts',
      'apps/api/src/ai/openai.provider.ts',
    ]) {
      expect(productionFiles.some(({ path }) => path === file)).toBe(true)
    }
  })
})

describe('conflicto de escritura frente a base no disponible (DA-37)', () => {
  const known = (code: string, message: string) => Object.assign(new Error(message), { name: 'PrismaClientKnownRequestError', code, meta: {} })

  it.each([
    ['unicidad (P2002)', known('P2002', 'Unique constraint failed')],
    ['conflicto de escritura (P2034)', known('P2034', 'write conflict')],
    ['transacción caducada esperando un bloqueo (P2028)', known('P2028', 'Transaction API error: Transaction already closed: the timeout for this transaction was 5000 ms')],
  ])('%s: 409', async (_label, error) => {
    const { isWriteConflict } = await import('./publication.routes.js')
    expect(isWriteConflict(error)).toBe(true)
  })

  it.each([
    ['sin conexión dentro de maxWait (P2028)', known('P2028', 'Transaction API error: Unable to start a transaction in the given time.')],
    ['límite de conexiones (P2037)', known('P2037', 'Too many database connections opened')],
    ['pool agotado', new Error('timeout exceeded when trying to connect')],
  ])('%s: no es un conflicto, llega al manejador global (503)', async (_label, error) => {
    const { isWriteConflict } = await import('./publication.routes.js')
    expect(isWriteConflict(error)).toBe(false)
  })
})
