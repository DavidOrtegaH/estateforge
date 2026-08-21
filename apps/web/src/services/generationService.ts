import type {
  GeneratedListing,
  GenerationRequest,
} from '@estateforge/shared'

const API_URL = 'http://localhost:3000'

export interface GenerationResult {
  listing: GeneratedListing
  propertyId: string
  generationId: string
}

export interface GenerationProperty {
  id: string
  operation: string
  type: string
  price: number
  address: string
  city: string
  neighborhood: string
  area: number
  bedrooms: number
  bathrooms: number
}

export interface GenerationItem {
  id: string
  propertyId: string
  title: string
  description: string
  highlights: string
  callToAction: string
  provider: string
  tone: string
  language: string
  createdAt: string
  property: GenerationProperty
}

export async function generateListing(
  request: GenerationRequest,
): Promise<GenerationResult> {
  const response = await fetch(
    `${API_URL}/api/generations`,
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

export async function getGenerations(): Promise<
  GenerationItem[]
> {
  const response = await fetch(
    `${API_URL}/api/generations`,
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load generations: ${response.status}`,
    )
  }

  return response.json() as Promise<GenerationItem[]>
}

export async function getGeneration(
  id: string,
): Promise<GenerationItem> {
  const response = await fetch(
    `${API_URL}/api/generations/${id}`,
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load generation: ${response.status}`,
    )
  }

  return response.json() as Promise<GenerationItem>
}

export async function updateGeneration(
  id: string,
  data: Partial<
    Pick<GenerationItem, 'title' | 'description' | 'highlights' | 'callToAction'>
  >,
): Promise<GenerationItem> {
  const response = await fetch(`${API_URL}/api/generations/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    throw new Error(`Failed to update generation: ${response.status}`)
  }

  return response.json() as Promise<GenerationItem>
}

export async function deleteGeneration(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/generations/${id}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(`Failed to delete generation: ${response.status}`)
  }
}