import type {
  GeneratedListing,
  GenerationRequest,
} from '@estateforge/shared'

export interface GenerationResult {
  listing: GeneratedListing
  propertyId: string
  generationId: string
}

export async function generateListing(
  request: GenerationRequest,
): Promise<GenerationResult> {
  const response = await fetch(
    'http://localhost:3000/api/generations',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Generation failed: ${response.status}`,
    )
  }

  return response.json() as Promise<GenerationResult>
}