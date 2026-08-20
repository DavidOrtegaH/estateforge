export interface PropertyGeneration {
  id: string
  title: string
  description: string
  highlights: string[]
  callToAction: string
  provider: string
  tone: string
  language: string
  createdAt: string
}

export interface PropertyItem {
  id: string
  title: string
  operation: string
  type: string
  price: number
  address: string
  city: string
  neighborhood: string
  area: number
  bedrooms: number
  bathrooms: number
  floor: number | null
  condition: string
  elevator: boolean
  terrace: boolean
  balcony: boolean
  garage: boolean
  pool: boolean
  garden: boolean
  airConditioning: boolean
  heating: boolean
  additionalInformation: string
  createdAt: string
  updatedAt: string
  generations: PropertyGeneration[]
}

const API_URL = 'http://localhost:3000'

export async function getProperties(): Promise<
  PropertyItem[]
> {
  const response = await fetch(
    `${API_URL}/api/properties`,
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load properties: ${response.status}`,
    )
  }

  return response.json() as Promise<PropertyItem[]>
}

export async function getProperty(
  id: string,
): Promise<PropertyItem> {
  const response = await fetch(
    `${API_URL}/api/properties/${id}`,
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load property: ${response.status}`,
    )
  }

  return response.json() as Promise<PropertyItem>
}

export async function deleteProperty(
  id: string,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/properties/${id}`,
    {
      method: 'DELETE',
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to delete property: ${response.status}`,
    )
  }
}
export async function deleteProperties(
  ids: string[],
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/properties`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ids,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to delete properties: ${response.status}`,
    )
  }
}