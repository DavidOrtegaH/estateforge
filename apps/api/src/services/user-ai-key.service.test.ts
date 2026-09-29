import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userAIKey: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}))

vi.mock('../db/prisma.js', () => ({
  prisma: prismaMock,
}))

import {
  deleteUserAIKey,
  getStoredAIKeyStatus,
  getUserAIKey,
  saveUserAIKey,
} from './user-ai-key.service.js'

describe('user AI keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ESTATEFORGE_API_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
  })

  it('guarda la key cifrada y no el valor en claro', async () => {
    prismaMock.userAIKey.upsert.mockResolvedValue({})

    await saveUserAIKey('user-1', 'gemini', 'AIza-secret-value')

    const call = prismaMock.userAIKey.upsert.mock.calls[0][0]
    expect(call.create.encryptedKey).not.toBe('AIza-secret-value')
    expect(call.create.encryptedKey).toContain('.')
  })

  it('devuelve solo el estado de configuración de las keys', async () => {
    prismaMock.userAIKey.findMany.mockResolvedValue([
      { provider: 'gemini' },
    ])

    await expect(getStoredAIKeyStatus('user-1')).resolves.toEqual({
      gemini: true,
      openai: false,
    })
  })

  it('descifra la key solo para el uso interno del proveedor', async () => {
    prismaMock.userAIKey.upsert.mockResolvedValue({})
    await saveUserAIKey('user-1', 'openai', 'sk-secret-value')

    const encryptedKey =
      prismaMock.userAIKey.upsert.mock.calls[0][0].create.encryptedKey

    prismaMock.userAIKey.findUnique.mockResolvedValue({ encryptedKey })

    await expect(getUserAIKey('user-1', 'openai')).resolves.toBe('sk-secret-value')
  })

  it('permite eliminar una key guardada', async () => {
    prismaMock.userAIKey.deleteMany.mockResolvedValue({ count: 1 })

    await deleteUserAIKey('user-1', 'gemini')

    expect(prismaMock.userAIKey.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        provider: 'gemini',
      },
    })
  })
})
