export interface GeneratePropertyListingRequest {
  propertyId: string
  tone: string
  language: string
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
    throw new Error(
      `Generation failed: ${response.status}`,
    )
  }

  return response.json() as Promise<GeneratePropertyListingResult>
}