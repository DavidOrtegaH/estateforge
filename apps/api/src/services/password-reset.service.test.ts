import { describe, expect, it } from 'vitest'

import {
  createPasswordResetToken,
  getPasswordResetExpiry,
  hashPasswordResetToken,
  PASSWORD_RESET_TOKEN_DURATION_MS,
} from './password-reset.service.js'

describe('password-reset.service', () => {
  it('genera tokens de recuperación con suficiente entropía', () => {
    const first = createPasswordResetToken()
    const second = createPasswordResetToken()

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toMatch(/^[a-f0-9]{64}$/)
    expect(second).not.toBe(first)
  })

  it('almacena un hash determinista del token', () => {
    expect(
      hashPasswordResetToken('token-de-prueba'),
    ).toBe(
      hashPasswordResetToken('token-de-prueba'),
    )
    expect(
      hashPasswordResetToken('token-de-prueba'),
    ).not.toBe(
      hashPasswordResetToken('otro-token'),
    )
  })

  it('establece una caducidad de una hora', () => {
    const now = 1_700_000_000_000
    const expiresAt = getPasswordResetExpiry(now)

    expect(expiresAt.getTime()).toBe(
      now + PASSWORD_RESET_TOKEN_DURATION_MS,
    )
  })
})
