
import {
  createHash,
  randomBytes,
} from 'node:crypto'

import { prisma } from '../db/prisma.js'
import { isEmailVerificationRequired } from './email-verification.service.js'

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
        user: { select: { securityHoldAt: true, adminSuspendedAt: true, passwordResetRequiredAt: true, emailVerifiedAt: true, createdAt: true } },
      },
    })

  if (!session) {
    return null
  }

  // Protección, suspensión y recuperación obligatoria son estados independientes;
  // cualquiera de ellos invalida la sesión.
  if (session.user.securityHoldAt || session.user.adminSuspendedAt || session.user.passwordResetRequiredAt) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
    return null
  }

  // Email sin verificar cuando ya se exige (cuenta nueva o fin del periodo de gracia, Fase 0).
  if (isEmailVerificationRequired(session.user)) {
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

