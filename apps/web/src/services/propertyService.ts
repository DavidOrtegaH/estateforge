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

export async function getProperties(): Promise<PropertyItem[]> {
  const response = await fetch(
    'http://localhost:3000/api/properties',
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
    `http://localhost:3000/api/properties/${id}`,
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load property: ${response.status}`,
    )
  }

  return response.json() as Promise<PropertyItem>
}