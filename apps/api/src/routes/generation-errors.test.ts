import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Contrato HTTP de la generación con el manejador real de errores de buildApp.

const generateListing = vi.hoisted(() => vi.fn())

vi.mock('../services/generation.service.js', () => ({
  generateListing,
  generateListingForExistingProperty: vi.fn(),
}))

vi.mock('../middleware/auth.middleware.js', () => ({
  requireAuth: async (request: { userId?: string }) => {
    request.userId = 'user-a'
  },
  optionalAuth: async () => undefined,
}))

vi.mock('../db/prisma.js', () => ({ prisma: {} }))

import { AIProviderError } from '../ai/ai-provider.error.js'

const payload = {
  provider: 'mock',
  tone: 'casual',
  language: 'español',
  property: {
    title: 'Piso', operation: 'sale', type: 'apartment', price: 900, address: 'Calle', city: 'Madrid', neighborhood: '',
    area: 80, bedrooms: 2, bathrooms: 1, condition: 'good', commercialStatus: 'for-sale',
    elevator: false, terrace: false, balcony: false, garage: false, storageRoom: false, pool: false, garden: false,
    airConditioning: false, heating: false, additionalInformation: '',
  },
}

let app: FastifyInstance

const post = () => app.inject({ method: 'POST', url: '/api/generations', payload })

beforeAll(async () => {
  const { buildApp } = await import('../app.js')

  app = await buildApp()
  await app.ready()
})

afterAll(() => app.close())

beforeEach(() => {
  generateListing.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('errores de la generación', () => {
  it('una respuesta válida responde 200', async () => {
    generateListing.mockResolvedValue({ propertyId: 'p', generationId: 'g' })

    expect((await post()).statusCode).toBe(200)
  })

  it('una respuesta inválida del proveedor es 502 con su mensaje', async () => {
    generateListing.mockRejectedValue(new AIProviderError('AI_PROVIDER_ERROR', 'La respuesta de la IA contiene un dato incoherente.'))

    const response = await post()

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ code: 'AI_PROVIDER_ERROR', message: 'La respuesta de la IA contiene un dato incoherente.' })
  })

  it.each([
    ['AI_QUOTA_EXCEEDED', 429],
    ['AI_INVALID_API_KEY', 401],
    ['AI_TIMEOUT', 504],
  ] as const)('el error real %s conserva su código %d', async (code, status) => {
    generateListing.mockRejectedValue(new AIProviderError(code, 'detalle'))

    const response = await post()

    expect(response.statusCode).toBe(status)
    expect(response.json().code).toBe(code)
  })

  it('un error interno sigue siendo 500 y no revela detalles', async () => {
    generateListing.mockRejectedValue(new Error('fallo interno con datos sensibles'))

    const response = await post()

    expect(response.statusCode).toBe(500)
    expect(response.json().code).not.toBe('AI_PROVIDER_ERROR')
    expect(response.body).not.toContain('sensibles')
  })
})
