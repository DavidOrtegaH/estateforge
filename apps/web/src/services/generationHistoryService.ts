import { API_URL } from '@/lib/api'

export interface GenerationHistoryItem {
  id: string
  propertyId: string
  title: string
  description: string
  highlights: string[]
  callToAction: string
  provider: string
  tone: string
  language: string
  createdAt: string

  property: {
    id: string
    operation: string
    type: string
    price: number
    city: string
    neighborhood: string
    area: number
    bedrooms: number
    bathrooms: number
  }
}

export async function getGenerationHistory(): Promise<
  GenerationHistoryItem[]
> {
  const response = await fetch(
    `${API_URL}/api/generations`,
    {
      credentials: 'include',
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load generation history: ${response.status}`,
    )
  }

  return response.json() as Promise<
    GenerationHistoryItem[]
  >
}