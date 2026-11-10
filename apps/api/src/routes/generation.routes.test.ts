import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateListing: vi.fn(),
  generateListingForExistingProperty: vi.fn(),
  generationFindMany: vi.fn(),
}))

let currentUserId: string | null = 'user-a'

vi.mock('../middleware/auth.middleware.js', () => ({
  requireAuth: async (
    request: { userId?: string | null },
    reply: {
      code: (status: number) => {
        send: (body: unknown) => void
      }
    },
  ) => {
    if (!currentUserId) {
      reply.code(401).send({
        message: 'Se requiere una sesión activa.',
      })
      return
    }

    request.userId = currentUserId
  },
}))

vi.mock('../services/generation.service.js', () => ({
  generateListing: mocks.generateListing,
  generateListingForExistingProperty:
    mocks.generateListingForExistingProperty,
}))

vi.mock('../db/prisma.js', () => ({
  prisma: {
    generation: {
      findMany: mocks.generationFindMany,
    },
  },
}))

import { generationRoutes } from './generation.routes.js'

const propertyId = 'cmj7b5q8r0000v6y7g5q4m3n2'

const propertyPayload = {
  property: {
    title: 'Piso de prueba',
    operation: 'sale',
    type: 'apartment',
    price: 250000,
    address: 'Calle Mayor 10',
    city: 'Madrid',
    neighborhood: 'Centro',
    area: 90,
    bedrooms: 3,
    bathrooms: 2,
    floor: 4,
    condition: 'good',
    commercialStatus: 'for-sale',
    elevator: true,
    terrace: true,
    balcony: false,
    garage: false,
    storageRoom: false,
    pool: false,
    garden: false,
    airConditioning: true,
    heating: true,
    additionalInformation: '',
  },
  provider: 'mock',
  tone: 'professional',
  language: 'español',
}

describe('Generation routes - aislamiento por usuario', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    currentUserId = 'user-a'

    mocks.generateListing.mockResolvedValue({
      generationId: 'cmj7b5q8r0000v6y7g5q4m3p',
      propertyId,
      listing: {
        title: 'Piso de prueba',
        description: 'Descripción de prueba',
        highlights: ['90 m²'],
        callToAction: 'Contacta',
      },
    })

    mocks.generateListingForExistingProperty.mockResolvedValue({
      generationId: 'cmj7b5q8r0000v6y7g5q4m3p',
      propertyId,
      listing: {
        title: 'Piso de prueba',
        description: 'Descripción de prueba',
        highlights: ['90 m²'],
        callToAction: 'Contacta',
      },
    })

    mocks.generationFindMany.mockResolvedValue([
      {
        id: 'cmj7b5q8r0000v6y7g5q4m3p',
        propertyId,
        property: {
          id: propertyId,
          userId: 'user-a',
        },
      },
    ])

    app = Fastify()
    app.decorateRequest('userId', null)
    await app.register(generationRoutes)
    await app.ready()
  })

  it('rechaza generar sin sesión', async () => {
    currentUserId = null

    const response = await app.inject({
      method: 'POST',
      url: '/api/generations',
      payload: propertyPayload,
    })

    expect(response.statusCode).toBe(401)
    expect(mocks.generateListing).not.toHaveBeenCalled()
  })

  it('asocia una generación directa al usuario autenticado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/generations',
      payload: propertyPayload,
    })

    expect(response.statusCode).toBe(200)
    expect(mocks.generateListing).toHaveBeenCalledWith({
      ...propertyPayload,
      userId: 'user-a',
    })
  })

  it('propaga el usuario autenticado al flujo desde inmueble existente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/generations/from-property',
      payload: {
        propertyId,
        provider: 'mock',
        tone: 'professional',
        language: 'español',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(
      mocks.generateListingForExistingProperty,
    ).toHaveBeenCalledWith({
      propertyId,
      provider: 'mock',
      tone: 'professional',
      language: 'español',
      userId: 'user-a',
    })
  })

  it('lista únicamente las generaciones del usuario autenticado', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/generations',
    })

    expect(response.statusCode).toBe(200)
    expect(mocks.generationFindMany).toHaveBeenCalledWith({
      where: {
        property: {
          userId: 'user-a',
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        property: true,
      },
    })
  })
})
