import type { AdminAuditAction, AuditNoticeFailure, AuditRecoveryDestination } from '@/services/adminService'

// id null: no hay cuenta que mostrar (acción sin actor autenticado).
export type AuditAccountView = { primary: string; id: string | null; note: string | null }

export const UNAUTHENTICATED_ACTOR_LABEL = 'Solicitud no autenticada'

/**
 * Texto para identificar una cuenta en la auditoría. Sin cuenta devuelve null.
 * Nunca inventa un email: si la cuenta no existe y no hay instantánea, lo dice.
 */
export function describeAuditAccount(account: {
  id: string | null
  email: string | null
  emailAtAction: string | null
  found: boolean | null
}): AuditAccountView | null {
  if (account.id === null) return null

  if (account.found === true && account.email !== null) {
    const changed = account.emailAtAction !== null && account.emailAtAction !== account.email
    return {
      primary: account.email,
      id: account.id,
      note: changed ? `Email en la fecha de la acción: ${account.emailAtAction}` : null,
    }
  }

  if (account.emailAtAction !== null) {
    return { primary: account.emailAtAction, id: account.id, note: 'Cuenta no encontrada; email registrado en la acción' }
  }

  return { primary: 'Cuenta no encontrada', id: account.id, note: null }
}

/** Operador de un registro. Sin actor, la acción la pidió alguien sin sesión: se indica así, sin cuenta. */
export function describeAuditActor(actor: {
  id: string | null
  email: string | null
  emailAtAction: string | null
  found: boolean | null
}): AuditAccountView {
  return describeAuditAccount(actor) ?? { primary: UNAUTHENTICATED_ACTOR_LABEL, id: null, note: null }
}

// Etiqueta de cada acción que acepta el filtro de la auditoría. El tipo obliga a tenerlas todas.
export const AUDIT_ACTION_LABELS: Record<AdminAuditAction, string> = {
  ACCOUNT_SUSPENDED: 'Cuenta suspendida',
  ACCOUNT_UNSUSPENDED: 'Suspensión retirada',
  SESSIONS_REVOKED: 'Sesiones cerradas',
  SECURITY_HOLD_RESOLVED: 'Protección retirada',
  SECURITY_RECOVERY_DESTINATION_CHANGED: 'Destino de recuperación corregido',
  SECURITY_RECOVERY_LINK_RESENT: 'Enlace de recuperación reenviado',
  SECURITY_RECOVERY_LINK_REQUESTED: 'Enlace solicitado por el titular',
  SECURITY_RECOVERY_COMPLETED: 'Recuperación completada',
  EMAIL_CHANGE_NOTICE_FAILED: 'Aviso de cambio de email no enviado',
}

// Opciones del filtro, en el mismo orden que las etiquetas.
export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS) as AdminAuditAction[]

/** Etiqueta de una acción; una acción desconocida se muestra con su código tal cual. */
export function auditActionLabel(action: string): string {
  return Object.hasOwn(AUDIT_ACTION_LABELS, action) ? AUDIT_ACTION_LABELS[action as AdminAuditAction] : action
}

const RECOVERY_DESTINATION_LABELS: Record<AuditRecoveryDestination, string> = {
  STORED: 'destino guardado',
  OWNER_PROVIDED: 'destino indicado por un OWNER',
  OWNER_CORRECTED: 'destino corregido por un OWNER',
}

/** Origen del destino de la recuperación; null si no hay o no se reconoce (nunca se inventa). */
export function recoveryDestinationLabel(source: string | null | undefined): string | null {
  if (typeof source !== 'string' || !Object.hasOwn(RECOVERY_DESTINATION_LABELS, source)) return null
  return RECOVERY_DESTINATION_LABELS[source as AuditRecoveryDestination]
}

const NOTICE_FAILURE_LABELS: Record<AuditNoticeFailure, string> = {
  INCIDENT_LINK: 'no se pudo crear el enlace de incidente',
  DELIVERY: 'falló el envío del correo',
}

/** Fase en la que falló el aviso de cambio de email; null si no hay o no se reconoce. */
export function noticeFailureLabel(kind: string | null | undefined): string | null {
  if (typeof kind !== 'string' || !Object.hasOwn(NOTICE_FAILURE_LABELS, kind)) return null
  return NOTICE_FAILURE_LABELS[kind as AuditNoticeFailure]
}

/**
 * Texto de la columna Acción: la etiqueta y, entre paréntesis, las sesiones cerradas, el origen del
 * destino o la fase en la que falló el aviso de cambio de email.
 */
export function describeAuditAction(log: {
  action: string
  revokedCount: number | null
  recoveryDestination: string | null
  noticeFailure?: string | null
}): string {
  const details = [
    log.revokedCount !== null ? String(log.revokedCount) : null,
    recoveryDestinationLabel(log.recoveryDestination),
    noticeFailureLabel(log.noticeFailure),
  ].filter((detail): detail is string => detail !== null)
  return details.reduce((text, detail) => `${text} (${detail})`, auditActionLabel(log.action))
}
