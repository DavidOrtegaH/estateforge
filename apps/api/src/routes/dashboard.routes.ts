import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'

export async function dashboardRoutes(
  app: FastifyInstance,
) {
  app.get('/api/dashboard/stats', async () => {
    const [properties, generations] = await Promise.all([
      prisma.property.count(),
      prisma.generation.count(),
    ])

    return {
      properties,
      generations,
    }
  })
}