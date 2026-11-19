import { waitUntil } from '@vercel/functions'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { AI_TEXT_GENERATION_PROVIDERS, IdParamsSchema, ListingLanguageSchema, listingLanguageOf, type AIProviderType, type ListingTone } from '@estateforge/shared'
import { prisma } from '../db/prisma.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import { assertUserQuota, lockUser } from '../media/quota.js'
import { getMediaSource, saveMedia, sourceWithListing, type MediaUpload } from '../media/listing-media.service.js'
import { assertDraftSnapshot, expireLanguageDrafts, LANGUAGE_DRAFT_TTL_MS, readLanguageDraft, type LanguageDraftData } from '../media/language-draft.js'
import { MediaError, notFound } from '../media/media-errors.js'
import { readExactly, type MediaUploadMeta } from '../media/upload.service.js'
import { drainStorageCleanup } from '../media/storage-cleanup.js'
import { generateWithUserKey, generationNotices, toSharedProperty } from '../services/generation.service.js'
import { buildListingPrompt } from '../services/prompt.service.js'
import { validateGeneratedListing } from '../services/listing-validator.service.js'
import { AIProviderError } from '../ai/ai-provider.error.js'

const Change = z.object({ language: ListingLanguageSchema, confirmed: z.literal(true), expectedUpdatedAt: z.iso.datetime(), stageOnly: z.literal(true) }).strict()
const DraftParams = IdParamsSchema.extend({ draftId: z.string().regex(/^[a-z0-9]{20,40}$/) }).strict()
const Complete = z.object({ uploadIds: z.array(z.string().regex(/^[a-z0-9]{20,40}$/)).max(2) }).strict()
function errorReply(reply: FastifyReply, error: unknown) {
  if (error instanceof MediaError) return reply.code(error.status).send({ message: error.message, code: error.code })
  if (error instanceof AIProviderError) return reply.code(409).send({ message: error.message, code: error.code })
  throw error
}

function backgroundCleanup(reply: FastifyReply) {
  const cleanup = drainStorageCleanup(reply.log).catch(() => undefined)
  try { waitUntil(cleanup) } catch { /* Outside Vercel the local process finishes cleanup. */ }
}

export function registerGenerationLanguageRoutes(app: FastifyInstance) {
  // Preparation only: abandoning this request or its browser tab cannot alter the saved listing.
  app.post('/api/generations/:id/language', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params)
    const body = Change.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Recarga la página y confirma el cambio al otro idioma.' })
    const userId = request.userId
    if (!userId) return reply.code(401).send({ message: 'Se requiere una sesión activa.' })
    const existing = await prisma.generation.findFirst({ where: { id: params.data.id, property: { userId } }, include: { property: true } })
    if (!existing) return reply.code(404).send({ message: 'Anuncio no encontrado.' })
    const language = body.data.language
    if (listingLanguageOf(existing.language) === language) return reply.code(409).send({ message: 'Solo puedes cambiar al idioma distinto del que tiene el anuncio.' })
    try {
      if (existing.updatedAt.toISOString() !== body.data.expectedUpdatedAt) throw new MediaError('SOURCE_CHANGED', 'El anuncio ha cambiado. Recarga antes de cambiar su idioma.')
      await expireLanguageDrafts(userId)
      if (await prisma.generationLanguageDraft.count({ where: { userId, status: 'pending', expiresAt: { gt: new Date() } } }) >= 8) throw new MediaError('LIMIT_REACHED', 'Hay demasiadas preparaciones pendientes. Cancela alguna o espera a que caduque.')
      if (!(AI_TEXT_GENERATION_PROVIDERS as readonly string[]).includes(existing.provider)) throw new MediaError('INVALID_REQUEST', 'El proveedor original ya no está disponible.')
      const provider = existing.provider as AIProviderType
      const [before, media] = await Promise.all([getMediaSource(existing.id, userId), prisma.listingMedia.findMany({ where: { generationId: existing.id }, select: { kind: true, version: true } })])
      const property = toSharedProperty(existing.property)
      const result = await generateWithUserKey(provider, buildListingPrompt({ property, provider, tone: existing.tone as ListingTone, language }), userId, { language })
      const listing = validateGeneratedListing(result, property)
      const data: LanguageDraftData = { listing, language, expectedUpdatedAt: existing.updatedAt.toISOString(), propertyUpdatedAt: existing.property.updatedAt.toISOString(), beforeSourceHash: before.sourceHash, source: sourceWithListing(before, listing, language), mediaVersions: Object.fromEntries(media.map(item => [item.kind, item.version])) }
      const draft = await prisma.$transaction(async tx => {
        await lockUser(tx, userId)
        if (await tx.generationLanguageDraft.count({ where: { userId, status: 'pending', expiresAt: { gt: new Date() } } }) >= 8) throw new MediaError('LIMIT_REACHED', 'Hay demasiadas preparaciones pendientes.')
        await assertDraftSnapshot(userId, existing.id, data, tx)
        return tx.generationLanguageDraft.create({ data: { userId, generationId: existing.id, data: JSON.stringify(data), expiresAt: new Date(Date.now() + LANGUAGE_DRAFT_TTL_MS) } })
      })
      return { draftId: draft.id, expiresAt: draft.expiresAt, generation: data.source.generation, sourceHash: data.source.sourceHash, beforeSourceHash: data.beforeSourceHash, mediaKinds: Object.keys(data.mediaVersions), mediaVersions: data.mediaVersions, notices: generationNotices(provider, language, existing.property.additionalInformation) }
    } catch (error) { return errorReply(reply, error) }
  })

  app.post('/api/generations/:id/language/:draftId/complete', { preHandler: requireAuth }, async (request, reply) => {
    const params = DraftParams.safeParse(request.params)
    const body = Complete.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Preparación no válida.' })
    const userId = request.userId
    if (!userId) return reply.code(401).send({ message: 'Se requiere una sesión activa.' })
    let disconnected = false
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) disconnected = true })
    const active = () => { if (disconnected) throw new MediaError('UPLOAD_CLOSED', 'Se ha abandonado el cambio de idioma.') }
    try {
      const { id, draftId } = params.data
      const draft = await readLanguageDraft(userId, id, draftId)
      if (draft.status === 'committed') return { generation: await prisma.generation.findFirst({ where: { id, property: { userId } }, include: { property: true } }) }
      const ids = body.data.uploadIds
      const attempts = await prisma.uploadAttempt.findMany({ where: { id: { in: ids }, userId, generationId: id, languageDraftId: draftId, status: 'pending', expiresAt: { gt: new Date() } }, orderBy: { kind: 'asc' } })
      const kinds = Object.keys(draft.data.mediaVersions).sort()
      if (new Set(ids).size !== ids.length || attempts.length !== ids.length || attempts.map(a => a.kind).sort().join(',') !== kinds.join(',')) throw new MediaError('INVALID_REQUEST', 'Deben estar preparados todos los materiales del anuncio, sin duplicados.')
      const files: { attempt: (typeof attempts)[number]; upload: MediaUpload }[] = []
      for (const attempt of attempts) {
        active()
        const bytes = await readExactly(attempt.storageKey, attempt.size)
        if (!bytes || bytes.length !== attempt.size) throw new MediaError('UPLOAD_MISSING', 'Falta un archivo o su subida no ha terminado. El anuncio no ha cambiado.')
        const meta = JSON.parse(attempt.metadata) as MediaUploadMeta
        if (meta.aiJobId) throw new MediaError('INVALID_REQUEST', 'Esta preparación solo admite material clásico.')
        files.push({ attempt, upload: { kind: attempt.kind as 'poster' | 'video', body: bytes, declaredType: attempt.contentType, sourceHash: meta.sourceHash, expectedVersion: meta.expectedVersion, variant: meta.variant, durationMs: meta.durationMs ?? null, photoIds: meta.photoIds, poster: meta.poster, audio: meta.audio, codecs: meta.codecs } })
      }
      active()
      const generation = await prisma.$transaction(async tx => {
        await lockUser(tx, userId)
        await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${draft.data.source.property.id} FOR UPDATE`
        await tx.$queryRaw`SELECT "id" FROM "Generation" WHERE "id" = ${id} FOR UPDATE`
        await tx.$queryRaw`SELECT "id" FROM "GenerationLanguageDraft" WHERE "id" = ${draftId} FOR UPDATE`
        const fresh = await readLanguageDraft(userId, id, draftId, tx)
        if (fresh.status === 'committed') return tx.generation.findUniqueOrThrow({ where: { id }, include: { property: true } })
        await assertDraftSnapshot(userId, id, fresh.data, tx)
        const claimed = await tx.uploadAttempt.updateMany({ where: { id: { in: ids }, userId, languageDraftId: draftId, status: 'pending', expiresAt: { gt: new Date() } }, data: { status: 'processing', expiresAt: new Date(Date.now() + LANGUAGE_DRAFT_TTL_MS) } })
        if (claimed.count !== ids.length) throw new MediaError('UPLOAD_EXPIRED', 'Una subida se canceló o caducó. El anuncio no ha cambiado.')
        if (files.length) {
          const old = await tx.listingMedia.aggregate({ where: { generationId: id }, _sum: { size: true } })
          // All new bytes are already included in upload reservations. Count them once for the batch.
          await assertUserQuota(tx, userId, 0, old._sum.size ?? 0)
        }
        active()
        const updated = await tx.generation.update({ where: { id }, data: { ...fresh.data.listing, highlights: JSON.stringify(fresh.data.listing.highlights), language: fresh.data.language }, include: { property: true } })
        for (const file of files) {
          active()
          await saveMedia(request.log, userId, id, file.upload, { key: file.attempt.storageKey, attemptId: file.attempt.id }, tx)
        }
        active()
        await tx.generationLanguageDraft.update({ where: { id: draftId }, data: { status: 'committed' } })
        return updated
      }, { timeout: 15_000 })
      backgroundCleanup(reply)
      return { generation }
    } catch (error) { return errorReply(reply, error) }
  })

  app.delete('/api/generations/:id/language/:draftId', { preHandler: requireAuth }, async (request, reply) => {
    const params = DraftParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Preparación no válida.' })
    const userId = request.userId
    if (!userId) return reply.code(401).send({ message: 'Se requiere una sesión activa.' })
    try {
      const { id, draftId } = params.data
      const status = await prisma.$transaction(async tx => {
        await lockUser(tx, userId)
        const draft = await tx.generationLanguageDraft.findFirst({ where: { id: draftId, generationId: id, userId, generation: { property: { userId } } } })
        if (!draft) throw notFound('La preparación')
        if (draft.status !== 'pending') return draft.status
        await tx.generationLanguageDraft.update({ where: { id: draftId }, data: { status: 'cancelled' } })
        await tx.uploadAttempt.updateMany({ where: { languageDraftId: draftId, userId, status: 'pending' }, data: { status: 'cancelled' } })
        return 'cancelled'
      })
      if (status === 'committed') return reply.code(409).send({ message: 'El cambio ya se ha guardado. Recarga el anuncio.', code: 'ALREADY_COMMITTED' })
      backgroundCleanup(reply)
      return reply.code(204).send()
    } catch (error) { return errorReply(reply, error) }
  })
}
