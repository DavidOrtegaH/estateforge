import { createHash, randomInt } from 'node:crypto'

import { prisma } from '../db/prisma.js'

export const EMAIL_CHANGE_CODE_DURATION_MS = 1000 * 60 * 10

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function createEmailChangeCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function hashEmailChangeCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export function getEmailChangeCodeExpiry(now = Date.now()): Date {
  return new Date(now + EMAIL_CHANGE_CODE_DURATION_MS)
}

export async function issueEmailChangeCode(
  userId: string,
  newEmail: string,
): Promise<{ code: string; expiresAt: Date }> {
  const normalizedEmail = normalizeEmail(newEmail)
  const code = createEmailChangeCode()
  const codeHash = hashEmailChangeCode(code)
  const expiresAt = getEmailChangeCodeExpiry()

  await prisma.$transaction([
    prisma.emailChangeVerification.deleteMany({
      where: {
        userId,
        usedAt: null,
      },
    }),
    prisma.emailChangeVerification.create({
      data: {
        userId,
        newEmail: normalizedEmail,
        codeHash,
        expiresAt,
      },
    }),
  ])

  return { code, expiresAt }
}

export async function consumeEmailChangeCode(
  userId: string,
  code: string,
): Promise<{ success: true; email: string } | { success: false; reason: 'invalid' | 'email_taken' }> {
  const codeHash = hashEmailChangeCode(code)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const verification = await tx.emailChangeVerification.findUnique({
      where: { codeHash },
      select: {
        id: true,
        userId: true,
        newEmail: true,
        expiresAt: true,
        usedAt: true,
      },
    })

    if (
      !verification ||
      verification.userId !== userId ||
      verification.usedAt ||
      verification.expiresAt.getTime() <= now.getTime()
    ) {
      return { success: false, reason: 'invalid' }
    }

    const existingUser = await tx.user.findUnique({
      where: { email: verification.newEmail },
      select: { id: true },
    })

    if (existingUser && existingUser.id !== userId) {
      return { success: false, reason: 'email_taken' }
    }

    const claimed = await tx.emailChangeVerification.updateMany({
      where: {
        id: verification.id,
        userId,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    })

    if (claimed.count !== 1) {
      return { success: false, reason: 'invalid' }
    }

    try {
      await tx.user.update({
        where: { id: userId },
        data: { email: verification.newEmail },
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        return { success: false, reason: 'email_taken' }
      }
      throw error
    }

    await tx.emailChangeVerification.deleteMany({
      where: { userId },
    })

    return { success: true, email: verification.newEmail }
  })
}
