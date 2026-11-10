import { describe, expect, it } from 'vitest'

import { getPasswordValidationErrors, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './passwordPolicy'

// La validación que usan el registro y el restablecimiento en la web debe coincidir con la
// política del servidor (apps/api/src/services/password-policy.ts): 12 a 128 caracteres,
// minúscula, mayúscula, número y carácter especial.
describe('política de contraseñas en la web', () => {
  it('usa los mismos límites que el servidor', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12)
    expect(MAX_PASSWORD_LENGTH).toBe(128)
  })

  it('acepta una contraseña que cumple todos los requisitos con 12 caracteres', () => {
    expect(getPasswordValidationErrors('Abcdefgh12!x')).toEqual([])
  })

  it('rechaza 8 u 11 caracteres aunque cumplan la complejidad', () => {
    expect(getPasswordValidationErrors('Abcde12!')).toContain('Debe tener al menos 12 caracteres.')
    expect(getPasswordValidationErrors('Abcdefg12!x')).toContain('Debe tener al menos 12 caracteres.')
  })

  it('acepta 128 caracteres y rechaza 129', () => {
    const base = 'Aa1!'
    expect(getPasswordValidationErrors(base + 'x'.repeat(124))).toEqual([])
    expect(getPasswordValidationErrors(base + 'x'.repeat(125))).toContain('No puede superar los 128 caracteres.')
  })

  it.each([
    ['sin minúscula', 'ABCDEFGH12!X', 'Debe incluir al menos una letra minúscula.'],
    ['sin mayúscula', 'abcdefgh12!x', 'Debe incluir al menos una letra mayúscula.'],
    ['sin número', 'Abcdefghij!x', 'Debe incluir al menos un número.'],
    ['sin carácter especial', 'Abcdefgh12xy', 'Debe incluir al menos un carácter especial.'],
  ])('rechaza una contraseña %s', (_label, password, message) => {
    expect(getPasswordValidationErrors(password)).toEqual([message])
  })
})
