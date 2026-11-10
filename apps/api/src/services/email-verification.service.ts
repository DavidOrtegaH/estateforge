import { createHash, randomBytes } from 'node:crypto'

import { prisma } from '../db/prisma.js'
import { emailService } from './email.service.js'

// ==========================================================
// POLÍTICA DE ACCESO (Fase 0)
// ==========================================================
//
// Las cuentas se distinguen por su fecha de alta (User.createdAt), sin marcar nada en la base:
// - EMAIL_VERIFICATION_REQUIRED_FROM (fecha ISO 8601): las cuentas creadas desde esa fecha
//   deben verificar su email antes de usar la aplicación. Las anteriores son «existentes».
// - EMAIL_VERIFICATION_GRACE_UNTIL (fecha ISO 8601, opcional): hasta esa fecha las cuentas
//   existentes sin verificar pueden seguir entrando. Desde esa fecha se les exige igual que a
//   las nuevas. Sin esta variable, el periodo de gracia no tiene fin.
// Sin EMAIL_VERIFICATION_REQUIRED_FROM la verificación no se exige a nadie (como hasta ahora),
// aunque se siguen enviando los enlaces para que cualquiera pueda verificar su email.

export interface EmailVerificationPolicy {
  requiredFrom: Date | null
  graceUntil: Date | null
  tokenTtlMs: number
}

export type EmailAccess =
  // Email verificado.
  | 'VERIFIED'
  // La verificación no se exige todavía (sin EMAIL_VERIFICATION_REQUIRED_FROM).
  | 'NOT_ENFORCED'
  // Cuenta existente sin verificar, dentro del periodo de gracia.
  | 'GRACE'
  // Debe verificar el email antes de acceder.
  | 'REQUIRED'

const DEFAULT_TOKEN_TTL_HOURS = 24
const MAX_TOKEN_TTL_HOURS = 168

// Fecha y hora completas con zona horaria obligatoria (Z o ±hh:mm). Los grupos se validan
// después por rangos: el formato solo no basta, porque JavaScript normaliza fechas imposibles
// (por ejemplo, el 31 de febrero pasa a ser el 3 de marzo).
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/

function daysInMonth(year: number, month: number): number {
  // Día 0 del mes siguiente en UTC: el último del mes pedido (años bisiestos incluidos).
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parseDate(name: string, raw: string | undefined): Date | null {
  const value = raw?.trim()
  if (!value) return null
  const invalid = () => new Error(`${name} debe ser una fecha ISO 8601 válida con zona horaria (por ejemplo, 2026-12-01T00:00:00Z).`)
  const match = ISO_DATE_TIME.exec(value)
  if (!match) throw invalid()

  const [, y, mo, d, h, mi, s = '0', , sign, oh, om] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s)
  if (month < 1 || month > 12) throw invalid()
  if (day < 1 || day > daysInMonth(year, month)) throw invalid()
  if (hour > 23 || minute > 59 || second > 59) throw invalid()
  if (sign) {
    const offsetHours = Number(oh)
    const offsetMinutes = Number(om)
    // Desplazamientos reales: de −12:00 a +14:00, con minutos de 00 a 59.
    if (offsetMinutes > 59 || offsetHours > 14 || (sign === '-' && offsetHours > 12)) throw invalid()
    if (offsetHours === 14 && offsetMinutes > 0) throw invalid()
  }

  // Ya validados los campos, el instante lo calcula el propio motor (con su zona horaria).
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw invalid()
  return date
}

/** Lee y valida la política del entorno. Lanza un error si la configuración no es válida. */
export function readEmailVerificationPolicy(env: NodeJS.ProcessEnv = process.env): EmailVerificationPolicy {
  const requiredFrom = parseDate('EMAIL_VERIFICATION_REQUIRED_FROM', env.EMAIL_VERIFICATION_REQUIRED_FROM)
  const graceUntil = parseDate('EMAIL_VERIFICATION_GRACE_UNTIL', env.EMAIL_VERIFICATION_GRACE_UNTIL)
  if (graceUntil && !requiredFrom) {
    throw new Error('EMAIL_VERIFICATION_GRACE_UNTIL requiere EMAIL_VERIFICATION_REQUIRED_FROM.')
  }
  if (requiredFrom && graceUntil && graceUntil.getTime() < requiredFrom.getTime()) {
    throw new Error('EMAIL_VERIFICATION_GRACE_UNTIL no puede ser anterior a EMAIL_VERIFICATION_REQUIRED_FROM.')
  }
  const rawTtl = env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS?.trim()
  const ttlHours = rawTtl ? Number(rawTtl) : DEFAULT_TOKEN_TTL_HOURS
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > MAX_TOKEN_TTL_HOURS) {
    throw new Error(`EMAIL_VERIFICATION_TOKEN_TTL_HOURS debe ser un número entero de horas entre 1 y ${MAX_TOKEN_TTL_HOURS}.`)
  }
  return { requiredFrom, graceUntil, tokenTtlMs: ttlHours * 60 * 60 * 1000 }
}

/** Situación del email de una cuenta respecto a la política, en el instante `now`. */
export function emailAccess(
  user: { emailVerifiedAt: Date | null; createdAt: Date },
  policy: EmailVerificationPolicy,
  now: Date = new Date(),
): EmailAccess {
  if (user.emailVerifiedAt) return 'VERIFIED'
  if (!policy.requiredFrom) return 'NOT_ENFORCED'
  // Cuenta existente: creada antes de que se exigiera la verificación.
  if (user.createdAt.getTime() < policy.requiredFrom.getTime()) {
    if (policy.graceUntil && now.getTime() >= policy.graceUntil.getTime()) return 'REQUIRED'
    return 'GRACE'
  }
  return 'REQUIRED'
}

/** Si la cuenta puede usar la aplicación según la verificación de su email. */
export function emailAllowsAccess(access: EmailAccess): boolean {
  return access !== 'REQUIRED'
}

/** Comodidad para las comprobaciones de sesión: lee la política del entorno en cada llamada. */
export function isEmailVerificationRequired(user: { emailVerifiedAt: Date | null; createdAt: Date }, now: Date = new Date()): boolean {
  return emailAccess(user, readEmailVerificationPolicy(), now) === 'REQUIRED'
}

// Mensaje y código que reciben el login, /me y las rutas de cuenta cuando falta la verificación.
export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED'
export const EMAIL_NOT_VERIFIED_MESSAGE =
  'Tienes que verificar tu email antes de acceder. Revisa tu correo o solicita un enlace nuevo.'

// ==========================================================
// TOKENS
// ==========================================================

// Límites de envío por cuenta, además del rate limit por IP de las rutas.
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_TOKENS_PER_DAY = 5
const DAY_MS = 24 * 60 * 60 * 1000
// Los tokens ya usados o caducados se borran pasado este tiempo (se conservan al menos un día
// para poder contar los envíos de las últimas 24 horas).
const TOKEN_RETENTION_MS = 7 * DAY_MS

// Estados que impiden emitir o consumir enlaces: protección, suspensión y recuperación (E2).
const ACCOUNT_USABLE = { securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: null } as const

export function createEmailVerificationToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashEmailVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Formato del token del enlace: 64 caracteres hexadecimales. */
export function isEmailVerificationTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)
}

export type IssueResult =
  // `email` es la dirección asociada al token: la única a la que se puede enviar el enlace.
  | { issued: true; token: string; expiresAt: Date; email: string }
  // La cuenta ya está verificada, no existe o no puede recibir el enlace ahora.
  | { issued: false; reason: 'not_eligible' | 'cooldown' | 'daily_limit' }

// Se lanza dentro de la transacción para deshacerla entera (incluida la reserva del envío).
class IssueAbort extends Error {
  constructor(readonly reason: 'not_eligible' | 'cooldown' | 'daily_limit') {
    super(reason)
  }
}

/**
 * Emite un token nuevo para el email actual de la cuenta e invalida los anteriores sin usar.
 * No envía el correo.
 *
 * Límites por cuenta (uno por minuto y cinco cada 24 horas) frente a peticiones simultáneas:
 * lo primero es reservar el envío con una escritura condicional sobre la fila del usuario
 * (`emailVerificationSentAt` vacío o de hace al menos un minuto). Solo una petición puede
 * conseguirlo: en PostgreSQL, la segunda espera al bloqueo de la fila y vuelve a evaluar la
 * condición con el valor ya confirmado; en SQLite las escrituras se serializan. Quien no la
 * consigue no emite nada. Con la reserva hecha, el recuento de las últimas 24 horas ya no
 * puede cambiar por otra emisión de la misma cuenta.
 */
export async function issueEmailVerificationToken(
  userId: string,
  policy: EmailVerificationPolicy = readEmailVerificationPolicy(),
  now: Date = new Date(),
): Promise<IssueResult> {
  const token = createEmailVerificationToken()
  const tokenHash = hashEmailVerificationToken(token)
  const expiresAt = new Date(now.getTime() + policy.tokenTtlMs)

  try {
    return await prisma.$transaction(async (tx) => {
      const reserved = await tx.user.updateMany({
        where: {
          id: userId,
          emailVerifiedAt: null,
          ...ACCOUNT_USABLE,
          OR: [
            { emailVerificationSentAt: null },
            { emailVerificationSentAt: { lte: new Date(now.getTime() - RESEND_COOLDOWN_MS) } },
          ],
        },
        data: { emailVerificationSentAt: now },
      })
      if (reserved.count !== 1) {
        // Solo para elegir el motivo: la reserva ya ha fallado y no se escribe nada.
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { emailVerifiedAt: true, securityHoldAt: true, adminSuspendedAt: true, passwordResetRequiredAt: true },
        })
        const eligible = user && !user.emailVerifiedAt && !user.securityHoldAt && !user.adminSuspendedAt && !user.passwordResetRequiredAt
        throw new IssueAbort(eligible ? 'cooldown' : 'not_eligible')
      }

      // Con la reserva hecha, el email que se lee es el que tendrá el token.
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } })
      if (!user) throw new IssueAbort('not_eligible')

      const recent = await tx.emailVerificationToken.count({
        where: { userId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
      })
      // Se deshace también la reserva: sin envío no cuenta como envío.
      if (recent >= MAX_TOKENS_PER_DAY) throw new IssueAbort('daily_limit')

      // Los enlaces anteriores sin usar dejan de servir (se marcan, no se borran, para contar envíos).
      await tx.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } })
      await tx.emailVerificationToken.deleteMany({ where: { userId, createdAt: { lt: new Date(now.getTime() - TOKEN_RETENTION_MS) } } })
      await tx.emailVerificationToken.create({ data: { tokenHash, userId, email: user.email, expiresAt, createdAt: now } })
      return { issued: true, token, expiresAt, email: user.email } as const
    })
  } catch (error) {
    if (error instanceof IssueAbort) return { issued: false, reason: error.reason }
    throw error
  }
}

export type VerifyResult = 'verified' | 'expired' | 'invalid'

// Deshace la transacción del consumo (también la reclamación del token).
class ConsumeAbort extends Error {
  constructor(readonly result: 'invalid') {
    super(result)
  }
}

/**
 * Consume el token y marca el email como verificado, en una sola transacción. El token debe
 * existir, no haberse usado, no haber caducado y corresponder al email actual de la cuenta.
 * Solo devuelve 'verified' si el email queda verificado (o ya lo estaba) con la dirección del
 * token. Si la cuenta cambia entre la lectura y la escritura, se deshace todo y el token no
 * se gasta. No inicia sesión: verificar el email no es una forma de autenticarse.
 */
export async function consumeEmailVerificationToken(token: string, now: Date = new Date()): Promise<VerifyResult> {
  if (!isEmailVerificationTokenFormat(token)) return 'invalid'
  const tokenHash = hashEmailVerificationToken(token)

  try {
    return await prisma.$transaction(async (tx) => {
      const record = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, email: true, expiresAt: true, usedAt: true },
      })
      if (!record || record.usedAt) return 'invalid'
      if (record.expiresAt.getTime() <= now.getTime()) return 'expired'

      const user = await tx.user.findUnique({
        where: { id: record.userId },
        select: { email: true, emailVerifiedAt: true, securityHoldAt: true, adminSuspendedAt: true, passwordResetRequiredAt: true },
      })
      // El email cambió desde el envío, o la cuenta está protegida, suspendida o en E2.
      if (!user || user.email !== record.email || user.securityHoldAt || user.adminSuspendedAt || user.passwordResetRequiredAt) {
        return 'invalid'
      }

      // Reclamación condicional: si otra petición lo usó a la vez, solo una lo consigue.
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      })
      if (claimed.count !== 1) return 'invalid'

      if (!user.emailVerifiedAt) {
        // Escritura condicional con las mismas condiciones que la lectura: el email del token
        // y ningún estado de E2. Si no afecta a la cuenta, algo cambió entre medias.
        const verified = await tx.user.updateMany({
          where: { id: record.userId, email: record.email, emailVerifiedAt: null, ...ACCOUNT_USABLE },
          data: { emailVerifiedAt: now },
        })
        if (verified.count !== 1) {
          // Solo vale si otra operación ya lo verificó con el mismo email y la cuenta sigue usable.
          const current = await tx.user.findUnique({
            where: { id: record.userId },
            select: { email: true, emailVerifiedAt: true, securityHoldAt: true, adminSuspendedAt: true, passwordResetRequiredAt: true },
          })
          const alreadyVerified = current && current.email === record.email && current.emailVerifiedAt
            && !current.securityHoldAt && !current.adminSuspendedAt && !current.passwordResetRequiredAt
          if (!alreadyVerified) throw new ConsumeAbort('invalid')
        }
      }
      // Ningún otro enlace pendiente de la cuenta sigue sirviendo.
      await tx.emailVerificationToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } })
      return 'verified'
    })
  } catch (error) {
    if (error instanceof ConsumeAbort) return error.result
    throw error
  }
}

// ==========================================================
// ENVÍO
// ==========================================================

const WEB_APP_URL = process.env.WEB_APP_URL ?? 'http://localhost:5173'

export function verificationUrl(token: string): string {
  const url = new URL('/verificar-email', WEB_APP_URL)
  url.searchParams.set('token', token)
  return url.toString()
}

/**
 * Emite el token y envía el correo al email asociado al token (el que tenía la cuenta al
 * emitirlo), sin volver a consultarlo. Si la cuenta cambia de email después, el enlace deja
 * de servir. Nunca registra el token ni el enlace.
 */
export async function sendEmailVerification(userId: string): Promise<IssueResult> {
  const result = await issueEmailVerificationToken(userId)
  if (!result.issued) return result
  await emailService.sendEmailVerificationEmail({ to: result.email, verifyUrl: verificationUrl(result.token), expiresAt: result.expiresAt })
  return result
}

// Envíos en segundo plano: la respuesta HTTP no espera a la base ni al SMTP, para que su
// tiempo no revele si la cuenta existe. Al cerrar la app se espera a los pendientes.
const pendingDeliveries = new Set<Promise<void>>()

export function sendEmailVerificationInBackground(userId: string): void {
  const delivery = sendEmailVerification(userId)
    .then(() => undefined)
    .catch((error: unknown) => {
      // Sin el token ni el enlace: solo el motivo.
      console.error('No se pudo enviar el correo de verificación:', error instanceof Error ? error.message : 'error desconocido')
    })
    .finally(() => { pendingDeliveries.delete(delivery) })
  pendingDeliveries.add(delivery)
}

export async function waitForPendingVerificationDeliveries(): Promise<void> {
  await Promise.allSettled(pendingDeliveries)
}
