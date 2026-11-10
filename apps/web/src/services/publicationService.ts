import { API_URL } from '@/lib/api'

import type {
  PublicationChecklistUpdate,
  PublicationPlatformId,
} from '@estateforge/shared'

export interface PublicationChecklistItem {
  platform: PublicationPlatformId
  isPublished: boolean
  url: string | null
}

export interface PublicationChecklistOther {
  instanceKey: string
  name: string | null
  homeUrl: string | null
  isPublished: boolean
  url: string | null
}

export interface PublicationChecklistResponse {
  items: PublicationChecklistItem[]
  others: PublicationChecklistOther[]
}

function checklistUrl(
  generationId: string,
): string {
  return `${API_URL}/api/generations/${generationId}/publications`
}

export async function getPublicationChecklist(
  generationId: string,
): Promise<PublicationChecklistResponse> {
  const response = await fetch(
    checklistUrl(generationId),
    {
      credentials: 'include',
    },
  )

  if (!response.ok) {
    throw new Error(
      'No se ha podido cargar el Checklist.',
    )
  }

  return response.json() as Promise<PublicationChecklistResponse>
}

export async function savePublicationChecklist(
  generationId: string,
  data: PublicationChecklistUpdate,
): Promise<PublicationChecklistResponse> {
  const response = await fetch(
    checklistUrl(generationId),
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
    let message =
      'No se ha podido guardar el Checklist. Inténtalo de nuevo.'

    try {
      const body = (await response.json()) as {
        errors?: Array<{ message?: unknown }>
        message?: unknown
      }

      const detail =
        response.status === 409
          ? body.message
          : body.errors?.[0]?.message

      if (typeof detail === 'string' && detail) {
        message = detail
      }
    } catch {
      // Se mantiene el mensaje general si la respuesta no es JSON.
    }

    throw new Error(message)
  }

  return response.json() as Promise<PublicationChecklistResponse>
}
