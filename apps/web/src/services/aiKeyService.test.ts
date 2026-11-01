import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_URL } from '@/lib/api'
import {
  getStoredAIKeyStatus,
  saveStoredAIKey,
} from './aiKeyService'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('aiKeyService', () => {
  it('consulta el estado de las API keys guardadas', async () => {
    const status = { gemini: true, openai: false }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(status), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(getStoredAIKeyStatus()).resolves.toEqual(status)
    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/api/account/ai-keys`,
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })

  it('guarda la API key del proveedor indicado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await saveStoredAIKey('openai', 'sk-test')

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/api/account/ai-keys/openai`,
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ apiKey: 'sk-test' }),
      }),
    )
  })
})
