
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

export type EmailChangeResult =
  | { success: true; email: string; oldEmail: string }
  | { success: false; reason: 'invalid' | 'email_taken' }

// Se lanza dentro de la transacción para deshacerla entera, incluida la reclamación del código
// (corrección F0-003). Fuera se traduce al resultado público.
class EmailChangeAbort extends Error {
  constructor(readonly reason: 'email_taken') {
    super(reason)
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

export async function consumeEmailChangeCode(
  userId: string,
  code: string,
): Promise<EmailChangeResult> {
  const codeHash = hashEmailChangeCode(code)
  const now = new Date()

  try {
    return await prisma.$transaction(async (tx): Promise<EmailChangeResult> => {
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

      const currentUser = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      })

      if (!currentUser) {
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

      // El código enviado a la dirección nueva demuestra que el titular la controla: el cambio
      // confirmado la deja verificada (decisión D1 de la Fase 0), en la misma escritura.
      try {
        await tx.user.update({
          where: { id: userId },
          data: { email: verification.newEmail, emailVerifiedAt: now },
        })
      } catch (error) {
        // Otra cuenta ocupó la dirección después de la comprobación anterior: se aborta la
        // transacción para que la reclamación del código no se confirme (F0-003).
        if (isUniqueConstraintError(error)) throw new EmailChangeAbort('email_taken')
        throw error
      }

      // Los enlaces de verificación pendientes eran de la dirección anterior: dejan de servir.
      // Solo los no usados; los ya consumidos se conservan tal como estaban.
      await tx.emailVerificationToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      })

      await tx.emailChangeVerification.deleteMany({
        where: { userId },
      })

      return {
        success: true,
        email: verification.newEmail,
        oldEmail: currentUser.email,
      }
    })
  } catch (error) {
    if (error instanceof EmailChangeAbort) return { success: false, reason: error.reason }
    throw error
  }
}


