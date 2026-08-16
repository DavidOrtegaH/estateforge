import type { GenerationHistoryItem } from './generationHistoryService'

export async function getGeneration(
  id: string,
): Promise<GenerationHistoryItem> {
  const response = await fetch(
    `http://localhost:3000/api/generations/${id}`,
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load generation: ${response.status}`,
    )
  }

  const data = (await response.json()) as GenerationHistoryItem & {
    highlights: string | string[]
  }

  const highlights =
    typeof data.highlights === 'string'
      ? JSON.parse(data.highlights)
      : data.highlights

  return {
    ...data,
    highlights: Array.isArray(highlights)
      ? highlights
      : [],
  }
}