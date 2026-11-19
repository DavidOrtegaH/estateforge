import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AI_TEXT_GENERATION_PROVIDERS, IdParamsSchema, ListingLanguageSchema, listingLanguageOf, type AIProviderType, type ListingTone } from '@estateforge/shared'
import { prisma } from '../db/prisma.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import { lockUser } from '../media/quota.js'
import { generateWithUserKey, generationNotices, toSharedProperty } from '../services/generation.service.js'
import { buildListingPrompt } from '../services/prompt.service.js'
import { validateGeneratedListing } from '../services/listing-validator.service.js'
import { AIProviderError } from '../ai/ai-provider.error.js'

const Change = z.object({ language: ListingLanguageSchema, confirmed: z.literal(true), expectedUpdatedAt: z.iso.datetime() }).strict()

export function registerGenerationLanguageRoutes(app: FastifyInstance) {
  app.post('/api/generations/:id/language', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params)
    const body = Change.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Confirma la sustitución del contenido y el idioma elegido.' })
    const userId = request.userId
    if (!userId) return reply.code(401).send({ message: 'Se requiere una sesión activa.' })
    const existing = await prisma.generation.findFirst({ where: { id: params.data.id, property: { userId } }, include: { property: true } })
    if (!existing) return reply.code(404).send({ message: 'Anuncio no encontrado.' })
    const conflict = () => reply.code(409).send({ message: 'El anuncio o el inmueble ha cambiado. Recarga antes de cambiar su idioma.' })
    if (existing.updatedAt.toISOString() !== body.data.expectedUpdatedAt) return conflict()
    if (!(AI_TEXT_GENERATION_PROVIDERS as readonly string[]).includes(existing.provider)) return reply.code(409).send({ message: 'El proveedor original ya no está disponible. Genera un anuncio nuevo con un método disponible.' })
    const language = body.data.language
    const provider = existing.provider as AIProviderType
    const property = toSharedProperty(existing.property)
    try {
      // Una única operación de texto con el proveedor original. La confirmación de la interfaz
      // informa del consumo BYOK; ningún material se genera con IA de forma automática.
      const result = await generateWithUserKey(provider, buildListingPrompt({ property, provider, tone: existing.tone as ListingTone, language }), userId, { language })
      const listing = validateGeneratedListing(result, property)
      const changed = await prisma.$transaction(async tx => {
        await lockUser(tx, userId)
        await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${existing.propertyId} FOR UPDATE`
        await tx.$queryRaw`SELECT "id" FROM "Generation" WHERE "id" = ${existing.id} FOR UPDATE`
        const fresh = await tx.generation.findFirst({ where: { id: existing.id, property: { userId } }, include: { property: true } })
        if (!fresh || fresh.updatedAt.getTime() !== existing.updatedAt.getTime() || fresh.property.updatedAt.getTime() !== existing.property.updatedAt.getTime()) return null
        const media = await tx.listingMedia.findMany({ where: { generationId: existing.id }, orderBy: { kind: 'asc' }, select: { kind: true } })
        const generation = await tx.generation.update({ where: { id: existing.id }, data: { ...listing, highlights: JSON.stringify(listing.highlights), language: listingLanguageOf(language) }, include: { property: true } })
        return { generation, mediaKinds: media.map(item => item.kind) }
      })
      if (!changed) return conflict()
      return { ...changed, notices: generationNotices(provider, language, existing.property.additionalInformation) }
    } catch (error) {
      if (error instanceof AIProviderError) return reply.code(409).send({ message: error.message, code: error.code })
      throw error
    }
  })
}
