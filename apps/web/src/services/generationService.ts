import { API_URL } from '@/lib/api'

import type {
  GeneratedListing,
  GenerationRequest,
  GenerationUpdate,
  GenerationNotice,
} from '@estateforge/shared'

export type GenerationApiErrorCode =
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_INVALID_API_KEY'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_KEY_REQUIRED'
  | 'AI_KEY_UNREADABLE'
  | 'AI_MODEL_NOT_ALLOWED'
  | 'AI_RATE_LIMITED'
  // La clave es válida, pero la cuenta no tiene permiso para esa operación (DA-87).
  | 'AI_PERMISSION_DENIED'

export class GenerationApiError extends Error {
  readonly code: GenerationApiErrorCode | null
  readonly status: number

  constructor(
    code: GenerationApiErrorCode | null,
    message: string,
    status: number,
  ) {
    super(message)
    this.name = 'GenerationApiError'
    this.code = code
    this.status = status
  }
}

export interface GenerationResult {
  listing: GeneratedListing
  propertyId: string
  generationId: string
  /** Avisos sobre el contenido generado (ausentes en respuestas anteriores). */
  notices?: GenerationNotice[]
}

export interface GenerationProperty {
  title: string
  id: string
  operation: string
  type: string
  price: string
  address: string
  city: string
  neighborhood: string
  area: number
  bedrooms: number
  bathrooms: number
  commercialStatus?: string | null

  elevator: boolean
  terrace: boolean
  balcony: boolean
  garage: boolean
  storageRoom: boolean
  pool: boolean
  garden: boolean
  airConditioning: boolean
  heating: boolean
}

export interface GenerationItem {
  updatedAt?: string
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
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
  )

  if (!response.ok) {
    let message = `Generation failed: ${response.status}`
    let code: GenerationApiErrorCode | null = null

    try {
      const error = (await response.json()) as {
        code?: unknown
        message?: unknown
      }

      if (
        typeof error.message === 'string' &&
        error.message
      ) {
        message = error.message
      }

      if (
        error.code === 'AI_QUOTA_EXCEEDED' ||
        error.code === 'AI_INVALID_API_KEY' ||
        error.code === 'AI_TIMEOUT' ||
        error.code === 'AI_PROVIDER_ERROR' ||
        error.code === 'AI_KEY_REQUIRED' ||
        error.code === 'AI_KEY_UNREADABLE' ||
        error.code === 'AI_MODEL_NOT_ALLOWED' ||
        error.code === 'AI_RATE_LIMITED' ||
        error.code === 'AI_PERMISSION_DENIED'
      ) {
        code = error.code
      }
    } catch {
      // Mantener el mensaje genérico si la respuesta no es JSON.
    }

    throw new GenerationApiError(
      code,
      message,
      response.status,
    )
  }

  return response.json() as Promise<GenerationResult>
}

export async function getGenerations(): Promise<
  GenerationItem[]
> {
  const response = await fetch(
    `${API_URL}/api/generations`,
    {
      credentials: 'include',
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load generations: ${response.status}`,
    )
  }

  return response.json() as Promise<GenerationItem[]>
}

export async function deleteGenerations(
  ids: string[],
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/generations`,
    {
      method: 'DELETE',
      credentials: 'include',
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
      `Failed to delete generations: ${response.status}`,
    )
  }
}

export async function getGeneration(
  id: string,
): Promise<GenerationItem> {
  const response = await fetch(
    `${API_URL}/api/generations/${id}`,
    {
      credentials: 'include',
    },
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
  data: Partial<GenerationUpdate>,
): Promise<GenerationItem> {
  const response = await fetch(
    `${API_URL}/api/generations/${id}`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to update generation: ${response.status}`,
    )
  }

  return response.json() as Promise<GenerationItem>
}

export async function deleteGeneration(
  id: string,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/generations/${id}`,
    {
      method: 'DELETE',
      credentials: 'include',
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to delete generation: ${response.status}`,
    )
  }
}