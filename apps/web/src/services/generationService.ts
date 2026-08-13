import type {
  GeneratedListing,
  GenerationRequest,
} from '@estateforge/shared'

export async function generateListing(
  request: GenerationRequest,
): Promise<GeneratedListing> {
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

  const data = (await response.json()) as {
    listing: GeneratedListing
  }

  return data.listing
}