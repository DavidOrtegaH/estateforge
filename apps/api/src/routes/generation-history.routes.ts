import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'

export async function generationHistoryRoutes(
  app: FastifyInstance,
) {
  app.get('/api/generations', async () => {
    const generations = await prisma.generation.findMany({
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        property: true,
      },
    })

    return generations
  })
}