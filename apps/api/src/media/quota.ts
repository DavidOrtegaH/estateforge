import type { Prisma } from '../generated/prisma/client.js'
import { MediaError } from './media-errors.js'

// Cuota de almacenamiento por usuario (DA-51): suma de fotografías, miniaturas, carteles, vídeos y
// pistas de audio. Protege el almacenamiento gratuito (Vercel Blob Hobby: 1 GB en total) sin reducir
// los límites funcionales. STORAGE_USER_QUOTA_MB la ajusta; por defecto, 500 MB.
//
// Orden de bloqueos en toda escritura de archivos: usuario, inmueble y anuncio. El bloqueo del
// usuario (FOR NO KEY UPDATE) serializa las comprobaciones de cuota del mismo usuario sin impedir
// que se creen filas que lo referencian (sesiones, inmuebles).

type Tx = Prisma.TransactionClient

export const DEFAULT_USER_QUOTA_MB = 500

export function userQuotaBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STORAGE_USER_QUOTA_MB?.trim()
  if (!raw) return DEFAULT_USER_QUOTA_MB * 1024 * 1024
  const mb = Number(raw)
  if (!Number.isInteger(mb) || mb < 10 || mb > 100_000) throw new MediaError('STORAGE_UNAVAILABLE', 'La cuota de almacenamiento configurada no es válida.')
  return mb * 1024 * 1024
}

export async function lockUser(tx: Tx, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`
  if (rows.length !== 1) throw new MediaError('NOT_FOUND', 'La cuenta no existe.')
}

/** Bytes que ocupan los archivos del usuario. */
export async function usedBytes(db: Pick<Tx, '$queryRaw'>, userId: string): Promise<number> {
  const [row] = await db.$queryRaw<{ total: bigint | number | null }[]>`
    SELECT
      (SELECT COALESCE(SUM(f."size" + COALESCE(f."thumbSize", 0)), 0) FROM "PropertyPhoto" f JOIN "Property" p ON p."id" = f."propertyId" WHERE p."userId" = ${userId})
      + (SELECT COALESCE(SUM(m."size"), 0) FROM "ListingMedia" m JOIN "Generation" g ON g."id" = m."generationId" JOIN "Property" p ON p."id" = g."propertyId" WHERE p."userId" = ${userId})
      + (SELECT COALESCE(SUM(a."size"), 0) FROM "AudioTrack" a WHERE a."userId" = ${userId}) AS "total"`
  return Number(row?.total ?? 0)
}

/**
 * Bytes reservados por subidas directas pendientes y vigentes (DA-58). Una reserva caducada no cuenta:
 * nunca bloquea la cuota de forma indefinida. `exceptAttemptId` excluye la subida que se confirma.
 */
export async function reservedBytes(db: Pick<Tx, '$queryRaw'>, userId: string, exceptAttemptId: string | null = null): Promise<number> {
  const [row] = await db.$queryRaw<{ total: bigint | number | null }[]>`
    SELECT COALESCE(SUM("size"), 0) AS "total" FROM "UploadAttempt"
    WHERE "userId" = ${userId} AND "status" IN ('pending', 'processing') AND "expiresAt" > now()
      AND (${exceptAttemptId}::text IS NULL OR "id" <> ${exceptAttemptId})`
  return Number(row?.total ?? 0)
}

/**
 * Comprueba que, tras sustituir `freed` bytes por `added`, el usuario no supera su cuota, contando
 * también lo reservado por subidas pendientes. Debe llamarse con el usuario bloqueado (lockUser)
 * dentro de la misma transacción.
 */
export async function assertUserQuota(tx: Tx, userId: string, added: number, freed = 0, exceptAttemptId: string | null = null): Promise<void> {
  const quota = userQuotaBytes()
  const used = (await usedBytes(tx, userId)) + (await reservedBytes(tx, userId, exceptAttemptId))
  if (used - freed + added > quota) {
    throw new MediaError('QUOTA_EXCEEDED', `Has alcanzado tu espacio de almacenamiento (${Math.round(quota / 1024 / 1024)} MB). Elimina fotografías, materiales o pistas que no uses.`)
  }
}
