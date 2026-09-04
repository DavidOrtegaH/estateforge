import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { FastifyInstance } from 'fastify'

describe('CORS Configuration & Environment Tests', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    // Definimos un origen personalizado para verificar que no esté hardcodeado
    vi.stubEnv('CORS_ORIGIN', 'http://frontend-permitido.com')
    
    // Importamos app dinámicamente para forzar la reevaluación del env
    const { buildApp } = await import('./app.js')
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    vi.unstubAllEnvs()
  })

  it('debe permitir peticiones desde el CORS_ORIGIN configurado', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'http://frontend-permitido.com',
        'access-control-request-method': 'GET',
      },
    })

    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe('http://frontend-permitido.com')
  })

  it('debe denegar las peticiones desde orígenes no autorizados', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'http://sitio-malicioso.com',
        'access-control-request-method': 'GET',
      },
    })

    // Si el origen no coincide, Fastify CORS no incluye la cabecera Access-Control-Allow-Origin
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})