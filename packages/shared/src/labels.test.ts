import { describe, expect, it } from 'vitest'

import { getProviderLabel, providerLabels } from './labels.js'

// MD-36: el método con el que se generó un anuncio se nombra por lo que es. «mock» es la plantilla
// local (composición programática, sin IA) y «simulador» es el simulador técnico de pruebas.

describe('getProviderLabel', () => {
  it('la plantilla local no se llama «Mock» ni se presenta como IA', () => {
    expect(getProviderLabel('mock')).toBe('Plantilla local (sin IA)')
    expect(getProviderLabel('MOCK')).toBe('Plantilla local (sin IA)')
    expect(Object.values(providerLabels).join(' ')).not.toMatch(/\bMock\b/)
  })

  it('distingue la IA real del simulador de pruebas', () => {
    expect(getProviderLabel('gemini')).toBe('Gemini')
    expect(getProviderLabel('openai')).toBe('OpenAI')
    expect(getProviderLabel('simulador')).toBe('Simulador local (pruebas)')
  })

  it('valores vacíos o desconocidos', () => {
    expect(getProviderLabel(undefined)).toBe('No indicado')
    expect(getProviderLabel(null)).toBe('No indicado')
    expect(getProviderLabel('  ')).toBe('No indicado')
    expect(getProviderLabel('otro')).toBe('Otro')
  })
})
