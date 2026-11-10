import { z } from 'zod'

// Metadatos de AdminAuditLog: JSON guardado en una columna String.
// Los registros antiguos pueden no tenerlos o tener solo revokedCount.
// recoveryDestination (E2.4) indica de dónde salió el destino de la recuperación
// obligatoria; la dirección en sí no se guarda aquí.
export const RECOVERY_DESTINATION_SOURCES = ['STORED', 'OWNER_PROVIDED', 'OWNER_CORRECTED'] as const
export type RecoveryDestinationSource = (typeof RECOVERY_DESTINATION_SOURCES)[number]

// Fase en la que falló el aviso de seguridad tras un cambio de email (EMAIL_CHANGE_NOTICE_FAILED,
// corrección F0-002): al crear el enlace de incidente o al enviar el correo. Es una clasificación
// propia, nunca el mensaje del error.
export const NOTICE_FAILURE_KINDS = ['INCIDENT_LINK', 'DELIVERY'] as const
export type NoticeFailureKind = (typeof NOTICE_FAILURE_KINDS)[number]

export interface AuditMetadata {
  revokedCount?: number
  actorEmail?: string
  targetEmail?: string
  recoveryDestination?: RecoveryDestinationSource
  noticeFailure?: NoticeFailureKind
}

const AuditEmail = z.string().min(1).max(254)
const RevokedCount = z.number().int().nonnegative()
const RecoveryDestination = z.enum(RECOVERY_DESTINATION_SOURCES)
const NoticeFailure = z.enum(NOTICE_FAILURE_KINDS)

/** Serializa los metadatos omitiendo los campos desconocidos; null si no queda ninguno. */
export function buildAuditMetadata(input: {
  revokedCount?: number
  actorEmail?: string | null
  targetEmail?: string | null
  recoveryDestination?: RecoveryDestinationSource
  noticeFailure?: NoticeFailureKind
}): string | null {
  const metadata: AuditMetadata = {}
  if (input.revokedCount !== undefined) metadata.revokedCount = input.revokedCount
  if (typeof input.actorEmail === 'string') metadata.actorEmail = input.actorEmail
  if (typeof input.targetEmail === 'string') metadata.targetEmail = input.targetEmail
  if (input.recoveryDestination !== undefined) metadata.recoveryDestination = input.recoveryDestination
  if (input.noticeFailure !== undefined) metadata.noticeFailure = input.noticeFailure
  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null
}

/** Lee los metadatos validando cada campo por separado; nunca lanza. */
export function parseAuditMetadata(raw: string | null): AuditMetadata {
  if (raw === null) return {}

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

  const fields = value as Record<string, unknown>
  const result: AuditMetadata = {}
  const revokedCount = RevokedCount.safeParse(fields.revokedCount)
  if (revokedCount.success) result.revokedCount = revokedCount.data
  const actorEmail = AuditEmail.safeParse(fields.actorEmail)
  if (actorEmail.success) result.actorEmail = actorEmail.data
  const targetEmail = AuditEmail.safeParse(fields.targetEmail)
  if (targetEmail.success) result.targetEmail = targetEmail.data
  const recoveryDestination = RecoveryDestination.safeParse(fields.recoveryDestination)
  if (recoveryDestination.success) result.recoveryDestination = recoveryDestination.data
  const noticeFailure = NoticeFailure.safeParse(fields.noticeFailure)
  if (noticeFailure.success) result.noticeFailure = noticeFailure.data
  return result
}

/**
 * Añade a cada registro el email actual de las cuentas (si existen) y el
 * guardado al registrar la acción (si lo hay). No devuelve metadata en crudo.
 * Sin actor (acción no autenticada) o sin cuenta afectada, su email y su
 * *Found son null: no hay cuenta que buscar.
 */
export function resolveAuditAccounts<T extends { actorUserId: string | null; targetUserId: string | null; metadata: string | null }>(
  logs: T[],
  emailsById: ReadonlyMap<string, string>,
) {
  return logs.map(({ metadata, ...log }) => {
    const snapshot = parseAuditMetadata(metadata)
    const actorUserId = log.actorUserId
    const targetUserId = log.targetUserId
    return {
      ...log,
      actorEmail: actorUserId === null ? null : emailsById.get(actorUserId) ?? null,
      actorEmailAtAction: snapshot.actorEmail ?? null,
      actorFound: actorUserId === null ? null : emailsById.has(actorUserId),
      targetEmail: targetUserId === null ? null : emailsById.get(targetUserId) ?? null,
      targetEmailAtAction: snapshot.targetEmail ?? null,
      targetFound: targetUserId === null ? null : emailsById.has(targetUserId),
      revokedCount: snapshot.revokedCount ?? null,
      recoveryDestination: snapshot.recoveryDestination ?? null,
      noticeFailure: snapshot.noticeFailure ?? null,
    }
  })
}
