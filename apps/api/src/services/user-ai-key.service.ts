import type { AIProviderType } from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import {
  decryptSecret,
  encryptSecret,
} from './secret-encryption.service.js'

export const STORED_AI_KEY_PROVIDERS = ['gemini', 'openai'] as const
export type StoredAIKeyProvider = (typeof STORED_AI_KEY_PROVIDERS)[number]

export function isStoredAIKeyProvider(
  provider: AIProviderType | string,
): provider is StoredAIKeyProvider {
  return (
    provider === 'gemini' ||
    provider === 'openai'
  )
}

export async function saveUserAIKey(
  userId: string,
  provider: StoredAIKeyProvider,
  apiKey: string,
): Promise<void> {
  const normalizedKey = apiKey.trim()

  if (!normalizedKey) {
    throw new Error('La API key no puede estar vacía.')
  }

  await prisma.userAIKey.upsert({
    where: {
      userId_provider: {
        userId,
        provider,
      },
    },
    create: {
      userId,
      provider,
      encryptedKey: encryptSecret(normalizedKey),
    },
    update: {
      encryptedKey: encryptSecret(normalizedKey),
    },
  })
}

export async function deleteUserAIKey(
  userId: string,
  provider: StoredAIKeyProvider,
): Promise<void> {
  await prisma.userAIKey.deleteMany({
    where: {
      userId,
      provider,
    },
  })
}

export async function getStoredAIKeyStatus(
  userId: string,
): Promise<Record<StoredAIKeyProvider, boolean>> {
  const keys = await prisma.userAIKey.findMany({
    where: { userId },
    select: { provider: true },
  })

  return {
    gemini: keys.some((key) => key.provider === 'gemini'),
    openai: keys.some((key) => key.provider === 'openai'),
  }
}

export async function getUserAIKey(
  userId: string,
  provider: StoredAIKeyProvider,
): Promise<string | null> {
  const key = await prisma.userAIKey.findUnique({
    where: {
      userId_provider: {
        userId,
        provider,
      },
    },
    select: { encryptedKey: true },
  })

  if (!key) {
    return null
  }

  return decryptSecret(key.encryptedKey)
}
