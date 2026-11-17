import type { FastifyBaseLogger } from 'fastify'

import { prisma } from '../db/prisma.js'
import { safeErrorName } from '../services/log-safety.js'
import { getStorage } from '../storage/object-storage.js'

// Limpieza diferida de archivos sin referencia (DA-46). Los triggers de PostgreSQL añaden a
// StorageCleanup cada clave que deja de estar referenciada (fotografía o material borrado o
// sustituido, también en cascada). Tras el commit se intenta borrar el archivo; si falla, la fila
// queda con el número de intentos para reintentarlo más tarde (pnpm --filter api storage:cleanup).
// Nunca lanza: un fallo de limpieza no debe romper la operación que ya se ha confirmado.

export interface CleanupResult {
  deleted: number
  failed: number
}

/** Intenta borrar los archivos pendientes (los indicados o los más antiguos). */
export async function drainStorageCleanup(log: FastifyBaseLogger | null, keys?: string[], limit = 20): Promise<CleanupResult> {
  const result = { deleted: 0, failed: 0 }
  let rows: { id: string; storageKey: string }[]
  try {
    rows = await prisma.storageCleanup.findMany({
      where: keys ? { storageKey: { in: keys } } : {},
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, storageKey: true },
    })
  } catch (error) {
    log?.warn({ errorName: safeErrorName(error) }, 'No se pudo leer la cola de limpieza del almacenamiento')
    return result
  }
  for (const row of rows) {
    try {
      // Defensa adicional: nunca se borra un archivo que siga referenciado.
      const [photo, thumb, media, audio, upload, aiResult] = await Promise.all([
        prisma.propertyPhoto.count({ where: { storageKey: row.storageKey } }),
        prisma.propertyPhoto.count({ where: { thumbKey: row.storageKey } }),
        prisma.listingMedia.count({ where: { storageKey: row.storageKey } }),
        prisma.audioTrack.count({ where: { storageKey: row.storageKey } }),
        // Una subida directa todavía en curso (DA-58) no se toca.
        prisma.uploadAttempt.count({ where: { storageKey: row.storageKey, status: { in: ['pending', 'processing'] }, expiresAt: { gt: new Date() } } }),
        // Un resultado de IA pendiente de revisión (DA-71) tampoco.
        prisma.aiMediaJob.count({ where: { resultKey: row.storageKey, status: { in: ['moderating', 'ready'] } } }),
      ])
      if (photo + thumb + media + audio + upload + aiResult === 0) await (await getStorage()).delete(row.storageKey)
      await prisma.storageCleanup.delete({ where: { id: row.id } })
      result.deleted += 1
    } catch (error) {
      result.failed += 1
      log?.warn({ errorName: safeErrorName(error) }, 'No se pudo borrar un archivo sin referencia; queda pendiente')
      await prisma.storageCleanup
        .update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastError: safeErrorName(error), updatedAt: new Date() } })
        .catch(() => {})
    }
  }
  return result
}

/** Registra para limpieza un archivo subido que no llegó a referenciarse (fallo tras el put). */
export async function discardUnreferenced(log: FastifyBaseLogger | null, key: string, reason: string): Promise<void> {
  try {
    await (await getStorage()).delete(key)
  } catch (error) {
    log?.warn({ errorName: safeErrorName(error) }, 'No se pudo borrar un archivo no referenciado; se deja en la cola de limpieza')
    await prisma.storageCleanup.upsert({ where: { storageKey: key }, create: { storageKey: key, reason }, update: {} }).catch(() => {})
  }
}

/**
 * Archivos del almacenamiento sin ninguna referencia en PostgreSQL (fotografías, material o cola).
 * Solo informa; borrarlos es una decisión explícita (storage:cleanup --orphans).
 */
export async function findOrphans(prefix = 'u/'): Promise<string[]> {
  const storage = await getStorage()
  const keys = await storage.list(prefix)
  if (keys.length === 0) return []
  const [photos, thumbs, media, audio, uploads, aiResults] = await Promise.all([
    prisma.propertyPhoto.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } }),
    prisma.propertyPhoto.findMany({ where: { thumbKey: { in: keys } }, select: { thumbKey: true } }),
    prisma.listingMedia.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } }),
    prisma.audioTrack.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } }),
    prisma.uploadAttempt.findMany({ where: { storageKey: { in: keys }, status: { in: ['pending', 'processing'] } }, select: { storageKey: true } }),
    prisma.aiMediaJob.findMany({ where: { resultKey: { in: keys }, status: { in: ['moderating', 'ready'] } }, select: { resultKey: true } }),
  ])
  const referenced = new Set([...photos, ...media, ...audio, ...uploads].map(row => row.storageKey).concat(thumbs.map(row => row.thumbKey ?? ''), aiResults.map(row => row.resultKey ?? '')))
  return keys.filter(key => !referenced.has(key))
}
