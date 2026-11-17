import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { API_DEFAULT_CACHE_CONTROL, keepsRouteCacheControl } from './cache-control.js'

describe('política de caché de la API', () => {
  it.each([
    'no-store',
    'private, no-store',
    'private, no-cache',
    'private, max-age=120',
    'PRIVATE',
    ' no-store ',
  ])('conserva la política privada de la ruta: %s', value => {
    expect(keepsRouteCacheControl(value)).toBe(true)
  })

  it.each([
    undefined,
    null,
    '',
    'public, max-age=0, must-revalidate',
    'public, max-age=3600',
    'max-age=60',
    'no-cache',
    's-maxage=60',
    'no-store-x',
    'privatex',
    42,
  ])('sustituye por no-store lo que no impide guardarla en cachés compartidas: %s', value => {
    expect(keepsRouteCacheControl(value)).toBe(false)
  })

  it('valores en lista se evalúan como una sola cabecera', () => {
    expect(keepsRouteCacheControl(['max-age=60', 'private'])).toBe(true)
    expect(keepsRouteCacheControl(['public', 'max-age=60'])).toBe(false)
  })

  it('aplicada como el onSend global: no-store por defecto, privada de la ruta intacta, pública sustituida', async () => {
    const app = Fastify()
    // Réplica exacta de la condición de app.ts (su forma la fija app.routes-coverage.test.ts).
    app.addHook('onSend', (_request, reply, _payload, done) => {
      if (!keepsRouteCacheControl(reply.getHeader('Cache-Control'))) reply.header('Cache-Control', API_DEFAULT_CACHE_CONTROL)
      done()
    })
    app.get('/sin', async () => ({ ok: true }))
    app.get('/privada', async (_request, reply) => reply.header('Cache-Control', 'private, no-cache').send({ ok: true }))
    app.get('/publica', async (_request, reply) => reply.header('Cache-Control', 'public, max-age=600').send({ ok: true }))
    app.get('/error', async () => { throw new Error('x') })

    expect((await app.inject({ url: '/sin' })).headers['cache-control']).toBe('no-store')
    expect((await app.inject({ url: '/privada' })).headers['cache-control']).toBe('private, no-cache')
    expect((await app.inject({ url: '/publica' })).headers['cache-control']).toBe('no-store')
    expect((await app.inject({ url: '/error' })).headers['cache-control']).toBe('no-store')
    expect((await app.inject({ url: '/no-existe' })).headers['cache-control']).toBe('no-store')
  })
})
