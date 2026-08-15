
export interface PropertyGenerationRequest {
  propertyId: string
  tone: string
  language: string
}

export interface PropertyGenerationResult {
  title: string
  description: string
  highlights: string[]
  callToAction: string
  propertyId: string
}

export async function generatePropertyListing(
  request: PropertyGenerationRequest,
): Promise<PropertyGenerationResult> {
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
    listing: PropertyGenerationResult
  }

  return data.listing
}