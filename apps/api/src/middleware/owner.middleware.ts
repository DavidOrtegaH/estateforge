import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../db/prisma.js'
import { requireAuth } from './auth.middleware.js'

/** Authentication + server-side owner authorization. Never trust client role state. */
export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply)
  if (reply.sent) return

  const userId = request.userId
  if (!userId) {
    reply.code(401).send({ message: 'Se requiere una sesión activa.' })
    return
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, securityHoldAt: true },
  })

  if (!user || user.securityHoldAt) {
    reply.code(403).send({ message: 'No tienes permisos para acceder a esta sección.' })
    return
  }

  if (user.role !== 'OWNER') {
    reply.code(403).send({ message: 'No tienes permisos para acceder a esta sección.' })
  }
}
