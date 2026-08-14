import type { FastifyInstance } from 'fastify'
import type { GenerationRequest } from '@estateforge/shared'
import { generateListing } from '../services/generation.service.js'
import { prisma } from '../db/prisma.js'

export async function generationRoutes(
  app: FastifyInstance,
) {
  // Crear una nueva generación
  app.post('/api/generations', async (request) => {
    const body = request.body as GenerationRequest

    const listing = await generateListing(body)

    return {
      listing,
    }
  })

  // Obtener todas las generaciones
  app.get('/api/generations', async () => {
    const generations = await prisma.generation.findMany({
      include: {
        property: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return generations
  })

  // Obtener una generación concreta
  app.get('/api/generations/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const generation = await prisma.generation.findUnique({
      where: {
        id,
      },
      include: {
        property: true,
      },
    })

    if (!generation) {
      return reply.code(404).send({
        message: 'Generation not found',
      })
    }

    return generation
  })
}