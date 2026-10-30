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
  issuePasswordResetToken,
  consumePasswordResetToken,
} from '../services/password-reset.service.js'
import { emailService } from '../services/email.service.js'
import {
  consumeEmailChangeCode,
  issueEmailChangeCode,
  normalizeEmail,
} from '../services/email-change.service.js'
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
const RESET_PASSWORD_URL =
  process.env.WEB_APP_URL ?? 'http://localhost:5173'

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

  return {
    token,
    ...session.user,
  }
}

export async function authRoutes(app: FastifyInstance) {
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

      const session = await createSession(user.id)
      setSessionCookie(reply, session.token, session.expiresAt)

      return reply.code(201).send({
        user: {
          id: user.id,
          email: user.email,
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

      const session = await createSession(user.id)
      setSessionCookie(reply, session.token, session.expiresAt)

      return {
        user: {
          id: user.id,
          email: user.email,
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
        select: { id: true, email: true },
      })

      if (user) {
        const reset = await issuePasswordResetToken(user.id)
        const resetUrl = new URL(
          '/restablecer-contrasena',
          RESET_PASSWORD_URL,
        )
        resetUrl.searchParams.set('token', reset.token)

        await emailService.sendPasswordResetEmail({
          to: user.email,
          resetUrl: resetUrl.toString(),
          expiresAt: reset.expiresAt,
        })
      }

      return {
        message:
          'Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.',
      }
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
        return sendValidationError(reply, 'Introduce un email válido.')
      }

      const user = await getAuthenticatedUser(request, reply)

      if (!user) {
        return
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

      await emailService.sendEmailChangeCodeEmail({
        to: newEmail,
        code: verification.code,
        expiresAt: verification.expiresAt,
      })

      return {
        message: 'Hemos enviado un código de verificación al nuevo email.',
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

      return {
        user: {
          id: user.id,
          email: verification.email,
        },
        message: 'Email actualizado correctamente.',
      }
    },
  )

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

    return { user: session.user }
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
