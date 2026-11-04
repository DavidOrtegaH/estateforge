import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { requireOwner } from '../middleware/owner.middleware.js'
import { buildAuditMetadata, resolveAuditAccounts, type RecoveryDestinationSource } from '../services/admin-audit.service.js'
import { normalizeEmail } from '../services/email-change.service.js'
import { newRecoveryToken, sendRecoveryLink } from '../services/security-recovery.service.js'

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
const AUDIT_ACTIONS = [
  'ACCOUNT_SUSPENDED', 'ACCOUNT_UNSUSPENDED', 'SESSIONS_REVOKED', 'SECURITY_HOLD_RESOLVED', 'SECURITY_RECOVERY_COMPLETED',
  'SECURITY_RECOVERY_DESTINATION_CHANGED', 'SECURITY_RECOVERY_LINK_RESENT', 'SECURITY_RECOVERY_LINK_REQUESTED',
] as const
// Un filtro inválido o repetido no filtra, igual que page y search.
const AuditQuery = z.object({
  page: pageQuery(100000),
  action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
  targetUserId: z.string().trim().min(1).max(128).optional().catch(undefined),
})

// La protección por incidente y la suspensión administrativa son estados independientes:
// una cuenta protegida no se suspende, se resuelve primero su protección.
const HELD_SUSPEND_MESSAGE = 'La cuenta está protegida por un incidente de seguridad; no se puede suspender administrativamente.'

const RecoveryEmail = z.string().trim().email().max(254)
// recoveryEmail es opcional: sin él se usa el destino guardado al informar del incidente.
const ResolveHoldBody = ActionReasonBody.extend({ recoveryEmail: RecoveryEmail.optional() })
// Corrección del destino (E2.5f): aquí recoveryEmail es obligatorio.
const RecoveryDestinationBody = ActionReasonBody.extend({ recoveryEmail: RecoveryEmail })
const MISSING_RECOVERY_EMAIL_MESSAGE = 'La cuenta no tiene un destino de recuperación guardado. Indica el email al que enviar el enlace de recuperación obligatoria.'
const RECOVERY_EMAIL_SENT_MESSAGE = 'Protección por incidente retirada. Se ha enviado el enlace de recuperación obligatoria; la cuenta no podrá acceder hasta establecer una contraseña nueva. Si existe una suspensión administrativa, seguirá activa.'
const RECOVERY_EMAIL_FAILED_MESSAGE = 'Protección por incidente retirada y recuperación obligatoria activada, pero no se pudo enviar el enlace. La cuenta sigue sin acceso hasta establecer una contraseña nueva.'
// Gestión de una recuperación pendiente por un OWNER (E2.5f).
const RECOVERY_NOT_REQUIRED_MESSAGE = 'La cuenta no tiene una recuperación obligatoria pendiente.'
const RECOVERY_HELD_MESSAGE = 'La cuenta tiene una protección por incidente activa. Retírala primero; la retirada envía un enlace nuevo.'
const RECOVERY_SUSPENDED_MESSAGE = 'La cuenta está suspendida administrativamente. Retira la suspensión antes de gestionar su recuperación.'
const RECOVERY_CHANGED_MESSAGE = 'La recuperación de la cuenta ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.'
const DESTINATION_TAKEN_MESSAGE = 'Ese email pertenece a otra cuenta.'
const STORED_DESTINATION_TAKEN_MESSAGE = 'El destino de recuperación guardado pertenece a otra cuenta. Corrige el destino antes de reenviar.'
const NO_STORED_DESTINATION_MESSAGE = 'La cuenta no tiene un destino de recuperación guardado. Corrige el destino antes de reenviar.'
const DESTINATION_UNCHANGED_MESSAGE = 'El destino indicado ya es el destino de recuperación de la cuenta. No se ha enviado ningún enlace; usa el reenvío si necesitas uno nuevo.'
const DESTINATION_CHANGED_SENT_MESSAGE = 'Destino de recuperación actualizado. Se ha enviado un enlace nuevo; los enlaces anteriores ya no son válidos.'
const DESTINATION_CHANGED_FAILED_MESSAGE = 'Destino de recuperación actualizado, pero no se pudo enviar el enlace nuevo. Los enlaces anteriores ya no son válidos; puedes reenviarlo.'
const LINK_RESENT_MESSAGE = 'Se ha enviado un enlace de recuperación nuevo; los enlaces anteriores ya no son válidos.'
const LINK_RESEND_FAILED_MESSAGE = 'No se pudo enviar el enlace de recuperación. Los enlaces anteriores ya no son válidos; vuelve a intentarlo más tarde.'

type RecoveryState = {
  passwordResetRequiredAt: Date | null
  securityHoldAt: Date | null
  adminSuspendedAt: Date | null
}

// Por qué una cuenta no admite gestionar su recuperación; null si la admite.
// Primero la protección: la acción útil en ese caso es la retirada.
function recoveryStateConflict(state: RecoveryState): string | null {
  if (state.securityHoldAt) return RECOVERY_HELD_MESSAGE
  if (state.adminSuspendedAt) return RECOVERY_SUSPENDED_MESSAGE
  if (!state.passwordResetRequiredAt) return RECOVERY_NOT_REQUIRED_MESSAGE
  return null
}

// Tras una escritura condicional fallida, relee la cuenta dentro de la transacción solo para
// elegir el mensaje del 409; si su estado sigue admitiéndola, cambió otra cosa (destino o versión).
async function recoveryConflictAfterRead(tx: Pick<typeof prisma, 'user'>, userId: string): Promise<string> {
  const current = await tx.user.findUnique({
    where: { id: userId },
    select: { passwordResetRequiredAt: true, securityHoldAt: true, adminSuspendedAt: true },
  })
  return (current && recoveryStateConflict(current)) ?? RECOVERY_CHANGED_MESSAGE
}

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
    // Las sesiones caducadas solo se borran al volver a usarse; no cuentan como activas.
    const now = new Date()
    const user = await prisma.user.findUnique({
      where: { id: params.data.id },
      select: {
        id: true, email: true, role: true, createdAt: true,
        securityHoldAt: true, adminSuspendedAt: true, adminSuspensionReason: true,
        _count: { select: { properties: true, sessions: { where: { expiresAt: { gt: now } } } } },
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
    const { page, action, targetUserId } = AuditQuery.parse(request.query)
    const pageSize = 10
    // El mismo filtro para el total y para la página, para que la paginación sea coherente.
    const where = {
      ...(action !== undefined && { action }),
      ...(targetUserId !== undefined && { targetUserId }),
    }
    const [total, logs] = await Promise.all([
      prisma.adminAuditLog.count({ where }),
      prisma.adminAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, actorUserId: true, targetUserId: true, action: true, reason: true, metadata: true, createdAt: true },
      }),
    ])
    // Una sola consulta para el email actual de todas las cuentas de la página. El actor puede
    // faltar (acción no autenticada) igual que la cuenta afectada: no se busca un id nulo.
    const ids = [...new Set(logs.flatMap(log => [log.actorUserId, log.targetUserId].filter((id): id is string => id !== null)))]
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
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, email: true, role: true, adminSuspendedAt: true, securityHoldAt: true } })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden suspender cuentas propietarias.' })
    if (target.adminSuspendedAt) return reply.code(409).send({ message: 'La cuenta ya está suspendida administrativamente.' })
    if (target.securityHoldAt) return reply.code(409).send({ message: HELD_SUSPEND_MESSAGE })
    const metadata = buildAuditMetadata({ actorEmail: await actorEmail(actorUserId), targetEmail: target.email })
    const now = new Date()
    // La condición forma parte de la escritura: si otra petición suspendió o protegió
    // la cuenta después de la comprobación anterior, no se escribe nada y se responde 409.
    const outcome = await prisma.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: target.id, adminSuspendedAt: null, securityHoldAt: null },
        data: { adminSuspendedAt: now, adminSuspensionReason: body.data.reason },
      })
      if (updated.count !== 1) {
        const current = await tx.user.findUnique({ where: { id: target.id }, select: { securityHoldAt: true } })
        return current?.securityHoldAt ? 'held' : 'already-suspended'
      }
      await tx.session.deleteMany({ where: { userId: target.id } })
      await tx.passwordResetToken.deleteMany({ where: { userId: target.id } })
      await tx.emailChangeVerification.deleteMany({ where: { userId: target.id, usedAt: null } })
      await tx.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'ACCOUNT_SUSPENDED', reason: body.data.reason, metadata } })
      return 'suspended'
    })
    if (outcome === 'held') return reply.code(409).send({ message: HELD_SUSPEND_MESSAGE })
    if (outcome === 'already-suspended') return reply.code(409).send({ message: 'La cuenta ya está suspendida administrativamente.' })
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

  // Retira la protección por incidente y deja la cuenta en recuperación obligatoria (E2.4):
  // no toca la suspensión, las sesiones, la contraseña ni User.email.
  app.post('/api/admin/users/:id/resolve-security-hold', { preHandler: requireOwner, config: { rateLimit: ACCOUNT_ACTION_RATE_LIMIT } }, async (request, reply) => {
    const params = validParams(request.params)
    const body = ResolveHoldBody.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    if (!body.success) {
      const invalidEmail = body.error.issues.some(issue => issue.path[0] === 'recoveryEmail')
      return reply.code(400).send({ message: invalidEmail ? 'El email de recuperación no es válido.' : 'Indica un motivo de entre 3 y 500 caracteres.' })
    }
    const actorUserId = request.userId
    if (!actorUserId || actorUserId === params.data.id) return reply.code(400).send({ message: 'No puedes modificar tu propia cuenta desde esta acción.' })
    const target = await prisma.user.findUnique({
      where: { id: params.data.id },
      select: { id: true, email: true, role: true, securityHoldAt: true, securityHoldVersion: true, securityRecoveryEmail: true },
    })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden modificar cuentas propietarias.' })
    if (!target.securityHoldAt) return reply.code(409).send({ message: 'La cuenta no tiene una protección por incidente activa.' })

    // El destino nunca es User.email por defecto: el guardado del incidente o el que indique el OWNER.
    const provided = body.data.recoveryEmail === undefined ? null : normalizeEmail(body.data.recoveryEmail)
    const destination = provided ?? target.securityRecoveryEmail
    if (!destination) return reply.code(400).send({ message: MISSING_RECOVERY_EMAIL_MESSAGE })
    const destinationSource: RecoveryDestinationSource =
      provided === null || provided === target.securityRecoveryEmail ? 'STORED'
        : target.securityRecoveryEmail === null ? 'OWNER_PROVIDED' : 'OWNER_CORRECTED'

    // Solo se retira la protección comprobada: cada incidente nuevo incrementa la versión,
    // así que si cambia antes de escribir no se toca nada y se responde 409. El destino
    // guardado solo cambia con un incidente nuevo, de modo que la misma condición lo cubre.
    const heldVersion = target.securityHoldVersion
    const metadata = buildAuditMetadata({ actorEmail: await actorEmail(actorUserId), targetEmail: target.email, recoveryDestination: destinationSource })
    const recovery = newRecoveryToken(target.id, destination, heldVersion)
    const now = new Date()
    const outcome = await prisma.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: target.id, securityHoldAt: { not: null }, securityHoldVersion: heldVersion },
        data: { securityHoldAt: null, passwordResetRequiredAt: now, securityRecoveryEmail: destination },
      })
      if (updated.count !== 1) {
        const current = await tx.user.findUnique({ where: { id: target.id }, select: { securityHoldAt: true } })
        return current?.securityHoldAt ? 'hold-changed' : 'not-held'
      }
      // El único enlace válido tras la retirada es el obligatorio de esta versión: los
      // pendientes, de cualquier tipo, irían a destinos o incidentes ya superados.
      await tx.passwordResetToken.deleteMany({ where: { userId: target.id, usedAt: null } })
      await tx.passwordResetToken.create({ data: recovery.data })
      await tx.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'SECURITY_HOLD_RESOLVED', reason: body.data.reason, metadata } })
      return 'resolved'
    })
    if (outcome === 'hold-changed') return reply.code(409).send({ message: 'La protección por incidente ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.' })
    if (outcome === 'not-held') return reply.code(409).send({ message: 'La cuenta no tiene una protección por incidente activa.' })

    // Después del commit. Si el envío falla, la obligación y el token se mantienen: la
    // cuenta sigue sin acceso y no se compensa reactivando la protección.
    const sent = await sendRecoveryLink(request.log, target.id, { ...recovery, to: destination })
    return sent
      ? { success: true, recoveryEmailSent: true, message: RECOVERY_EMAIL_SENT_MESSAGE }
      : { success: true, recoveryEmailSent: false, message: RECOVERY_EMAIL_FAILED_MESSAGE }
  })

  // Corrige el destino de una recuperación pendiente y envía un enlace nuevo (E2.5f). No toca
  // la protección, la suspensión, la versión, la contraseña ni User.email.
  app.post('/api/admin/users/:id/recovery-destination', { preHandler: requireOwner, config: { rateLimit: ACCOUNT_ACTION_RATE_LIMIT } }, async (request, reply) => {
    const params = validParams(request.params)
    const body = RecoveryDestinationBody.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    if (!body.success) {
      const invalidReason = body.error.issues.some(issue => issue.path[0] === 'reason') || body.error.issues.every(issue => issue.path.length === 0)
      return reply.code(400).send({ message: invalidReason ? 'Indica un motivo de entre 3 y 500 caracteres.' : 'El email de recuperación no es válido.' })
    }
    const actorUserId = request.userId
    if (!actorUserId || actorUserId === params.data.id) return reply.code(400).send({ message: 'No puedes modificar tu propia cuenta desde esta acción.' })
    const target = await prisma.user.findUnique({
      where: { id: params.data.id },
      select: {
        id: true, email: true, role: true, securityHoldAt: true, adminSuspendedAt: true,
        passwordResetRequiredAt: true, securityHoldVersion: true, securityRecoveryEmail: true,
      },
    })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden modificar cuentas propietarias.' })
    const conflict = recoveryStateConflict(target)
    if (conflict) return reply.code(409).send({ message: conflict })

    const destination = normalizeEmail(body.data.recoveryEmail)
    const previous = target.securityRecoveryEmail
    // Idempotente: el mismo destino no emite token, no envía correo y no se audita.
    if (destination === previous) return { success: true, changed: false, recoveryEmailSent: false, message: DESTINATION_UNCHANGED_MESSAGE }

    const version = target.securityHoldVersion
    const recovery = newRecoveryToken(target.id, destination, version)
    const metadata = buildAuditMetadata({
      actorEmail: await actorEmail(actorUserId),
      targetEmail: target.email,
      recoveryDestination: previous === null ? 'OWNER_PROVIDED' : 'OWNER_CORRECTED',
    })
    const outcome = await prisma.$transaction(async tx => {
      // El destino puede compartirse como securityRecoveryEmail, pero no ser el email de otra cuenta.
      const holder = await tx.user.findUnique({ where: { email: destination }, select: { id: true } })
      if (holder && holder.id !== target.id) return { error: DESTINATION_TAKEN_MESSAGE }
      // Solo se cambia el destino del estado comprobado: si la cuenta cambió desde la lectura
      // (consumo, incidente, suspensión u otra corrección), no se escribe nada.
      const updated = await tx.user.updateMany({
        where: {
          id: target.id, passwordResetRequiredAt: { not: null }, securityHoldAt: null, adminSuspendedAt: null,
          securityHoldVersion: version, securityRecoveryEmail: previous,
        },
        data: { securityRecoveryEmail: destination },
      })
      if (updated.count !== 1) return { error: await recoveryConflictAfterRead(tx, target.id) }
      // Los enlaces anteriores, incluidos los enviados al destino viejo, dejan de servir.
      await tx.passwordResetToken.deleteMany({ where: { userId: target.id, usedAt: null, purpose: 'SECURITY_RECOVERY' } })
      await tx.passwordResetToken.create({ data: recovery.data })
      await tx.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'SECURITY_RECOVERY_DESTINATION_CHANGED', reason: body.data.reason, metadata } })
      return { error: null }
    })
    if (outcome.error) return reply.code(409).send({ message: outcome.error })

    const sent = await sendRecoveryLink(request.log, target.id, { ...recovery, to: destination })
    return { success: true, changed: true, recoveryEmailSent: sent, message: sent ? DESTINATION_CHANGED_SENT_MESSAGE : DESTINATION_CHANGED_FAILED_MESSAGE }
  })

  // Reenvía el enlace de una recuperación pendiente al destino guardado (E2.5f). No cambia el
  // destino, la protección, la suspensión, la versión, la contraseña ni User.email.
  app.post('/api/admin/users/:id/resend-recovery', { preHandler: requireOwner, config: { rateLimit: ACCOUNT_ACTION_RATE_LIMIT } }, async (request, reply) => {
    const params = validParams(request.params)
    const body = ActionReasonBody.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ message: 'Identificador de cuenta no válido.' })
    if (!body.success) return reply.code(400).send({ message: 'Indica un motivo de entre 3 y 500 caracteres.' })
    const actorUserId = request.userId
    if (!actorUserId || actorUserId === params.data.id) return reply.code(400).send({ message: 'No puedes modificar tu propia cuenta desde esta acción.' })
    const target = await prisma.user.findUnique({
      where: { id: params.data.id },
      select: {
        id: true, email: true, role: true, securityHoldAt: true, adminSuspendedAt: true,
        passwordResetRequiredAt: true, securityHoldVersion: true, securityRecoveryEmail: true,
      },
    })
    if (!target) return reply.code(404).send({ message: 'No se ha encontrado la cuenta.' })
    if (target.role === 'OWNER') return reply.code(403).send({ message: 'No se pueden modificar cuentas propietarias.' })
    const conflict = recoveryStateConflict(target)
    if (conflict) return reply.code(409).send({ message: conflict })
    // Nunca se recurre a User.email: sin destino guardado hay que corregirlo primero.
    const destination = target.securityRecoveryEmail
    if (!destination) return reply.code(400).send({ message: NO_STORED_DESTINATION_MESSAGE })

    const version = target.securityHoldVersion
    const recovery = newRecoveryToken(target.id, destination, version)
    const metadata = buildAuditMetadata({ actorEmail: await actorEmail(actorUserId), targetEmail: target.email })
    const outcome = await prisma.$transaction(async tx => {
      const holder = await tx.user.findUnique({ where: { email: destination }, select: { id: true } })
      if (holder && holder.id !== target.id) return { error: STORED_DESTINATION_TAKEN_MESSAGE }
      // Escritura condicional sin cambios de valor: confirma, dentro de la transacción, que la
      // cuenta sigue en el estado leído antes de sustituir el enlace.
      const updated = await tx.user.updateMany({
        where: {
          id: target.id, passwordResetRequiredAt: { not: null }, securityHoldAt: null, adminSuspendedAt: null,
          securityHoldVersion: version, securityRecoveryEmail: destination,
        },
        data: { securityRecoveryEmail: destination },
      })
      if (updated.count !== 1) return { error: await recoveryConflictAfterRead(tx, target.id) }
      await tx.passwordResetToken.deleteMany({ where: { userId: target.id, usedAt: null, purpose: 'SECURITY_RECOVERY' } })
      await tx.passwordResetToken.create({ data: recovery.data })
      await tx.adminAuditLog.create({ data: { actorUserId, targetUserId: target.id, action: 'SECURITY_RECOVERY_LINK_RESENT', reason: body.data.reason, metadata } })
      return { error: null }
    })
    if (outcome.error) return reply.code(409).send({ message: outcome.error })

    const sent = await sendRecoveryLink(request.log, target.id, { ...recovery, to: destination })
    return { success: true, recoveryEmailSent: sent, message: sent ? LINK_RESENT_MESSAGE : LINK_RESEND_FAILED_MESSAGE }
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
