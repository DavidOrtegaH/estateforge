import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GenerationApiError,
  generateListing,
} from './generationService'
import type { GenerationRequest } from '@estateforge/shared'

const request: GenerationRequest = {
  property: {
    title: 'Piso de prueba',
    operation: 'sale',
    type: 'apartment',
    price: 250000,
    address: 'Calle de Prueba 1',
    city: 'Madrid',
    neighborhood: '',
    area: 80,
    bedrooms: 2,
    bathrooms: 1,
    condition: 'good',
    elevator: true,
    terrace: false,
    balcony: true,
    garage: false,
    storageRoom: false,
    pool: false,
    garden: false,
    airConditioning: false,
    heating: true,
    additionalInformation: '',
  },
  provider: 'mock',
  tone: 'professional',
  language: 'español',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generationService', () => {
  it('envía una generación válida al endpoint y devuelve el resultado', async () => {
    const listing = {
      title: 'Piso luminoso',
      description: 'Descripción de prueba',
      highlights: ['80 m²', '2 habitaciones'],
      callToAction: 'Solicita una visita',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            listing,
            propertyId: 'cm123456789012345678901234',
            generationId: 'cm123456789012345678901235',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )

    const result = await generateListing(request)

    expect(result.listing).toEqual(listing)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/generations',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }),
    )
  })

  it('convierte un error conocido del API en GenerationApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'AI_QUOTA_EXCEEDED',
            message: 'Cuota de IA agotada',
          }),
          {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )

    const promise = generateListing(request)

    await expect(promise).rejects.toBeInstanceOf(GenerationApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
      status: 429,
      message: 'Cuota de IA agotada',
    })
  })

  it('usa un mensaje genérico cuando el API devuelve una respuesta no JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('upstream failure', { status: 503 }),
      ),
    )

    await expect(generateListing(request)).rejects.toMatchObject({
      status: 503,
      code: null,
      message: 'Generation failed: 503',
    })
  })
})
