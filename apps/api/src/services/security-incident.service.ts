import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '../db/prisma.js'
import { normalizeEmail } from './email-change.service.js'

export const SECURITY_INCIDENT_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// notifiedEmail es la dirección a la que se envía el enlace. Se guarda como dato del
// incidente; no autoriza por sí sola ningún destino de recuperación.
export async function issueSecurityIncidentToken(
  userId: string,
  notifiedEmail: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SECURITY_INCIDENT_TOKEN_TTL_MS)
  await prisma.securityIncidentToken.deleteMany({ where: { userId, usedAt: null } })
  await prisma.securityIncidentToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, notifiedEmail: normalizeEmail(notifiedEmail) },
  })
  return { token, expiresAt }
}

export async function reportSecurityIncident(token: string): Promise<'reported' | 'invalid'> {
  const tokenHash = hashToken(token)
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const record = await tx.securityIncidentToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true, notifiedEmail: true },
    })
    if (!record || record.usedAt || record.expiresAt <= now) return 'invalid'
    const claimed = await tx.securityIncidentToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (claimed.count !== 1) return 'invalid'
    await tx.user.update({
      where: { id: record.userId },
      // Cada incidente recibe una versión nueva, aunque la cuenta ya estuviera protegida.
      // El destino propuesto es el email avisado por este token (null en tokens anteriores
      // a E2): queda pendiente de que lo confirme un OWNER. User.email no se toca.
      data: {
        securityHoldAt: now,
        securityHoldVersion: { increment: 1 },
        securityRecoveryEmail: record.notifiedEmail,
      },
    })
    await tx.session.deleteMany({ where: { userId: record.userId } })
    await tx.passwordResetToken.deleteMany({ where: { userId: record.userId } })
    await tx.emailChangeVerification.deleteMany({ where: { userId: record.userId } })
    await tx.securityIncidentToken.deleteMany({ where: { userId: record.userId, id: { not: record.id } } })
    return 'reported'
  })
}
