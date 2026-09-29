import { beforeEach, describe, expect, it } from 'vitest'

import {
  decryptSecret,
  encryptSecret,
} from './secret-encryption.service.js'

describe('secret encryption', () => {
  beforeEach(() => {
    process.env.ESTATEFORGE_API_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  })

  it('cifra y descifra una API key sin devolver el contenido cifrado en claro', () => {
    const value = 'AIza-example-secret-key'
    const encrypted = encryptSecret(value)

    expect(encrypted).not.toContain(value)
    expect(decryptSecret(encrypted)).toBe(value)
  })

  it('produce un cifrado diferente para el mismo secreto', () => {
    const value = 'sk-example-secret-key'

    expect(encryptSecret(value)).not.toBe(encryptSecret(value))
  })
})
