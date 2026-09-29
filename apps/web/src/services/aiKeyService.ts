export type StoredAIKeyProvider = 'gemini' | 'openai'

export interface StoredAIKeyStatus {
  gemini: boolean
  openai: boolean
}

const API_BASE_URL = 'http://localhost:3000'

async function parseResponse(response: Response): Promise<unknown> {
  const data: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : `Error de API: ${response.status}`

    throw new Error(message)
  }

  return data
}

export async function getStoredAIKeyStatus(): Promise<StoredAIKeyStatus> {
  const response = await fetch(
    `${API_BASE_URL}/api/account/ai-keys`,
    {
      credentials: 'include',
    },
  )

  return (await parseResponse(response)) as StoredAIKeyStatus
}

export async function saveStoredAIKey(
  provider: StoredAIKeyProvider,
  apiKey: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/account/ai-keys/${provider}`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey }),
    },
  )

  await parseResponse(response)
}

export async function deleteStoredAIKey(
  provider: StoredAIKeyProvider,
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/account/ai-keys/${provider}`,
    {
      method: 'DELETE',
      credentials: 'include',
    },
  )

  await parseResponse(response)
}
