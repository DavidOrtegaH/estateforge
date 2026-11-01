import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_URL } from '@/lib/api'
import {
  deleteProperties,
  getProperties,
} from './propertyService'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('propertyService', () => {
  it('obtiene los inmuebles con la sesión del usuario', async () => {
    const properties = [
      { id: 'cm123456789012345678901234', title: 'Piso de prueba' },
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(properties), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(getProperties()).resolves.toEqual(properties)
    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/api/properties`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('elimina varios inmuebles enviando sus identificadores', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, { status: 204 }),
      ),
    )

    await deleteProperties(['a', 'b'])

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/api/properties`,
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        body: JSON.stringify({ ids: ['a', 'b'] }),
      }),
    )
  })
})
