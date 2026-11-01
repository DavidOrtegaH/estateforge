
import { createHash, randomBytes } from 'node:crypto'

import { prisma } from '../db/prisma.js'

export const PASSWORD_RESET_TOKEN_DURATION_MS =
  1000 * 60 * 60

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex')
}

export function createPasswordResetToken(): string {
  return randomBytes(32).toString('hex')
}

export function getPasswordResetExpiry(
  now = Date.now(),
): Date {
  return new Date(
    now + PASSWORD_RESET_TOKEN_DURATION_MS,
  )
}

export async function issuePasswordResetToken(
  userId: string,
): Promise<{
  token: string
  expiresAt: Date
}> {
  const token = createPasswordResetToken()
  const tokenHash = hashPasswordResetToken(token)
  const expiresAt = getPasswordResetExpiry()

  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({
      where: {
        userId,
        usedAt: null,
      },
    }),
    prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    }),
  ])

  return {
    token,
    expiresAt,
  }
}

export async function consumePasswordResetToken(
  token: string,
  passwordHash: string,
): Promise<boolean> {
  const tokenHash = hashPasswordResetToken(token)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const resetToken =
      await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
        },
      })

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() <= now.getTime()
    ) {
      return false
    }

    const owner = await tx.user.findUnique({ where: { id: resetToken.userId }, select: { securityHoldAt: true, adminSuspendedAt: true } })
    if (!owner || owner.securityHoldAt || owner.adminSuspendedAt) return false

    const claimed =
      await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: {
          usedAt: now,
        },
      })

    if (claimed.count !== 1) {
      return false
    }

    await tx.user.update({
      where: {
        id: resetToken.userId,
      },
      data: {
        password: passwordHash,
      },
    })

    await tx.session.deleteMany({
      where: {
        userId: resetToken.userId,
      },
    })

    return true
  })
}


