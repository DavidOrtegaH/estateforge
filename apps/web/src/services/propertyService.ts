const API_URL =
  'http://localhost:3000'

export interface PropertyItem {
  id: string
  title: string
  price: number
  area: number
  city: string
  neighborhood?: string
  address?: string
  operation: string
  type: string
  condition: string
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

/**
 * Obtiene la lista completa de propiedades.
 */
export async function getProperties(): Promise<
  PropertyItem[]
> {
  const response = await fetch(
    `${API_URL}/api/properties`,
    {
      method: 'GET',
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

/**
 * Obtiene una propiedad por su ID.
 */
export async function getProperty(
  id: string,
): Promise<PropertyItem> {
  const response = await fetch(
    `${API_URL}/api/properties/${id}`,
    {
      method: 'GET',
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

/**
 * Actualiza parcialmente una propiedad.
 */
export async function updateProperty(
  id: string,
  data: Partial<PropertyItem>,
): Promise<PropertyItem> {
  const response = await fetch(
    `${API_URL}/api/properties/${id}`,
    {
      method: 'PUT',
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

/**
 * Elimina una propiedad individual por su ID.
 */
export async function deleteProperty(
  id: string,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/properties/${id}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type':
          'application/json',
      },
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to delete property: ${response.status}`,
    )
  }
}

/**
 * Elimina múltiples propiedades.
 */
export async function deleteProperties(
  ids: string[],
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/properties`,
    {
      method: 'DELETE',
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