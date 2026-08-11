import type { FastifyInstance } from 'fastify'
import type { Property } from '@estateforge/shared'
import { generateListing } from '../services/generation.service.js'

export async function generationRoutes(
  app: FastifyInstance,
) {
  app.post('/api/generations', async (request) => {
    const body = request.body as {
      property: Property
    }

    const listing = await generateListing(body.property)

    return {
      listing,
    }
  })
}