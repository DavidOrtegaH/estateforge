import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteUserAIKey: vi.fn(),
  getStoredAIKeyStatus: vi.fn(),
  saveUserAIKey: vi.fn(),
}))

vi.mock('../middleware/auth.middleware.js', () => ({
  requireAuth: async (request: { userId?: string | null }) => {
    request.userId = 'user-1'
  },
}))

vi.mock('../services/user-ai-key.service.js', () => ({
  deleteUserAIKey: mocks.deleteUserAIKey,
  getStoredAIKeyStatus: mocks.getStoredAIKeyStatus,
  saveUserAIKey: mocks.saveUserAIKey,
}))

import { aiKeyRoutes } from './ai-key.routes.js'

describe('AI key routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()

    mocks.getStoredAIKeyStatus.mockResolvedValue({
      gemini: true,
      openai: false,
    })
    mocks.saveUserAIKey.mockResolvedValue(undefined)
    mocks.deleteUserAIKey.mockResolvedValue(undefined)

    app = Fastify()
    app.decorateRequest('userId', null)
    await app.register(aiKeyRoutes)
    await app.ready()
  })

  it('devuelve solo el estado de configuración y nunca la key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/account/ai-keys',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      gemini: true,
      openai: false,
    })
    expect(mocks.getStoredAIKeyStatus).toHaveBeenCalledWith('user-1')
  })

  it('guarda una key válida sin devolver su contenido', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/ai-keys/gemini',
      payload: {
        apiKey: 'secret-gemini-key',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      success: true,
      provider: 'gemini',
      configured: true,
    })
    expect(response.body).not.toContain('secret-gemini-key')
    expect(mocks.saveUserAIKey).toHaveBeenCalledWith(
      'user-1',
      'gemini',
      'secret-gemini-key',
    )
  })

  it('rechaza proveedores no permitidos y no guarda ninguna key', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/ai-keys/mock',
      payload: {
        apiKey: 'secret-key',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(mocks.saveUserAIKey).not.toHaveBeenCalled()
  })

  it('rechaza un cuerpo inválido antes de guardar', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/ai-keys/openai',
      payload: {
        apiKey: '',
        extra: 'not-allowed',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(mocks.saveUserAIKey).not.toHaveBeenCalled()
  })

  it('elimina la key del proveedor solicitado', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/account/ai-keys/openai',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      success: true,
      provider: 'openai',
      configured: false,
    })
    expect(mocks.deleteUserAIKey).toHaveBeenCalledWith(
      'user-1',
      'openai',
    )
  })
})
