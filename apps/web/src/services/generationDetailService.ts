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

  return response.json() as Promise<GenerationHistoryItem>
}