import { describe, expect, it } from 'vitest'

import {
  getPasswordValidationErrors,
  isStrongPassword,
} from './password-policy.js'

describe('password policy', () => {
  it('acepta una contraseña válida', () => {
    expect(isStrongPassword('EstateForge!2026')).toBe(true)
  })

  it('rechaza contraseñas demasiado cortas', () => {
    expect(isStrongPassword('Aa1!short')).toBe(false)
    expect(getPasswordValidationErrors('Aa1!short')).toContain(
      'Debe tener al menos 12 caracteres.',
    )
  })

  it('requiere mayúsculas', () => {
    expect(isStrongPassword('estateforge!2026')).toBe(false)
  })

  it('requiere minúsculas', () => {
    expect(isStrongPassword('ESTATEFORGE!2026')).toBe(false)
  })

  it('requiere números', () => {
    expect(isStrongPassword('EstateForge!abcd')).toBe(false)
  })

  it('requiere un carácter especial', () => {
    expect(isStrongPassword('EstateForge2026')).toBe(false)
  })

  it('rechaza contraseñas excesivamente largas', () => {
    expect(isStrongPassword('A'.repeat(128) + 'a1!')).toBe(false)
  })
})
