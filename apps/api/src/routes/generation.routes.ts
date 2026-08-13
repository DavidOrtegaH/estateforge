import type { FastifyInstance } from 'fastify'
import type { GenerationRequest } from '@estateforge/shared'
import { generateListing } from '../services/generation.service.js'

export async function generationRoutes(
  app: FastifyInstance,
) {
  app.post('/api/generations', async (request) => {
    const body = request.body as GenerationRequest

    const listing = await generateListing(body)

    return {
      listing,
    }
  })
}