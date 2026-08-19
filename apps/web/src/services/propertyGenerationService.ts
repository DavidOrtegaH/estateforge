import type {
  AIProviderType,
  ListingLanguage,
  ListingTone,
} from '@estateforge/shared'

export interface GeneratePropertyListingRequest {
  propertyId: string
  provider: AIProviderType
  tone: ListingTone
  language: ListingLanguage
}

export interface GeneratePropertyListingResult {
  generationId: string
  propertyId: string
  listing: {
    title: string
    description: string
    highlights: string[]
    callToAction: string
  }
}

export async function generatePropertyListing(
  request: GeneratePropertyListingRequest,
): Promise<GeneratePropertyListingResult> {
  const response = await fetch(
    'http://localhost:3000/api/generations/from-property',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
  )

  if (!response.ok) {
    let message = `Generation failed: ${response.status}`

    try {
      const error = (await response.json()) as {
        message?: string
      }

      if (error.message) {
        message = error.message
      }
    } catch {
      // Mantener el mensaje genérico si la respuesta no es JSON.
    }

    throw new Error(message)
  }

  return response.json() as Promise<
    GeneratePropertyListingResult
  >
}