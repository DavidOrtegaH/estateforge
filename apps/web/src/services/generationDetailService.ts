import { API_URL } from '@/lib/api'
import type { GenerationHistoryItem } from './generationHistoryService'

export async function getGeneration(
  id: string,
): Promise<GenerationHistoryItem> {
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

  const data =
    (await response.json()) as GenerationHistoryItem & {
      highlights: string | string[]
    }

  let highlights: string[] = []

  if (Array.isArray(data.highlights)) {
    highlights = data.highlights.filter(
      (item): item is string =>
        typeof item === 'string',
    )
  } else if (
    typeof data.highlights === 'string'
  ) {
    try {
      const parsed: unknown =
        JSON.parse(data.highlights)

      if (Array.isArray(parsed)) {
        highlights = parsed.filter(
          (item): item is string =>
            typeof item === 'string',
        )
      }
    } catch {
      highlights = []
    }
  }

  return {
    ...data,
    highlights,
  }
}