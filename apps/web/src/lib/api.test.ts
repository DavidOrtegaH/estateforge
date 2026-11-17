import { describe, expect, it } from 'vitest'

import {
  API_URL,
  DEFAULT_API_URL,
  resolveApiUrl,
} from './api'

describe('resolveApiUrl', () => {
  it('usa la URL por defecto cuando la variable no está definida', () => {
    expect(resolveApiUrl(undefined)).toBe('http://localhost:3000')
    expect(resolveApiUrl(undefined)).toBe(DEFAULT_API_URL)
  })

  it('respeta una URL personalizada sin modificarla', () => {
    expect(resolveApiUrl('https://api.estateforge.test')).toBe(
      'https://api.estateforge.test',
    )
    expect(resolveApiUrl('https://example.test/backend')).toBe(
      'https://example.test/backend',
    )
  })

  it('vacía: rutas relativas para servir la API bajo el mismo dominio (despliegue con reescritura)', () => {
    expect(resolveApiUrl('')).toBe('')
    expect(resolveApiUrl('/')).toBe('')
  })

  it('elimina las barras finales', () => {
    expect(resolveApiUrl('https://api.estateforge.test/')).toBe(
      'https://api.estateforge.test',
    )
    expect(resolveApiUrl('https://api.estateforge.test///')).toBe(
      'https://api.estateforge.test',
    )
    expect(resolveApiUrl('https://example.test/backend/')).toBe(
      'https://example.test/backend',
    )
  })
})

describe('API_URL', () => {
  it('se resuelve a partir de VITE_API_URL y no termina en barra', () => {
    expect(API_URL).toBe(resolveApiUrl(import.meta.env.VITE_API_URL))
    expect(API_URL.endsWith('/')).toBe(false)
  })
})
