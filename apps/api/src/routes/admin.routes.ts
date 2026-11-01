import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { requireOwner } from '../middleware/owner.middleware.js'

const UserIdParams = z.object({ id: z.string().trim().min(1).max(128) })
const ActionReasonBody = z.object({ reason: z.string().trim().min(3).max(500) })

function validParams(value: unknown) {
  return UserIdParams.safeParse(value)
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/overview', { preHandler: requireOwner }, async () => {
    const [users, properties, generations, blockedUsers, suspendedUsers] = await Promise.all([
      prisma.user.count(),
      prisma.property.count(),
      prisma.generation.count(),
      prisma.user.count({ where: { securityHoldAt: { not: null } } }),
      prisma.user.count({ where: { adminSuspendedAt: { not: null } } }),
    ])
    return { users, properties, generations, blockedUsers, suspendedUsers }
  })

  app.get('/api/admin/users', { preHandler: requireOwner }, async (request) => {
    const query = request.query as { search?: string; page?: string }
    const search = typeof query.search === 'string' ? query.search.trim().slice(0, 120) : ''
    const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? '1', 10) || 1))
    const pageSize = 20
    const where = search ? { email: { contains: search } } : {}
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true, email: true, role: true, createdAt: true,
          securityHoldAt: true, adminSuspendedAt: true, adminSuspensionReason: true,
          _count: { select: { properties: true } },
        },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
    ])
    return {
      users: users.map(user => ({
        id: user.id, email: user.email, role: user.role, createdAt: user.createdAt,
        securityHoldAt: user.securityHoldAt, adminSuspendedAt: user.adminSuspendedAt,
        adminSuspensionReason: user.adminSuspensionReason, properties: user._count.properties,
      })),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    }
  })

  app.get('/api/admin/users/:id', { preHandler: requireOwner }, async (request, reply) => {
    const params = validParams(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    const user = await prisma.user.findUnique({
      where: { id: params.data.id },
      select: {
        id: true, email: true, role: true, createdAt: true,
        securityHoldAt: true, adminSuspendedAt: true, adminSuspensionReason: true,
        _count: { select: { properties: true, sessions: true } },
      },
    })
    if (!user) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    return {
      id: user.id, email: user.email, role: user.role, createdAt: user.createdAt,
      securityHoldAt: user.securityHoldAt, adminSuspendedAt: user.adminSuspendedAt,
      adminSuspensionReason: user.adminSuspensionReason,
      properties: user._count.properties, activeSessions: user._count.sessions,
    }
  })

  app.get('/api/admin/audit', { preHandler: requireOwner }, async (request) => {
    const query = request.query as { page?: string }
    const pageSize = 10
    const page = Math.max(1, Math.min(100000, Number.parseInt(query.page ?? '1', 10) || 1))
    const [total, logs] = await Promise.all([
      prisma.adminAuditLog.count(),
      prisma.adminAuditLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, actorUserId: true, targetUserId: true, action: true, reason: true, createdAt: true },
      }),
    ])
    return { logs, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } }
  })

  app.post('/api/admin/users/:id/suspend', { preHandler: requireOwner }, async (request, reply) => {
    const params = validParams(request.params)
    const body = ActionReasonBody.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    if (!body.success) return reply.code(400).send({ message: 'Indica un motivo de entre 3 y 500 caracteres.' })
    const actorUserId = request.userId
    if (!actorUserId || actorUserId === params.data.id) return reply.code(400).send({ message: 'No puedes suspender tu propia cuenta.' })
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, role: true, adminSuspendedAt: true } })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden suspender cuentas propietarias.' })
    if (target.adminSuspendedAt) return reply.code(409).send({ message: 'La cuenta ya está suspendida administrativamente.' })
    const now = new Date()
    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { adminSuspendedAt: now, adminSuspensionReason: body.data.reason } }),
      prisma.session.deleteMany({ where: { userId: target.id } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: target.id } }),
      prisma.emailChangeVerification.deleteMany({ where: { userId: target.id, usedAt: null } }),
      prisma.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'ACCOUNT_SUSPENDED', reason: body.data.reason } }),
    ])
    return { success: true, message: 'Cuenta suspendida y sesiones cerradas.' }
  })

  app.post('/api/admin/users/:id/unsuspend', { preHandler: requireOwner }, async (request, reply) => {
    const params = validParams(request.params)
    const body = ActionReasonBody.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    if (!body.success) return reply.code(400).send({ message: 'Indica un motivo de entre 3 y 500 caracteres.' })
    const actorUserId = request.userId
    if (!actorUserId || actorUserId === params.data.id) return reply.code(400).send({ message: 'No puedes modificar tu propia cuenta desde esta acción.' })
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, role: true, adminSuspendedAt: true } })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden modificar cuentas propietarias.' })
    if (!target.adminSuspendedAt) return reply.code(409).send({ message: 'La cuenta no tiene una suspensión administrativa activa.' })
    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { adminSuspendedAt: null, adminSuspensionReason: null } }),
      prisma.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'ACCOUNT_UNSUSPENDED', reason: body.data.reason } }),
    ])
    return { success: true, message: 'Suspensión administrativa retirada. Si existe una protección por incidente, seguirá activa.' }
  })

  app.post('/api/admin/users/:id/revoke-sessions', { preHandler: requireOwner }, async (request, reply) => {
    const params = validParams(request.params)
    const body = ActionReasonBody.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    if (!body.success) return reply.code(400).send({ message: 'Indica un motivo de entre 3 y 500 caracteres.' })
    const actorUserId = request.userId
    if (!actorUserId || actorUserId === params.data.id) return reply.code(400).send({ message: 'No puedes cerrar tus propias sesiones desde esta acción.' })
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, role: true } })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden cerrar sesiones de otra cuenta propietaria desde este panel.' })
    const result = await prisma.$transaction(async tx => {
      const deleted = await tx.session.deleteMany({ where: { userId: target.id } })
      await tx.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'SESSIONS_REVOKED', reason: body.data.reason, metadata: JSON.stringify({ revokedCount: deleted.count }) } })
      return deleted.count
    })
    return { success: true, revokedCount: result, message: `Se han cerrado ${result} sesiones.` }
  })
}
