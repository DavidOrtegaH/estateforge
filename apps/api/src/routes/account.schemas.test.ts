import { describe, expect, it } from 'vitest'

import {
  ChangePasswordSchema,
  DeleteAccountSchema,
} from './account.schemas.js'

const strongPassword = 'NuevaSegura123!'

describe('Account security schemas', () => {
  it('acepta un cambio de contraseña válido', () => {
    const result = ChangePasswordSchema.safeParse({
      currentPassword: 'password-anterior',
      newPassword: strongPassword,
    })

    expect(result.success).toBe(true)
  })

  it('rechaza un cambio con nueva contraseña débil', () => {
    const result = ChangePasswordSchema.safeParse({
      currentPassword: 'password-anterior',
      newPassword: 'password',
    })

    expect(result.success).toBe(false)
  })

  it('rechaza un cambio sin contraseña actual', () => {
    const result = ChangePasswordSchema.safeParse({
      newPassword: strongPassword,
    })

    expect(result.success).toBe(false)
  })

  it('acepta la contraseña actual para eliminar la cuenta', () => {
    const result = DeleteAccountSchema.safeParse({
      currentPassword: 'password-anterior',
    })

    expect(result.success).toBe(true)
  })

  it('rechaza eliminar la cuenta sin contraseña actual', () => {
    const result = DeleteAccountSchema.safeParse({})

    expect(result.success).toBe(false)
  })
})
