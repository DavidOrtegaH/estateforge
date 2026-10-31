import {
  createHash,
  randomBytes,
} from 'node:crypto'

import { prisma } from '../db/prisma.js'

const SESSION_DURATION_MS =
  1000 * 60 * 60 * 24 * 7

function hashToken(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex')
}

export async function createSession(
  userId: string,
): Promise<{
  token: string
  expiresAt: Date
}> {
  const token = randomBytes(32).toString('hex')

  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_MS,
  )

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
    },
  })

  return {
    token,
    expiresAt,
  }
}

export async function getUserIdFromSession(
  token: string,
): Promise<string | null> {
  if (!token) {
    return null
  }

  const session =
    await prisma.session.findUnique({
      where: {
        tokenHash: hashToken(token),
      },
      select: {
        userId: true,
        expiresAt: true,
        user: { select: { securityHoldAt: true } },
      },
    })

  if (!session) {
    return null
  }

  if (session.user.securityHoldAt) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
    return null
  }

  if (
    session.expiresAt.getTime() <=
    Date.now()
  ) {
    await prisma.session.deleteMany({
      where: {
        tokenHash: hashToken(token),
      },
    })

    return null
  }

  return session.userId
}

export async function deleteSession(
  token: string,
): Promise<void> {
  await prisma.session.deleteMany({
    where: {
      tokenHash: hashToken(token),
    },
  })
}
