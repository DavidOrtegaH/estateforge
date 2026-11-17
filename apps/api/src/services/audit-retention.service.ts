import { prisma } from '../db/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { lockUserRow } from './user-lock.js'

// Retención de AdminAuditLog (política autorizada por el propietario): los registros se conservan
// 90 días desde createdAt y después los elimina el mantenimiento diario, por lotes acotados.
// Solo esta tabla: no toca cuentas, sesiones, tokens ni ningún otro registro.
//
// Excepción (incidente abierto). Un registro se conserva mientras su actor o su cuenta afectada
// (actorUserId / targetUserId) sea una cuenta existente con:
//   - securityHoldAt != NULL: protección por incidente activa (la cuenta está bloqueada), o
//   - passwordResetRequiredAt != NULL: recuperación obligatoria pendiente. Es la segunda fase del
//     mismo incidente: el OWNER retira la protección y la cuenta sigue sin acceso hasta que el
//     titular completa la recuperación (que pone el campo a NULL). Hasta entonces el incidente no
//     está resuelto.
// No existe otro campo de retención; adminSuspendedAt es una suspensión administrativa, no un
// incidente, y no cambia la retención.
//
// Relación fiable: solo los identificadores. Los emails de metadata son instantáneas y no
// identifican una cuenta de forma fiable (pueden haber cambiado). Si un registro no tiene ni actor
// ni cuenta afectada no se puede saber si pertenece a un incidente: se conserva siempre (hoy
// ningún flujo crea registros así). Si la cuenta ya no existe (borrada) no puede tener un
// incidente abierto y sus registros caducan con normalidad; los identificadores no se reutilizan.
//
// Concurrencia. 1) Se eligen candidatos ya excluyendo los protegidos, de modo que filas antiguas
// protegidas nunca ocupan el lote (sin starvation). 2) En una transacción se bloquean, en orden
// estable, las filas User de las cuentas implicadas con lockUserRow, el mismo bloqueo que toman
// la denuncia de incidente y la recuperación. 3) El DELETE vuelve a comprobar la antigüedad y la
// excepción: en READ COMMITTED cada sentencia ve lo confirmado, y tras el bloqueo eso incluye un
// incidente abierto por una transacción que lo tuviera. Un incidente abierto después de este
// COMMIT no recupera lo ya eliminado (solo había registros de más de 90 días sin incidente).

export const AUDIT_RETENTION_DAYS = 90
export const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000
/** Lote por defecto de una ejecución diaria; lo que exceda queda para la siguiente. */
export const AUDIT_RETENTION_BATCH = 100
export const AUDIT_RETENTION_MAX_BATCH = 500

/** Instante límite: se eliminan los registros con createdAt estrictamente anterior. */
export function auditRetentionCutoff(now: Date): Date {
  const time = now.getTime()
  if (!Number.isFinite(time)) throw new Error('Fecha de referencia no válida para la retención')
  return new Date(time - AUDIT_RETENTION_MS)
}

type Db = Pick<typeof prisma, '$queryRaw' | '$transaction'>

export interface PurgeAuditOptions {
  now?: Date
  batchSize?: number
  db?: Db
}

// Excepción común a la selección y al borrado (alias "a" para AdminAuditLog).
const protectedCondition = Prisma.sql`EXISTS (
  SELECT 1 FROM "User" u
  WHERE u."id" IN (a."actorUserId", a."targetUserId")
    AND (u."securityHoldAt" IS NOT NULL OR u."passwordResetRequiredAt" IS NOT NULL)
)`

/** Elimina como mucho un lote de registros de auditoría caducados. Devuelve cuántos ha borrado. */
export async function purgeExpiredAuditLogs(options: PurgeAuditOptions = {}): Promise<{ deleted: number }> {
  const batchSize = options.batchSize ?? AUDIT_RETENTION_BATCH
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > AUDIT_RETENTION_MAX_BATCH) {
    throw new Error('Tamaño de lote no válido para la retención')
  }
  // Se calcula una vez, antes de tocar nada: un fallo no lo altera y no depende del entorno.
  const cutoff = auditRetentionCutoff(options.now ?? new Date())
  // ISO 8601 con Z: instante inequívoco sea cual sea la zona de la sesión.
  const cutoffIso = cutoff.toISOString()
  const db = options.db ?? prisma

  const candidates = await db.$queryRaw<{ id: string; actorUserId: string | null; targetUserId: string | null }[]>`
    SELECT a."id", a."actorUserId", a."targetUserId"
    FROM "AdminAuditLog" a
    WHERE a."createdAt" < ${cutoffIso}::timestamptz
      AND (a."actorUserId" IS NOT NULL OR a."targetUserId" IS NOT NULL)
      AND NOT ${protectedCondition}
    ORDER BY a."createdAt" ASC, a."id" ASC
    LIMIT ${batchSize}
  `
  if (candidates.length === 0) return { deleted: 0 }

  const ids = candidates.map(row => row.id)
  const userIds = [...new Set(candidates.flatMap(row => [row.actorUserId, row.targetUserId]).filter((id): id is string => id !== null))].sort()

  const deleted = await db.$transaction(async tx => {
    // Orden estable: dos ejecuciones simultáneas no se interbloquean entre sí, y ningún otro flujo
    // bloquea dos cuentas. Una cuenta inexistente (borrada) no se puede bloquear ni abrir incidente.
    for (const userId of userIds) await lockUserRow(tx, userId)
    return tx.$executeRaw`
      DELETE FROM "AdminAuditLog" a
      WHERE a."id" IN (${Prisma.join(ids)})
        AND a."createdAt" < ${cutoffIso}::timestamptz
        AND (a."actorUserId" IS NOT NULL OR a."targetUserId" IS NOT NULL)
        AND NOT ${protectedCondition}
    `
  }, { timeout: 20_000 })

  return { deleted }
}
