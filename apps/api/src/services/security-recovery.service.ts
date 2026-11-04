import type { FastifyBaseLogger } from 'fastify'

import { prisma } from '../db/prisma.js'
import { emailService } from './email.service.js'
import { createPasswordResetToken, getPasswordResetExpiry, hashPasswordResetToken } from './password-reset.service.js'

// Enlaces de recuperación obligatoria (E2): creación del token, envío y solicitud del titular (E2.6).

const WEB_APP_URL = process.env.WEB_APP_URL ?? 'http://localhost:5173'

// Entre dos enlaces emitidos por el titular para la misma cuenta. Con la caducidad de 1 hora,
// limita a 4 los correos por hora y evita invalidar en bucle un enlace recién enviado.
export const SECURITY_RECOVERY_REQUEST_COOLDOWN_MS = 1000 * 60 * 15

// Las candidatas se leen por páginas, ordenadas por id con un cursor estable; se procesan todas.
export const REQUEST_CANDIDATES_PAGE_SIZE = 50

export interface RecoveryLink {
  userId: string
  to: string
  token: string
  expiresAt: Date
}

// Token SECURITY_RECOVERY nuevo: el token en claro solo viaja en el enlace del correo.
export function newRecoveryToken(userId: string, deliverTo: string, securityHoldVersion: number) {
  const token = createPasswordResetToken()
  const expiresAt = getPasswordResetExpiry()
  return {
    token,
    expiresAt,
    data: { userId, tokenHash: hashPasswordResetToken(token), expiresAt, purpose: 'SECURITY_RECOVERY', deliverTo, securityHoldVersion },
  }
}

// Envía el enlace después del commit; devuelve si se pudo enviar. Un fallo no deshace nada:
// la obligación y el token se mantienen para poder reenviarlo.
export async function sendRecoveryLink(
  log: FastifyBaseLogger,
  targetUserId: string,
  link: { token: string; expiresAt: Date; to: string },
): Promise<boolean> {
  const recoveryUrl = new URL('/recuperar-cuenta', WEB_APP_URL)
  recoveryUrl.searchParams.set('token', link.token)
  try {
    await emailService.sendSecurityRecoveryEmail({ to: link.to, recoveryUrl: recoveryUrl.toString(), expiresAt: link.expiresAt })
    return true
  } catch (error) {
    // Sin el error completo: podría incluir el destinatario o el contenido del mensaje.
    log.error({ targetUserId, errorName: error instanceof Error ? error.name : typeof error }, 'No se pudo enviar el enlace de recuperación obligatoria')
    return false
  }
}

// Envíos lanzados sin esperar a la respuesta HTTP. Siguen ejecutándose al terminar la
// petición, y el cierre ordenado de la app espera a que acaben (hook onClose de authRoutes).
const pendingDeliveries = new Set<Promise<void>>()

export function deliverRecoveryLinkInBackground(log: FastifyBaseLogger, link: RecoveryLink): void {
  const delivery: Promise<void> = (async () => {
    try {
      await sendRecoveryLink(log, link.userId, link)
    } catch (error) {
      // Cualquier fallo antes del SMTP (por ejemplo, al construir el enlace): nunca queda
      // un rechazo sin gestionar. Solo el id de la cuenta y el tipo de error.
      log.error({ targetUserId: link.userId, errorName: error instanceof Error ? error.name : typeof error }, 'No se pudo enviar el enlace de recuperación obligatoria')
    }
  })().finally(() => {
    pendingDeliveries.delete(delivery)
  })
  pendingDeliveries.add(delivery)
}

export function countPendingRecoveryDeliveries(): number {
  return pendingDeliveries.size
}

export async function waitForPendingRecoveryDeliveries(): Promise<void> {
  // Un envío puede terminar y dejar otro registrado mientras se espera: se repite hasta vaciar.
  while (pendingDeliveries.size > 0) {
    await Promise.allSettled(pendingDeliveries)
  }
}

/**
 * Solicitud del titular (E2.6): emite un enlace nuevo para cada cuenta con recuperación
 * pendiente cuyo email o destino guardado coincida con `email`. Siempre al destino guardado,
 * con la versión actual. Cada cuenta se evalúa en su propia transacción, de modo que una que
 * no cumpla las condiciones o falle no impide las demás. Devuelve los enlaces que enviar
 * después del commit; nunca revela por qué una cuenta no recibe enlace.
 */
export async function issueRequestedRecoveryLinks(
  log: FastifyBaseLogger,
  email: string,
  now = new Date(),
): Promise<RecoveryLink[]> {
  const links: RecoveryLink[] = []
  // Cursor por id: el procesamiento no cambia ids ni los campos del filtro, así que ninguna
  // cuenta se repite y no se omite ninguna de las que coinciden durante todo el recorrido. No es
  // una instantánea: una cuenta que cambie esos campos a la vez, o una nueva con un id anterior
  // al cursor, puede quedar fuera; cada cuenta procesada se protege con su escritura condicional.
  let after: string | null = null
  for (;;) {
    const page: { id: string; securityHoldVersion: number; securityRecoveryEmail: string | null }[] = await prisma.user.findMany({
      where: {
        OR: [{ email }, { securityRecoveryEmail: email }],
        passwordResetRequiredAt: { not: null },
        securityHoldAt: null,
        adminSuspendedAt: null,
        securityRecoveryEmail: { not: null },
        ...(after !== null && { id: { gt: after } }),
      },
      select: { id: true, securityHoldVersion: true, securityRecoveryEmail: true },
      orderBy: { id: 'asc' },
      take: REQUEST_CANDIDATES_PAGE_SIZE,
    })

    for (const candidate of page) {
      const destination = candidate.securityRecoveryEmail
      if (!destination) continue
      try {
        const link = await issueRequestedLinkFor(candidate.id, destination, candidate.securityHoldVersion, now)
        if (link) links.push(link)
      } catch (error) {
        // Sin datos de la cuenta salvo su id; la solicitud sigue con las demás candidatas.
        log.error({ targetUserId: candidate.id, errorName: error instanceof Error ? error.name : typeof error }, 'No se pudo emitir un enlace de recuperación solicitado')
      }
    }

    if (page.length < REQUEST_CANDIDATES_PAGE_SIZE) break
    after = page[page.length - 1].id
  }
  return links
}

async function issueRequestedLinkFor(userId: string, destination: string, version: number, now: Date): Promise<RecoveryLink | null> {
  const recovery = newRecoveryToken(userId, destination, version)
  const issued = await prisma.$transaction(async tx => {
    // El destino puede compartirse como securityRecoveryEmail, pero no ser el email de otra cuenta.
    const holder = await tx.user.findUnique({ where: { email: destination }, select: { id: true } })
    if (holder && holder.id !== userId) return false
    // Enfriamiento por cuenta, dentro de la transacción: dos solicitudes simultáneas no emiten dos enlaces.
    const recent = await tx.passwordResetToken.findFirst({
      where: { userId, purpose: 'SECURITY_RECOVERY', createdAt: { gt: new Date(now.getTime() - SECURITY_RECOVERY_REQUEST_COOLDOWN_MS) } },
      select: { id: true },
    })
    if (recent) return false
    // Escritura condicional sin cambios de valor: confirma que la cuenta sigue en el estado leído.
    const updated = await tx.user.updateMany({
      where: {
        id: userId, passwordResetRequiredAt: { not: null }, securityHoldAt: null, adminSuspendedAt: null,
        securityHoldVersion: version, securityRecoveryEmail: destination,
      },
      data: { securityRecoveryEmail: destination },
    })
    if (updated.count !== 1) return false
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null, purpose: 'SECURITY_RECOVERY' } })
    await tx.passwordResetToken.create({ data: recovery.data })
    // Solicitud pública: quien la hace no se autentica, así que no hay actor; la cuenta afectada
    // es el objetivo. Sin metadatos (ni email introducido, ni destino, ni token, ni enlace).
    await tx.adminAuditLog.create({ data: { actorUserId: null, targetUserId: userId, action: 'SECURITY_RECOVERY_LINK_REQUESTED' } })
    return true
  })
  return issued ? { userId, to: destination, token: recovery.token, expiresAt: recovery.expiresAt } : null
}
