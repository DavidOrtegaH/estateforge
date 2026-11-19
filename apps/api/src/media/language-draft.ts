import type { GeneratedListing, ListingLanguage } from '@estateforge/shared'
import { prisma } from '../db/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { readSource, type MediaSource } from './listing-media.service.js'
import { MediaError, notFound } from './media-errors.js'

export const LANGUAGE_DRAFT_TTL_MS = 15 * 60_000
export interface LanguageDraftData {
  listing: GeneratedListing
  language: ListingLanguage
  expectedUpdatedAt: string
  propertyUpdatedAt: string
  beforeSourceHash: string
  source: MediaSource
  mediaVersions: Record<string, number>
}

/** Bounded cleanup; cascading upload deletion uses the existing storage cleanup triggers. */
export async function expireLanguageDrafts(userId?: string): Promise<number> {
  const where = { ...(userId && { userId }), expiresAt: { lte: new Date() } }
  const rows = await prisma.generationLanguageDraft.findMany({ where, take: 100, select: { id: true } })
  if (!rows.length) return 0
  return (await prisma.generationLanguageDraft.deleteMany({ where: { ...where, id: { in: rows.map(row => row.id) } } })).count
}

export async function readLanguageDraft(userId: string, generationId: string, draftId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const row = await db.generationLanguageDraft.findFirst({ where: { id: draftId, userId, generationId, generation: { property: { userId } } } })
  if (!row) throw notFound('La preparación')
  if (row.status !== 'committed' && (row.status !== 'pending' || row.expiresAt.getTime() <= Date.now())) throw new MediaError('UPLOAD_EXPIRED', 'La preparación se canceló o caducó. El anuncio no ha cambiado.')
  return { ...row, data: JSON.parse(row.data) as LanguageDraftData }
}

export async function assertDraftSnapshot(userId: string, generationId: string, data: LanguageDraftData, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
  const [generation, source, media] = await Promise.all([
    db.generation.findFirst({ where: { id: generationId, property: { userId } }, select: { updatedAt: true, property: { select: { updatedAt: true } } } }),
    readSource(db, generationId, userId),
    db.listingMedia.findMany({ where: { generationId }, select: { kind: true, version: true } }),
  ])
  if (!generation || !source) throw notFound('El anuncio')
  const versions = Object.fromEntries(media.map(item => [item.kind, item.version]))
  if (generation.updatedAt.toISOString() !== data.expectedUpdatedAt || generation.property.updatedAt.toISOString() !== data.propertyUpdatedAt || source.sourceHash !== data.beforeSourceHash || Object.keys(versions).length !== Object.keys(data.mediaVersions).length || Object.entries(versions).some(([kind, version]) => data.mediaVersions[kind] !== version)) {
    throw new MediaError('SOURCE_CHANGED', 'El anuncio, el inmueble o su material ha cambiado. Recarga antes de volver a intentarlo.')
  }
}
