import { z } from 'zod'

// Metadatos de AdminAuditLog: JSON guardado en una columna String.
// Los registros antiguos pueden no tenerlos o tener solo revokedCount.
export interface AuditMetadata {
  revokedCount?: number
  actorEmail?: string
  targetEmail?: string
}

const AuditEmail = z.string().min(1).max(254)
const RevokedCount = z.number().int().nonnegative()

/** Serializa los metadatos omitiendo los campos desconocidos; null si no queda ninguno. */
export function buildAuditMetadata(input: {
  revokedCount?: number
  actorEmail?: string | null
  targetEmail?: string | null
}): string | null {
  const metadata: AuditMetadata = {}
  if (input.revokedCount !== undefined) metadata.revokedCount = input.revokedCount
  if (typeof input.actorEmail === 'string') metadata.actorEmail = input.actorEmail
  if (typeof input.targetEmail === 'string') metadata.targetEmail = input.targetEmail
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
  return result
}

/**
 * Añade a cada registro el email actual de las cuentas (si existen) y el
 * guardado al registrar la acción (si lo hay). No devuelve metadata en crudo.
 */
export function resolveAuditAccounts<T extends { actorUserId: string; targetUserId: string | null; metadata: string | null }>(
  logs: T[],
  emailsById: ReadonlyMap<string, string>,
) {
  return logs.map(({ metadata, ...log }) => {
    const snapshot = parseAuditMetadata(metadata)
    const targetUserId = log.targetUserId
    return {
      ...log,
      actorEmail: emailsById.get(log.actorUserId) ?? null,
      actorEmailAtAction: snapshot.actorEmail ?? null,
      actorFound: emailsById.has(log.actorUserId),
      targetEmail: targetUserId === null ? null : emailsById.get(targetUserId) ?? null,
      targetEmailAtAction: snapshot.targetEmail ?? null,
      targetFound: targetUserId === null ? null : emailsById.has(targetUserId),
      revokedCount: snapshot.revokedCount ?? null,
    }
  })
}
