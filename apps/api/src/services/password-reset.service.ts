
import { createHash, randomBytes } from 'node:crypto'

import { prisma } from '../db/prisma.js'

export const PASSWORD_RESET_TOKEN_DURATION_MS =
  1000 * 60 * 60

// Tipos de token (E2): el de autoservicio y el obligatorio tras un incidente.
export const SELF_SERVICE_PURPOSE = 'SELF_SERVICE'
export const SECURITY_RECOVERY_PURPOSE = 'SECURITY_RECOVERY'

export type SecurityRecoveryResult =
  | 'completed'
  // Token inexistente, usado, caducado o que no es de recuperación obligatoria.
  | 'invalid_token'
  // La cuenta ya no está en recuperación obligatoria o su estado de seguridad no coincide.
  | 'state_mismatch'
  // El destino autorizado pertenece a otra cuenta.
  | 'email_taken'

// Se lanza dentro de la transacción para que Prisma la deshaga entera,
// incluida la reclamación del token.
class SecurityRecoveryAbort extends Error {
  constructor(readonly result: Exclude<SecurityRecoveryResult, 'completed'>) {
    super(result)
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

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
    // Solo sustituye tokens de autoservicio: un token obligatorio pendiente (E2) se conserva.
    prisma.passwordResetToken.deleteMany({
      where: {
        userId,
        usedAt: null,
        purpose: SELF_SERVICE_PURPOSE,
      },
    }),
    prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
        purpose: SELF_SERVICE_PURPOSE,
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
          purpose: true,
        },
      })

    // Un token obligatorio (E2) solo se consume por su propio flujo.
    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() <= now.getTime() ||
      resetToken.purpose !== SELF_SERVICE_PURPOSE
    ) {
      return false
    }

    const owner = await tx.user.findUnique({ where: { id: resetToken.userId }, select: { securityHoldAt: true, adminSuspendedAt: true, passwordResetRequiredAt: true } })
    if (!owner || owner.securityHoldAt || owner.adminSuspendedAt || owner.passwordResetRequiredAt) return false

    const claimed =
      await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: {
            gt: now,
          },
          purpose: SELF_SERVICE_PURPOSE,
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

/**
 * Completa la recuperación obligatoria tras un incidente (E2.5): contraseña nueva y
 * email restaurado al destino autorizado, en una sola transacción. Cualquier rechazo
 * posterior a la reclamación o cualquier fallo la deshace entera, también el token.
 */
export async function consumeSecurityRecoveryToken(
  token: string,
  passwordHash: string,
): Promise<SecurityRecoveryResult> {
  const tokenHash = hashPasswordResetToken(token)
  const now = new Date()

  try {
    return await prisma.$transaction(async (tx) => {
      const record = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
          purpose: true,
          deliverTo: true,
          securityHoldVersion: true,
        },
      })

      if (
        !record ||
        record.usedAt ||
        record.expiresAt.getTime() <= now.getTime() ||
        record.purpose !== SECURITY_RECOVERY_PURPOSE ||
        !record.deliverTo ||
        record.securityHoldVersion === null
      ) {
        return 'invalid_token'
      }

      const { userId, deliverTo, securityHoldVersion } = record
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          passwordResetRequiredAt: true,
          securityHoldAt: true,
          adminSuspendedAt: true,
          securityHoldVersion: true,
          securityRecoveryEmail: true,
        },
      })

      if (
        !user ||
        !user.passwordResetRequiredAt ||
        user.securityHoldAt ||
        user.adminSuspendedAt ||
        user.securityHoldVersion !== securityHoldVersion ||
        user.securityRecoveryEmail !== deliverTo
      ) {
        return 'state_mismatch'
      }

      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: record.id,
          usedAt: null,
          expiresAt: { gt: now },
          purpose: SECURITY_RECOVERY_PURPOSE,
        },
        data: { usedAt: now },
      })

      if (claimed.count !== 1) {
        return 'invalid_token'
      }

      // Desde aquí el token está reclamado: cualquier rechazo lanza para deshacerlo.
      const holder = await tx.user.findUnique({
        where: { email: deliverTo },
        select: { id: true },
      })

      if (holder && holder.id !== userId) {
        throw new SecurityRecoveryAbort('email_taken')
      }

      // Las mismas condiciones que la lectura anterior, ahora dentro de la escritura.
      const updated = await tx.user.updateMany({
        where: {
          id: userId,
          passwordResetRequiredAt: { not: null },
          securityHoldAt: null,
          adminSuspendedAt: null,
          securityHoldVersion,
          securityRecoveryEmail: deliverTo,
        },
        data: {
          password: passwordHash,
          email: deliverTo,
          passwordResetRequiredAt: null,
          securityRecoveryEmail: null,
        },
      })

      if (updated.count !== 1) {
        throw new SecurityRecoveryAbort('state_mismatch')
      }

      // Solo registros de esta cuenta.
      await tx.session.deleteMany({ where: { userId } })
      await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } })
      await tx.emailChangeVerification.deleteMany({ where: { userId, usedAt: null } })
      // Acción del propio usuario: sin emails, token ni enlace.
      await tx.adminAuditLog.create({
        data: {
          actorUserId: userId,
          targetUserId: userId,
          action: 'SECURITY_RECOVERY_COMPLETED',
        },
      })

      return 'completed'
    })
  } catch (error) {
    if (error instanceof SecurityRecoveryAbort) return error.result
    // Otra cuenta ocupó el destino después de la comprobación: la restricción UNIQUE
    // de User.email falla al escribir o al confirmar, y Prisma ya ha deshecho la transacción.
    if (isUniqueConstraintError(error)) return 'email_taken'
    throw error
  }
}


