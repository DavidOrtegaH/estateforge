import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_URL } from '@/lib/api'
import {
  deleteProperties,
  deleteProperty,
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

  it('elimina un inmueble sin declarar cuerpo JSON (Fastify rechaza JSON vacío)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      ),
    )

    await deleteProperty('cm123456789012345678901234')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(`${API_URL}/api/properties/cm123456789012345678901234`)
    expect(init).toEqual({ method: 'DELETE', credentials: 'include' })
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
  })

  it('propaga el estado HTTP cuando el borrado se rechaza', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 400 })),
    )

    await expect(deleteProperty('cm123456789012345678901234')).rejects.toThrow('Failed to delete property: 400')
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
