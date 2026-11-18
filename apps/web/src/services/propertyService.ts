import { API_URL } from '@/lib/api'

export interface PropertyItem {
  id: string
  title: string
  price: string
  area: number
  city: string
  neighborhood?: string
  address?: string
  operation: string
  type: string
  condition: string
  commercialStatus?: string | null
  bedrooms: number
  bathrooms: number
  floor: number | null
  additionalInformation?: string

  elevator?: boolean
  terrace?: boolean
  balcony?: boolean
  garage?: boolean
  storageRoom?: boolean
  pool?: boolean
  garden?: boolean
  airConditioning?: boolean
  heating?: boolean

  generations: any[]
  createdAt: string
}

export async function getProperties(): Promise<
  PropertyItem[]
> {
  const response = await fetch(
    `${API_URL}/api/properties`,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type':
          'application/json',
      },
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to fetch properties: ${response.status}`,
    )
  }

  return response.json() as Promise<
    PropertyItem[]
  >
}

export async function getProperty(
  id: string,
): Promise<PropertyItem> {
  const response = await fetch(
    `${API_URL}/api/properties/${id}`,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type':
          'application/json',
      },
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to fetch property: ${response.status}`,
    )
  }

  return response.json() as Promise<PropertyItem>
}

export async function updateProperty(
  id: string,
  data: Partial<PropertyItem>,
): Promise<PropertyItem> {
  const response = await fetch(
    `${API_URL}/api/properties/${id}`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type':
          'application/json',
      },
      body: JSON.stringify(data),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to update property: ${response.status}`,
    )
  }

  return response.json() as Promise<
    PropertyItem
  >
}

export async function deleteProperty(
  id: string,
): Promise<void> {
  // Sin Content-Type: no hay cuerpo, y Fastify rechaza (400
  // FST_ERR_CTP_EMPTY_JSON_BODY) un DELETE que declara JSON vacío.
  const response = await fetch(
    `${API_URL}/api/properties/${id}`,
    {
      method: 'DELETE',
      credentials: 'include',
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
      credentials: 'include',
      headers: {
        'Content-Type':
          'application/json',
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