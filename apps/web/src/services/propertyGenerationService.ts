import type {
  AIProviderType,
  ListingLanguage,
  ListingTone,
} from '@estateforge/shared'

export type GenerationApiErrorCode =
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_INVALID_API_KEY'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'

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

export interface GeneratePropertyListingRequest {
  propertyId: string
  provider: AIProviderType
  tone: ListingTone
  language: ListingLanguage
  apiKey?: string
}

export interface UpdatePropertyListingRequest {
  title?: string
  description?: string
  highlights?: string[] | string
  callToAction?: string
  provider?: AIProviderType
  tone?: ListingTone
  language?: ListingLanguage
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

export interface UpdatedGeneration {
  id: string
  propertyId: string
  title: string
  description: string
  highlights: string[] | string
  callToAction: string
  provider: string
  tone: string
  language: string
  createdAt: string
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
    let message = `Generation failed: ${response.status}`
    let code: GenerationApiErrorCode | null = null

    try {
      const error = (await response.json()) as {
        code?: unknown
        message?: unknown
      }

      if (
        error.code === 'AI_QUOTA_EXCEEDED' ||
        error.code === 'AI_INVALID_API_KEY' ||
        error.code === 'AI_TIMEOUT' ||
        error.code === 'AI_PROVIDER_ERROR'
      ) {
        code = error.code
      }

      if (
        typeof error.message === 'string' &&
        error.message
      ) {
        message = error.message
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

  return response.json() as Promise<
    GeneratePropertyListingResult
  >
}

export async function updateGeneration(
  id: string,
  request: UpdatePropertyListingRequest,
): Promise<UpdatedGeneration> {
  const response = await fetch(
    `http://localhost:3000/api/generations/${id}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
  )

  if (!response.ok) {
    let message = `Update failed: ${response.status}`

    try {
      const error = (await response.json()) as {
        message?: string
      }

      if (error.message) {
        message = error.message
      }
    } catch {
      // Mantener el mensaje genérico si la respuesta no es JSON.
    }

    throw new Error(message)
  }

  return response.json() as Promise<UpdatedGeneration>
}

export async function deleteGeneration(
  id: string,
): Promise<{ success: boolean }> {
  const response = await fetch(
    `http://localhost:3000/api/generations/${id}`,
    {
      method: 'DELETE',
    },
  )

  if (!response.ok) {
    let message = `Deletion failed: ${response.status}`

    try {
      const error = (await response.json()) as {
        message?: string
      }

      if (error.message) {
        message = error.message
      }
    } catch {
      // Mantener el mensaje genérico si la respuesta no es JSON.
    }

    throw new Error(message)
  }

  return response.json() as Promise<{
    success: boolean
  }>
}


