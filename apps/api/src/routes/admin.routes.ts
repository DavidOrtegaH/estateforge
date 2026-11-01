import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { requireOwner } from '../middleware/owner.middleware.js'
import { buildAuditMetadata, resolveAuditAccounts } from '../services/admin-audit.service.js'

const UserIdParams = z.object({ id: z.string().trim().min(1).max(128) })
const ActionReasonBody = z.object({ reason: z.string().trim().min(3).max(500) })

// Los parámetros de consulta inválidos vuelven al valor por defecto en lugar de dar 400.
function pageQuery(max: number) {
  return z.string().catch('1').transform(value => Math.max(1, Math.min(max, Number.parseInt(value, 10) || 1)))
}
const UsersQuery = z.object({
  search: z.string().catch('').transform(value => value.trim().slice(0, 120)),
  page: pageQuery(10000),
})
const AuditQuery = z.object({ page: pageQuery(100000) })

// Límite para las acciones que modifican cuentas; las consultas no lo tienen.
const ACCOUNT_ACTION_RATE_LIMIT = { max: 20, timeWindow: '1 minute' }

function validParams(value: unknown) {
  return UserIdParams.safeParse(value)
}

// Email del operador para la instantánea de auditoría; null si ya no existe.
async function actorEmail(actorUserId: string) {
  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { email: true } })
  return actor?.email ?? null
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
    const { search, page } = UsersQuery.parse(request.query)
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
    const { page } = AuditQuery.parse(request.query)
    const pageSize = 10
    const [total, logs] = await Promise.all([
      prisma.adminAuditLog.count(),
      prisma.adminAuditLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, actorUserId: true, targetUserId: true, action: true, reason: true, metadata: true, createdAt: true },
      }),
    ])
    // Una sola consulta para el email actual de todas las cuentas de la página.
    const ids = [...new Set(logs.flatMap(log => log.targetUserId === null ? [log.actorUserId] : [log.actorUserId, log.targetUserId]))]
    const accounts = ids.length > 0
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })
      : []
    const emailsById = new Map(accounts.map(account => [account.id, account.email]))
    return { logs: resolveAuditAccounts(logs, emailsById), pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } }
  })

  app.post('/api/admin/users/:id/suspend', { preHandler: requireOwner, config: { rateLimit: ACCOUNT_ACTION_RATE_LIMIT } }, async (request, reply) => {
    const params = validParams(request.params)
    const body = ActionReasonBody.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    if (!body.success) return reply.code(400).send({ message: 'Indica un motivo de entre 3 y 500 caracteres.' })
    const actorUserId = request.userId
    if (!actorUserId || actorUserId === params.data.id) return reply.code(400).send({ message: 'No puedes suspender tu propia cuenta.' })
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, email: true, role: true, adminSuspendedAt: true } })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden suspender cuentas propietarias.' })
    if (target.adminSuspendedAt) return reply.code(409).send({ message: 'La cuenta ya está suspendida administrativamente.' })
    const metadata = buildAuditMetadata({ actorEmail: await actorEmail(actorUserId), targetEmail: target.email })
    const now = new Date()
    // La condición forma parte de la escritura: si otra petición suspendió la cuenta
    // después de la comprobación anterior, no se escribe nada y se responde 409.
    const suspended = await prisma.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: target.id, adminSuspendedAt: null },
        data: { adminSuspendedAt: now, adminSuspensionReason: body.data.reason },
      })
      if (updated.count !== 1) return false
      await tx.session.deleteMany({ where: { userId: target.id } })
      await tx.passwordResetToken.deleteMany({ where: { userId: target.id } })
      await tx.emailChangeVerification.deleteMany({ where: { userId: target.id, usedAt: null } })
      await tx.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'ACCOUNT_SUSPENDED', reason: body.data.reason, metadata } })
      return true
    })
    if (!suspended) return reply.code(409).send({ message: 'La cuenta ya está suspendida administrativamente.' })
    return { success: true, message: 'Cuenta suspendida y sesiones cerradas.' }
  })

  app.post('/api/admin/users/:id/unsuspend', { preHandler: requireOwner, config: { rateLimit: ACCOUNT_ACTION_RATE_LIMIT } }, async (request, reply) => {
    const params = validParams(request.params)
    const body = ActionReasonBody.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    if (!body.success) return reply.code(400).send({ message: 'Indica un motivo de entre 3 y 500 caracteres.' })
    const actorUserId = request.userId
    if (!actorUserId || actorUserId === params.data.id) return reply.code(400).send({ message: 'No puedes modificar tu propia cuenta desde esta acción.' })
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, email: true, role: true, adminSuspendedAt: true } })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden modificar cuentas propietarias.' })
    if (!target.adminSuspendedAt) return reply.code(409).send({ message: 'La cuenta no tiene una suspensión administrativa activa.' })
    const metadata = buildAuditMetadata({ actorEmail: await actorEmail(actorUserId), targetEmail: target.email })
    const unsuspended = await prisma.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: target.id, adminSuspendedAt: { not: null } },
        data: { adminSuspendedAt: null, adminSuspensionReason: null },
      })
      if (updated.count !== 1) return false
      await tx.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'ACCOUNT_UNSUSPENDED', reason: body.data.reason, metadata } })
      return true
    })
    if (!unsuspended) return reply.code(409).send({ message: 'La cuenta no tiene una suspensión administrativa activa.' })
    return { success: true, message: 'Suspensión administrativa retirada. Si existe una protección por incidente, seguirá activa.' }
  })

  app.post('/api/admin/users/:id/revoke-sessions', { preHandler: requireOwner, config: { rateLimit: ACCOUNT_ACTION_RATE_LIMIT } }, async (request, reply) => {
    const params = validParams(request.params)
    const body = ActionReasonBody.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    if (!body.success) return reply.code(400).send({ message: 'Indica un motivo de entre 3 y 500 caracteres.' })
    const actorUserId = request.userId
    if (!actorUserId || actorUserId === params.data.id) return reply.code(400).send({ message: 'No puedes cerrar tus propias sesiones desde esta acción.' })
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, email: true, role: true } })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden cerrar sesiones de otra cuenta propietaria desde este panel.' })
    const emails = { actorEmail: await actorEmail(actorUserId), targetEmail: target.email }
    const result = await prisma.$transaction(async tx => {
      const deleted = await tx.session.deleteMany({ where: { userId: target.id } })
      await tx.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'SESSIONS_REVOKED', reason: body.data.reason, metadata: buildAuditMetadata({ revokedCount: deleted.count, ...emails }) } })
      return deleted.count
    })
    return { success: true, revokedCount: result, message: `Se han cerrado ${result} sesiones.` }
  })
}
