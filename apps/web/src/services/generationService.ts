import type { Property } from '@/types/property'
import type { GeneratedListing } from '@/types/listing'

const API_URL = 'http://localhost:3000'

interface GenerateListingResponse {
  listing: GeneratedListing
}

export async function generateListing({
  property,
}: {
  property: Property
}): Promise<GenerateListingResponse> {
  const response = await fetch(`${API_URL}/api/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      property,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Error generating listing: ${response.status}`,
    )
  }

  return response.json() as Promise<GenerateListingResponse>
}