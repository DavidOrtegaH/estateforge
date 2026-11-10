


import { createHash } from 'node:crypto'

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'

import { prisma } from '../db/prisma.js'
import {
  PASSWORD_POLICY_MESSAGE,
  isStrongPassword,
  MAX_PASSWORD_LENGTH,
} from '../services/password-policy.js'
import {
  consumePasswordResetToken,
  consumeSecurityRecoveryToken,
} from '../services/password-reset.service.js'
import {
  deliverPasswordResetInBackground,
  waitForPendingPasswordResetDeliveries,
} from '../services/password-reset-delivery.service.js'
import { emailService } from '../services/email.service.js'
import { deliveryStateFields, safeDeliveryErrorFields, safeErrorName } from '../services/log-safety.js'
import { DELIVERY_SHUTDOWN_TIMEOUT_MS, deliveryWaitBudgetMs } from '../services/pending-deliveries.js'
import { buildAuditMetadata, type NoticeFailureKind } from '../services/admin-audit.service.js'
import { issueSecurityIncidentToken, reportSecurityIncident } from '../services/security-incident.service.js'
import {
  consumeEmailChangeCode,
  issueEmailChangeCode,
  normalizeEmail,
} from '../services/email-change.service.js'
import {
  deliverRecoveryLinkInBackground,
  issueRequestedRecoveryLinks,
  waitForPendingRecoveryDeliveries,
} from '../services/security-recovery.service.js'
import {
  hashPassword,
  verifyPassword,
} from '../services/password.service.js'
import {
  createSession,
  deleteSession,
} from '../services/session.service.js'
import {
  verifyTurnstileToken,
} from '../services/turnstile.service.js'
import {
  EMAIL_NOT_VERIFIED_CODE,
  EMAIL_NOT_VERIFIED_MESSAGE,
  consumeEmailVerificationToken,
  emailAccess,
  isEmailVerificationRequired,
  readEmailVerificationPolicy,
  sendEmailVerificationInBackground,
  waitForPendingVerificationDeliveries,
} from '../services/email-verification.service.js'
import {
  ChangePasswordSchema,
  DeleteAccountSchema,
  ChangeEmailRequestSchema,
  VerifyEmailChangeSchema,
} from './account.schemas.js'

const TurnstileTokenSchema = z.string().trim().min(1).max(2_048).optional()

const RegisterCredentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z
    .string()
    .min(12)
    .max(MAX_PASSWORD_LENGTH)
    .refine(isStrongPassword, PASSWORD_POLICY_MESSAGE),
  turnstileToken: TurnstileTokenSchema,
})

const LoginCredentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  turnstileToken: TurnstileTokenSchema,
})

const ForgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254),
  turnstileToken: TurnstileTokenSchema,
})

// Solicitud del titular de un enlace de recuperación obligatoria (E2.6). Estricto: el cliente
// no puede indicar destino, token ni versión.
const SecurityRecoveryRequestSchema = z.object({
  email: z.string().trim().email().max(254),
  turnstileToken: TurnstileTokenSchema,
}).strict()

// Igual para cualquier cuenta y resultado: no revela si existe, su estado ni su destino.
const SECURITY_RECOVERY_REQUEST_MESSAGE =
  'Si la cuenta puede recuperar el acceso, recibirás instrucciones en el destino de recuperación registrado.'

// Verificación del email (Fase 0).
const VerifyEmailSchema = z.object({
  token: z.string().trim().min(1).max(256),
}).strict()
const ResendEmailVerificationSchema = z.object({
  email: z.string().trim().email().max(254),
}).strict()
// Igual exista o no la cuenta, esté verificada o no: no revela nada.
const RESEND_EMAIL_VERIFICATION_MESSAGE =
  'Si la cuenta existe y su email está pendiente de verificación, recibirás un enlace nuevo en unos minutos.'
const REGISTER_VERIFICATION_MESSAGE =
  'Cuenta creada. Te hemos enviado un enlace para verificar tu email; ábrelo para poder acceder.'

const ResetPasswordSchema = z.object({
  token: z.string().trim().min(32).max(256),
  password: z
    .string()
    .min(12)
    .max(MAX_PASSWORD_LENGTH)
    .refine(isStrongPassword, PASSWORD_POLICY_MESSAGE),
  turnstileToken: TurnstileTokenSchema,
})

const SESSION_COOKIE = 'estateforge_session'
// El cambio de email se completó, pero no se pudo avisar a la dirección anterior (decisión D4).
const EMAIL_CHANGED_NOTICE_FAILED_MESSAGE =
  'Email actualizado correctamente, pero no hemos podido enviar el aviso de seguridad a tu dirección anterior. No hace falta repetir el cambio.'
const API_PUBLIC_URL =
  process.env.API_PUBLIC_URL ?? 'http://localhost:3000'

// Recuperación obligatoria tras un incidente (E2). No remite a «¿Has olvidado tu
// contraseña?»: ese flujo aún envía el enlace al email actual de la cuenta.
const PASSWORD_RESET_REQUIRED_MESSAGE =
  'Debes establecer una contraseña nueva antes de volver a acceder. Si no has recibido el enlace de recuperación, contacta con soporte.'

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function getSessionCookie(
  request: {
    headers: Record<string, string | string[] | undefined>
  },
): string | null {
  const cookieHeader = request.headers.cookie

  if (typeof cookieHeader !== 'string') {
    return null
  }

  for (const cookie of cookieHeader.split(';')) {
    const separatorIndex = cookie.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const name = cookie.slice(0, separatorIndex).trim()

    if (name !== SESSION_COOKIE) {
      continue
    }

    try {
      return decodeURIComponent(cookie.slice(separatorIndex + 1))
    } catch {
      return null
    }
  }

  return null
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ')

  reply.header('Set-Cookie', cookie)
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.header(
    'Set-Cookie',
    [
      `${SESSION_COOKIE}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
      ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
    ].join('; '),
  )
}

function sendValidationError(
  reply: FastifyReply,
  message: string,
) {
  return reply.code(400).send({ message })
}

async function requireTurnstile(
  token: string | undefined,
  requestIp: string,
  reply: FastifyReply,
): Promise<boolean> {
  const valid = await verifyTurnstileToken(token, requestIp)

  if (!valid) {
    reply.code(400).send({
      message:
        'No se ha podido completar la verificación de seguridad. Inténtalo de nuevo.',
    })
    return false
  }

  return true
}

async function getAuthenticatedUser(
  request: {
    headers: Record<string, string | string[] | undefined>
  },
  reply: FastifyReply,
) {
  const token = getSessionCookie(request)

  if (!token) {
    reply.code(401).send({
      message: 'No hay una sesión activa.',
    })
    return null
  }

  const tokenHash = hashSessionToken(token)
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          password: true,
          securityHoldAt: true,
          passwordResetRequiredAt: true,
          emailVerifiedAt: true,
          createdAt: true,
        },
      },
      expiresAt: true,
    },
  })

  if (!session) {
    clearSessionCookie(reply)
    reply.code(401).send({
      message: 'La sesión no es válida o ha expirado.',
    })
    return null
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({
      where: { tokenHash },
    })

    clearSessionCookie(reply)
    reply.code(401).send({
      message: 'La sesión no es válida o ha expirado.',
    })
    return null
  }

  if (session.user.securityHoldAt) {
    await prisma.session.deleteMany({ where: { userId: session.user.id } })
    clearSessionCookie(reply)
    reply.code(423).send({ message: 'La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.' })
    return null
  }

  if (session.user.passwordResetRequiredAt) {
    await prisma.session.deleteMany({ where: { userId: session.user.id } })
    clearSessionCookie(reply)
    reply.code(423).send({ message: PASSWORD_RESET_REQUIRED_MESSAGE })
    return null
  }

  // Fase 0: email sin verificar cuando ya se exige (después de los estados de E2).
  if (isEmailVerificationRequired(session.user)) {
    await prisma.session.deleteMany({ where: { userId: session.user.id } })
    clearSessionCookie(reply)
    reply.code(403).send({ code: EMAIL_NOT_VERIFIED_CODE, message: EMAIL_NOT_VERIFIED_MESSAGE })
    return null
  }

  return {
    token,
    ...session.user,
  }
}

export async function authRoutes(app: FastifyInstance) {
  // Una configuración de verificación del email no válida detiene el arranque (Fase 0).
  readEmailVerificationPolicy()

  // Al cerrar la app, espera a los enlaces de recuperación, de verificación y de restablecimiento
  // de contraseña que se enviaban en segundo plano.
  app.addHook('onClose', async () => {
    // Espera uniforme (F0-005): los tres tipos de envío en paralelo, con un único plazo de como
    // mucho DELIVERY_SHUTDOWN_TIMEOUT_MS. Si el cierre lo inició una señal, ese plazo se recorta a
    // lo que le quede al cierre, sin prolongarlo. Un envío que falle no bloquea; uno que no termine
    // a tiempo se abandona y se avisa.
    const timeoutMs = deliveryWaitBudgetMs(DELIVERY_SHUTDOWN_TIMEOUT_MS)
    const results = await Promise.all([
      waitForPendingRecoveryDeliveries(timeoutMs),
      waitForPendingVerificationDeliveries(timeoutMs),
      waitForPendingPasswordResetDeliveries(timeoutMs),
    ])
    const pendingDeliveries = results.reduce((total, result) => total + result.pending, 0)
    if (results.some(result => result.timedOut)) {
      // Sin terminar no significa fallidos ni enviados: su resultado no está confirmado.
      app.log.warn({ pendingDeliveries, deliveryState: 'unconfirmed', timeoutMs }, 'Cierre con envíos de correo sin terminar dentro del plazo')
    }
  })

  app.post(
    '/api/auth/register',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const result = RegisterCredentialsSchema.safeParse(request.body)

      if (!result.success) {
        const hasPasswordError = result.error.issues.some((issue) =>
          issue.path.includes('password'),
        )

        return sendValidationError(
          reply,
          hasPasswordError
            ? PASSWORD_POLICY_MESSAGE
            : 'El email o la contraseña no son válidos.',
        )
      }

      if (!(await requireTurnstile(result.data.turnstileToken, request.ip, reply))) {
        return
      }

      const { email, password } = result.data
      const normalizedEmail = normalizeEmail(email)

      const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      })

      if (existingUser) {
        return reply.code(409).send({
          message: 'Ya existe una cuenta con ese email.',
        })
      }

      const passwordHash = await hashPassword(password)
      const user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          password: passwordHash,
        },
      })

      // La cuenta nace sin verificar y siempre recibe el enlace. Si la verificación ya se exige,
      // no se abre sesión: el titular confirma el email y después inicia sesión.
      sendEmailVerificationInBackground(request.log, user.id)
      if (isEmailVerificationRequired(user)) {
        return reply.code(201).send({
          verificationRequired: true,
          email: user.email,
          message: REGISTER_VERIFICATION_MESSAGE,
        })
      }

      const session = await createSession(user.id)
      setSessionCookie(reply, session.token, session.expiresAt)

      return reply.code(201).send({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      })
    },
  )

  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const result = LoginCredentialsSchema.safeParse(request.body)

      if (!result.success) {
        return sendValidationError(
          reply,
          'El email o la contraseña no son válidos.',
        )
      }

      if (!(await requireTurnstile(result.data.turnstileToken, request.ip, reply))) {
        return
      }

      const { email, password } = result.data
      const normalizedEmail = normalizeEmail(email)
      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      })

      if (!user) {
        return reply.code(401).send({
          message: 'Email o contraseña incorrectos.',
        })
      }

      const validPassword = await verifyPassword(password, user.password)

      if (!validPassword) {
        return reply.code(401).send({
          message: 'Email o contraseña incorrectos.',
        })
      }

      if (user.securityHoldAt) {
        return reply.code(423).send({
          message: 'La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.',
        })
      }

      if (user.adminSuspendedAt) {
        return reply.code(423).send({
          message: 'La cuenta está suspendida por el equipo de EstateForge. Contacta con soporte.',
        })
      }

      if (user.passwordResetRequiredAt) {
        return reply.code(423).send({ message: PASSWORD_RESET_REQUIRED_MESSAGE })
      }

      // Fase 0: solo se informa tras una contraseña correcta, así que no revela cuentas.
      if (isEmailVerificationRequired(user)) {
        return reply.code(403).send({ code: EMAIL_NOT_VERIFIED_CODE, message: EMAIL_NOT_VERIFIED_MESSAGE })
      }

      const session = await createSession(user.id)
      setSessionCookie(reply, session.token, session.expiresAt)

      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      }
    },
  )

  app.post(
    '/api/auth/forgot-password',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const result = ForgotPasswordSchema.safeParse(request.body)

      if (!result.success) {
        return sendValidationError(reply, 'Introduce un email válido.')
      }

      if (!(await requireTurnstile(result.data.turnstileToken, request.ip, reply))) {
        return
      }

      const normalizedEmail = normalizeEmail(result.data.email)
      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, securityHoldAt: true, adminSuspendedAt: true, passwordResetRequiredAt: true },
      })

      // Una cuenta en recuperación obligatoria (E2) no recibe un enlace de autoservicio al
      // email actual: su único enlace válido es el obligatorio. La respuesta sigue siendo genérica.
      // La emisión del token y el envío van en segundo plano (decisión D3 de la Fase 0): la
      // respuesta no espera al SMTP y un fallo de envío no la cambia.
      if (user && !user.securityHoldAt && !user.adminSuspendedAt && !user.passwordResetRequiredAt) {
        deliverPasswordResetInBackground(request.log, { id: user.id, email: user.email })
      }

      return {
        message:
          'Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.',
      }
    },
  )

  // El titular pide un enlace nuevo de recuperación obligatoria (E2.6). Siempre al destino
  // guardado de cada cuenta, nunca a User.email. La respuesta no depende de la cuenta y el
  // correo se envía sin esperar, para que el tiempo de respuesta tampoco lo revele.
  app.post(
    '/api/auth/security-recovery/request',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const result = SecurityRecoveryRequestSchema.safeParse(request.body)

      if (!result.success) {
        return sendValidationError(reply, 'Introduce un email válido.')
      }

      if (!(await requireTurnstile(result.data.turnstileToken, request.ip, reply))) {
        return
      }

      try {
        const links = await issueRequestedRecoveryLinks(request.log, normalizeEmail(result.data.email))
        for (const link of links) {
          deliverRecoveryLinkInBackground(request.log, link)
        }
      } catch (error) {
        // La respuesta es la misma: un fallo tampoco debe distinguir unas cuentas de otras.
        request.log.error({ errorName: safeErrorName(error) }, 'No se pudo procesar una solicitud de recuperación obligatoria')
      }

      return { message: SECURITY_RECOVERY_REQUEST_MESSAGE }
    },
  )

  app.post(
    '/api/auth/reset-password',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const result = ResetPasswordSchema.safeParse(request.body)

      if (!result.success) {
        const hasPasswordError = result.error.issues.some((issue) =>
          issue.path.includes('password'),
        )

        return sendValidationError(
          reply,
          hasPasswordError
            ? PASSWORD_POLICY_MESSAGE
            : 'El enlace de recuperación no es válido.',
        )
      }

      if (!(await requireTurnstile(result.data.turnstileToken, request.ip, reply))) {
        return
      }

      const passwordHash = await hashPassword(result.data.password)
      const consumed = await consumePasswordResetToken(
        result.data.token,
        passwordHash,
      )

      if (!consumed) {
        return reply.code(400).send({
          message:
            'El enlace de recuperación no es válido o ha caducado.',
        })
      }

      return {
        message:
          'Contraseña restablecida correctamente. Ya puedes iniciar sesión.',
      }
    },
  )

  // Recuperación obligatoria tras un incidente (E2.5): mismas validaciones, Turnstile y
  // límite que reset-password. La operación completa la hace el servicio en una transacción.
  app.post(
    '/api/auth/security-recovery/complete',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const result = ResetPasswordSchema.safeParse(request.body)

      if (!result.success) {
        const hasPasswordError = result.error.issues.some((issue) =>
          issue.path.includes('password'),
        )

        return sendValidationError(
          reply,
          hasPasswordError
            ? PASSWORD_POLICY_MESSAGE
            : 'El enlace de recuperación no es válido.',
        )
      }

      if (!(await requireTurnstile(result.data.turnstileToken, request.ip, reply))) {
        return
      }

      const passwordHash = await hashPassword(result.data.password)
      const outcome = await consumeSecurityRecoveryToken(
        result.data.token,
        passwordHash,
      )

      // Ninguna respuesta incluye el destino, la cuenta ni detalles internos.
      switch (outcome) {
        case 'completed':
          return {
            message:
              'Contraseña establecida y acceso recuperado. Ya puedes iniciar sesión con el email al que recibiste este enlace.',
          }
        case 'invalid_token':
          return reply.code(400).send({
            message:
              'El enlace de recuperación no es válido o ha caducado.',
          })
        case 'state_mismatch':
          return reply.code(400).send({
            message:
              'Este enlace ya no permite completar la recuperación de la cuenta. Contacta con soporte si sigues sin poder acceder.',
          })
        case 'email_taken':
          return reply.code(409).send({
            message:
              'No se ha podido completar la recuperación porque el email de recuperación no está disponible. Contacta con soporte.',
          })
      }
    },
  )

  app.post(
    '/api/auth/change-email/request',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const result = ChangeEmailRequestSchema.safeParse(request.body)

      if (!result.success) {
        return sendValidationError(reply, 'Introduce un email válido y tu contraseña actual.')
      }

      const user = await getAuthenticatedUser(request, reply)

      if (!user) {
        return
      }

      const validCurrentPassword = await verifyPassword(
        result.data.currentPassword,
        user.password,
      )

      if (!validCurrentPassword) {
        return reply.code(401).send({
          message: 'La contraseña actual no es correcta.',
        })
      }

      const newEmail = normalizeEmail(result.data.newEmail)

      if (newEmail === user.email) {
        return reply.code(400).send({
          message: 'El nuevo email debe ser diferente del actual.',
        })
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: newEmail },
        select: { id: true },
      })

      if (existingUser) {
        return reply.code(409).send({
          message: 'Ya existe una cuenta con ese email.',
        })
      }

      const verification = await issueEmailChangeCode(user.id, newEmail)

      try {
        await emailService.sendEmailChangeCodeEmail({
          to: newEmail,
          code: verification.code,
          expiresAt: verification.expiresAt,
        })

        await emailService.sendEmailChangeNoticeEmail({
          to: user.email,
          newEmail,
          stage: 'requested',
        })
      } catch (error) {
        await prisma.emailChangeVerification.deleteMany({
          where: { userId: user.id, usedAt: null },
        })
        // Sin el error completo: podría incluir las direcciones, el código o la respuesta del SMTP.
        request.log.error({ flow: 'email_change_request', targetUserId: user.id, ...safeDeliveryErrorFields(error) }, 'No se pudieron enviar los correos de cambio de email')
        return reply.code(503).send({
          message: 'No se han podido enviar todos los correos de seguridad. No se ha iniciado el cambio; inténtalo de nuevo más tarde.',
        })
      }

      return {
        message: 'Hemos enviado un código al nuevo email y un aviso de seguridad a tu dirección actual.',
        expiresAt: verification.expiresAt.toISOString(),
      }
    },
  )

  app.post(
    '/api/auth/change-email/verify',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const result = VerifyEmailChangeSchema.safeParse(request.body)

      if (!result.success) {
        return sendValidationError(reply, 'El código de verificación no es válido.')
      }

      const user = await getAuthenticatedUser(request, reply)

      if (!user) {
        return
      }

      const verification = await consumeEmailChangeCode(user.id, result.data.code)

      if (!verification.success) {
        if (verification.reason === 'email_taken') {
          return reply.code(409).send({
            message: 'Ese email ya pertenece a otra cuenta.',
          })
        }

        return reply.code(400).send({
          message: 'El código de verificación no es válido o ha caducado.',
        })
      }

      // El cambio ya está confirmado en la base y no se deshace aunque falle el aviso a la
      // dirección anterior (decisión D4 de la Fase 0). La respuesta lo indica para que la web
      // no presente un fallo del aviso como un fallo del cambio.
      let securityNoticeSent = true
      // Fase en curso, para clasificar un fallo sin guardar el error (corrección F0-002).
      let noticeStage: NoticeFailureKind = 'INCIDENT_LINK'
      try {
        // El token guarda el email anterior: es la dirección a la que se envía el aviso.
        const incident = await issueSecurityIncidentToken(user.id, verification.oldEmail)
        const incidentUrl = new URL(`/api/auth/security-incident/${incident.token}`, API_PUBLIC_URL)
        noticeStage = 'DELIVERY'
        await emailService.sendEmailChangeNoticeEmail({
          to: verification.oldEmail,
          newEmail: verification.email,
          stage: 'completed',
          incidentReportUrl: incidentUrl.toString(),
        })
      } catch (error) {
        securityNoticeSent = false
        // Sin el error completo: podría incluir la dirección anterior, el enlace o el mensaje.
        request.log.error({ targetUserId: user.id, errorName: safeErrorName(error), ...deliveryStateFields(error) }, 'No se pudo enviar el aviso de cambio de email completado')
        // El titular anterior se queda sin el enlace para denunciar el cambio: se deja constancia
        // en la auditoría para que un OWNER lo vea. Sin emails, token ni enlace; solo la fase.
        // Un fallo al auditar tampoco convierte el cambio, ya hecho, en un error.
        try {
          await prisma.adminAuditLog.create({
            data: {
              actorUserId: user.id,
              targetUserId: user.id,
              action: 'EMAIL_CHANGE_NOTICE_FAILED',
              metadata: buildAuditMetadata({ noticeFailure: noticeStage }),
            },
          })
        } catch (auditError) {
          request.log.error({ targetUserId: user.id, errorName: safeErrorName(auditError) }, 'No se pudo auditar el aviso de cambio de email no enviado')
        }
      }

      return {
        user: {
          id: user.id,
          email: verification.email,
        },
        securityNoticeSent,
        message: securityNoticeSent
          ? 'Email actualizado correctamente.'
          : EMAIL_CHANGED_NOTICE_FAILED_MESSAGE,
      }
    },
  )

  // El GET solo muestra una confirmación: los escáneres de enlaces no bloquean cuentas.
  app.get('/api/auth/security-incident/:token', async (request, reply) => {
    const params = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(request.params)
    if (!params.success) return reply.code(404).type('text/plain').send('Enlace no válido o caducado.')
    const token = params.data.token
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proteger cuenta — EstateForge</title><body style="font-family:Arial,sans-serif;max-width:620px;margin:48px auto;padding:0 20px;line-height:1.6;color:#1f2937"><h1>Proteger cuenta de EstateForge</h1><p>Si no reconoces el cambio de email, confirma la denuncia. Se cerrarán todas las sesiones, se invalidarán los enlaces de recuperación y se bloqueará temporalmente el acceso hasta que soporte verifique la titularidad.</p><p>Esta acción no restaura automáticamente el email anterior.</p><form
  method="post"
  action="/api/auth/security-incident/${token}"
  onsubmit="event.preventDefault();var f=this;fetch(f.action,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(async function(r){var t=await r.text();document.open();document.write(t);document.close();}).catch(function(){alert('No se pudo enviar la denuncia. Inténtalo de nuevo.');});"
>
  <button type="submit">
    No reconozco este cambio: proteger mi cuenta
  </button>
</form><p>Si reconoces el cambio, simplemente cierra esta página.</p></body></html>`)
  })

  app.post('/api/auth/security-incident/:token', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const params = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(request.params)
    if (!params.success) return reply.code(400).type('text/html; charset=utf-8').send('<p>El enlace no es válido o ha caducado.</p>')
    const result = await reportSecurityIncident(params.data.token)
    if (result !== 'reported') return reply.code(400).type('text/html; charset=utf-8').send('<p>El enlace no es válido, ya se ha utilizado o ha caducado.</p>')
    return reply.type('text/html; charset=utf-8').send('<!doctype html><html lang="es"><meta charset="utf-8"><title>Cuenta protegida — EstateForge</title><body style="font-family:Arial,sans-serif;max-width:620px;margin:48px auto;padding:0 20px;line-height:1.6;color:#1f2937"><h1>Hemos protegido temporalmente tu cuenta</h1><p>Se han cerrado todas las sesiones y se han invalidado los enlaces de recuperación pendientes. No se permitirá iniciar sesión ni restablecer la contraseña mientras la cuenta esté protegida.</p><p>Contacta con el soporte oficial de EstateForge para verificar tu identidad y recuperar el acceso. El email anterior no se restaura automáticamente.</p></body></html>')
  })

  app.post(
    '/api/auth/change-password',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const result = ChangePasswordSchema.safeParse(request.body)

      if (!result.success) {
        const hasPasswordError = result.error.issues.some((issue) =>
          issue.path.includes('newPassword'),
        )

        return sendValidationError(
          reply,
          hasPasswordError
            ? PASSWORD_POLICY_MESSAGE
            : 'Los datos de cambio de contraseña no son válidos.',
        )
      }

      const user = await getAuthenticatedUser(request, reply)

      if (!user) {
        return
      }

      const validCurrentPassword = await verifyPassword(
        result.data.currentPassword,
        user.password,
      )

      if (!validCurrentPassword) {
        return reply.code(401).send({
          message: 'La contraseña actual no es correcta.',
        })
      }

      if (result.data.currentPassword === result.data.newPassword) {
        return reply.code(400).send({
          message: 'La nueva contraseña debe ser diferente de la actual.',
        })
      }

      const newPasswordHash = await hashPassword(result.data.newPassword)

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { password: newPasswordHash },
        }),
        prisma.session.deleteMany({
          where: { userId: user.id },
        }),
        prisma.passwordResetToken.deleteMany({
          where: { userId: user.id },
        }),
      ])

      clearSessionCookie(reply)

      return {
        message:
          'Contraseña cambiada correctamente. Por seguridad, debes iniciar sesión de nuevo.',
      }
    },
  )

  app.delete(
    '/api/auth/account',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const result = DeleteAccountSchema.safeParse(request.body)

      if (!result.success) {
        return sendValidationError(
          reply,
          'La contraseña actual es obligatoria.',
        )
      }

      const user = await getAuthenticatedUser(request, reply)

      if (!user) {
        return
      }

      const validCurrentPassword = await verifyPassword(
        result.data.currentPassword,
        user.password,
      )

      if (!validCurrentPassword) {
        return reply.code(401).send({
          message: 'La contraseña actual no es correcta.',
        })
      }

      await prisma.user.delete({
        where: { id: user.id },
      })

      clearSessionCookie(reply)

      return {
        success: true,
        message: 'La cuenta se ha eliminado correctamente.',
      }
    },
  )

  // Confirma el email con el token del enlace. No inicia sesión ni necesita una: verificar el
  // email no es una forma de autenticarse. El token va en el cuerpo (no en la URL de la API),
  // y la página web solo lo envía cuando el titular pulsa el botón.
  app.post(
    '/api/auth/verify-email',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = VerifyEmailSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ code: 'INVALID', message: 'El enlace de verificación no es válido.' })
      }

      const result = await consumeEmailVerificationToken(parsed.data.token)
      if (result === 'verified') {
        return { verified: true, message: 'Email verificado. Ya puedes iniciar sesión.' }
      }
      if (result === 'expired') {
        return reply.code(400).send({ code: 'EXPIRED', message: 'El enlace de verificación ha caducado. Solicita uno nuevo.' })
      }
      return reply.code(400).send({ code: 'INVALID', message: 'El enlace de verificación no es válido o ya se ha usado.' })
    },
  )

  // Pide un enlace nuevo. La respuesta es la misma para cualquier email y no espera al envío,
  // para no revelar si la cuenta existe ni su estado. Además del límite por IP, el servicio
  // limita los envíos por cuenta (uno por minuto y cinco al día).
  app.post(
    '/api/auth/verify-email/resend',
    { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = ResendEmailVerificationSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendValidationError(reply, 'Introduce un email válido.')
      }

      const user = await prisma.user.findUnique({
        where: { email: normalizeEmail(parsed.data.email) },
        select: { id: true },
      })
      if (user) sendEmailVerificationInBackground(request.log, user.id)

      return { message: RESEND_EMAIL_VERIFICATION_MESSAGE }
    },
  )

  app.get('/api/auth/me', async (request, reply) => {
    const token = getSessionCookie(request)

    if (!token) {
      return reply.code(401).send({
        message: 'No hay una sesión activa.',
      })
    }

    const tokenHash = hashSessionToken(token)
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            securityHoldAt: true,
            adminSuspendedAt: true,
            passwordResetRequiredAt: true,
            emailVerifiedAt: true,
            createdAt: true,
          },
        },
        expiresAt: true,
      },
    })

    if (!session) {
      clearSessionCookie(reply)

      return reply.code(401).send({
        message: 'La sesión no es válida o ha expirado.',
      })
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await prisma.session.deleteMany({
        where: { tokenHash },
      })

      clearSessionCookie(reply)

      return reply.code(401).send({
        message: 'La sesión no es válida o ha expirado.',
      })
    }

    if (session.user.securityHoldAt) {
      await prisma.session.deleteMany({ where: { userId: session.user.id } })
      clearSessionCookie(reply)
      return reply.code(423).send({ message: 'La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.' })
    }

    if (session.user.adminSuspendedAt) {
      await prisma.session.deleteMany({ where: { userId: session.user.id } })
      clearSessionCookie(reply)
      return reply.code(423).send({ message: 'La cuenta está suspendida por el equipo de EstateForge. Contacta con soporte.' })
    }

    if (session.user.passwordResetRequiredAt) {
      await prisma.session.deleteMany({ where: { userId: session.user.id } })
      clearSessionCookie(reply)
      return reply.code(423).send({ message: PASSWORD_RESET_REQUIRED_MESSAGE })
    }

    // Fase 0: email sin verificar cuando ya se exige (cuenta nueva o fin del periodo de gracia).
    const policy = readEmailVerificationPolicy()
    const access = emailAccess(session.user, policy)
    if (access === 'REQUIRED') {
      await prisma.session.deleteMany({ where: { userId: session.user.id } })
      clearSessionCookie(reply)
      return reply.code(403).send({ code: EMAIL_NOT_VERIFIED_CODE, message: EMAIL_NOT_VERIFIED_MESSAGE })
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
        // Para avisar en la web a quien aún no ha verificado; graceUntil solo en el periodo de gracia.
        emailVerification: {
          status: access,
          graceUntil: access === 'GRACE' && policy.graceUntil ? policy.graceUntil.toISOString() : null,
        },
      },
    }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const token = getSessionCookie(request)

    if (token) {
      await deleteSession(token)
    }

    clearSessionCookie(reply)

    return { success: true }
  })
}

