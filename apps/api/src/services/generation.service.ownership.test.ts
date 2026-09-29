import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  propertyFindFirst: vi.fn(),
  generationCreate: vi.fn(),
  generate: vi.fn(),
  createAIProvider: vi.fn(),
  getUserAIKey: vi.fn(),
  buildListingPrompt: vi.fn(),
  validateGeneratedListing: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({
  prisma: {
    property: {
      findFirst: mocks.propertyFindFirst,
    },
    generation: {
      create: mocks.generationCreate,
    },
  },
}))

vi.mock('../ai/ai-provider.factory.js', () => ({
  createAIProvider: mocks.createAIProvider,
}))

vi.mock('./user-ai-key.service.js', () => ({
  getUserAIKey: mocks.getUserAIKey,
}))

vi.mock('./prompt.service.js', () => ({
  buildListingPrompt: mocks.buildListingPrompt,
}))

vi.mock('./listing-validator.service.js', () => ({
  validateGeneratedListing: mocks.validateGeneratedListing,
}))

import { generateListingForExistingProperty } from './generation.service.js'

const propertyId = 'cmj7b5q8r0000v6y7g5q4m3n2'

const storedProperty = {
  id: propertyId,
  userId: 'user-a',
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
}

const generatedListing = {
  title: 'Piso de prueba',
  description: 'Descripción de prueba',
  highlights: ['90 m²'],
  callToAction: 'Contacta',
}

describe('generation.service - ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.buildListingPrompt.mockReturnValue('prompt')
    mocks.validateGeneratedListing.mockReturnValue(generatedListing)
    mocks.createAIProvider.mockReturnValue({
      generate: mocks.generate,
    })
    mocks.generate.mockResolvedValue(generatedListing)
    mocks.generationCreate.mockResolvedValue({
      id: 'cmj7b5q8r0000v6y7g5q4m3p',
      propertyId,
    })
  })

  it('no permite a un usuario generar sobre un inmueble de otro usuario', async () => {
    mocks.propertyFindFirst.mockResolvedValue(null)

    await expect(
      generateListingForExistingProperty({
        propertyId,
        provider: 'mock',
        tone: 'professional',
        language: 'español',
        userId: 'user-b',
      }),
    ).rejects.toThrow('Property not found')

    expect(mocks.propertyFindFirst).toHaveBeenCalledWith({
      where: {
        id: propertyId,
        userId: 'user-b',
      },
    })
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.generationCreate).not.toHaveBeenCalled()
  })

  it('permite al propietario generar sobre su propio inmueble', async () => {
    mocks.propertyFindFirst.mockResolvedValue(storedProperty)

    await expect(
      generateListingForExistingProperty({
        propertyId,
        provider: 'mock',
        tone: 'professional',
        language: 'español',
        userId: 'user-a',
      }),
    ).resolves.toEqual({
      generationId: 'cmj7b5q8r0000v6y7g5q4m3p',
      propertyId,
      listing: generatedListing,
    })

    expect(mocks.propertyFindFirst).toHaveBeenCalledWith({
      where: {
        id: propertyId,
        userId: 'user-a',
      },
    })
    expect(mocks.generationCreate).toHaveBeenCalledWith({
      data: {
        propertyId,
        title: generatedListing.title,
        description: generatedListing.description,
        highlights: JSON.stringify(generatedListing.highlights),
        callToAction: generatedListing.callToAction,
        provider: 'mock',
        tone: 'professional',
        language: 'español',
      },
    })
  })
})
