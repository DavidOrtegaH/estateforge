import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GenerationApiError,
  generatePropertyListing,
} from './propertyGenerationService'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('propertyGenerationService', () => {
  const request = {
    propertyId: 'cm123456789012345678901234',
    provider: 'mock' as const,
    tone: 'professional' as const,
    language: 'español' as const,
  }

  it('genera un anuncio para un inmueble existente', async () => {
    const result = {
      generationId: 'cm123456789012345678901235',
      propertyId: request.propertyId,
      listing: {
        title: 'Anuncio de prueba',
        description: 'Descripción',
        highlights: ['Terraza'],
        callToAction: 'Contacta',
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(generatePropertyListing(request)).resolves.toEqual(result)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/generations/from-property',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }),
    )
  })

  it('conserva el código y mensaje de error del API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'AI_TIMEOUT',
            message: 'La generación ha superado el tiempo límite de 40 segundos.',
          }),
          {
            status: 504,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )

    const promise = generatePropertyListing(request)

    await expect(promise).rejects.toBeInstanceOf(GenerationApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
      status: 504,
      message: 'La generación ha superado el tiempo límite de 40 segundos.',
    })
  })
})
