import {
  createHash,
} from 'node:crypto'

import type {
  FastifyInstance,
  FastifyReply,
} from 'fastify'

import {
  z,
} from 'zod'

import { prisma } from '../db/prisma.js'

import {
  hashPassword,
  verifyPassword,
} from '../services/password.service.js'

import {
  createSession,
  deleteSession,
} from '../services/session.service.js'

const AuthCredentialsSchema =
  z.object({
    email: z
      .string()
      .trim()
      .email()
      .max(254),

    password: z
      .string()
      .min(8)
      .max(128),
  })

const SESSION_COOKIE =
  'estateforge_session'

function hashSessionToken(
  token: string,
): string {
  return createHash('sha256')
    .update(token)
    .digest('hex')
}

function getSessionCookie(
  request: {
    headers: Record<
      string,
      string | string[] | undefined
    >
  },
): string | null {
  const cookieHeader =
    request.headers.cookie

  if (typeof cookieHeader !== 'string') {
    return null
  }

  const cookies =
    cookieHeader.split(';')

  for (const cookie of cookies) {
    const separatorIndex =
      cookie.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const name =
      cookie
        .slice(0, separatorIndex)
        .trim()

    if (name !== SESSION_COOKIE) {
      continue
    }

    return decodeURIComponent(
      cookie.slice(
        separatorIndex + 1,
      ),
    )
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
  ].join('; ')

  reply.header(
    'Set-Cookie',
    cookie,
  )
}

function clearSessionCookie(
  reply: FastifyReply,
): void {
  reply.header(
    'Set-Cookie',
    [
      `${SESSION_COOKIE}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
    ].join('; '),
  )
}

function sendValidationError(
  reply: FastifyReply,
  message: string,
) {
  return reply.code(400).send({
    message,
  })
}

export async function authRoutes(
  app: FastifyInstance,
) {
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
    async (
      request,
      reply,
    ) => {
      const result =
        AuthCredentialsSchema.safeParse(
          request.body,
        )

      if (!result.success) {
        return sendValidationError(
          reply,
          'El email o la contraseña no son válidos.',
        )
      }

      const {
        email,
        password,
      } = result.data

      const normalizedEmail =
        email.toLowerCase()

      const existingUser =
        await prisma.user.findUnique({
          where: {
            email: normalizedEmail,
          },
        })

      if (existingUser) {
        return reply.code(409).send({
          message:
            'Ya existe una cuenta con ese email.',
        })
      }

      const passwordHash =
        await hashPassword(
          password,
        )

      const user =
        await prisma.user.create({
          data: {
            email: normalizedEmail,
            password: passwordHash,
          },
        })

      const session =
        await createSession(
          user.id,
        )

      setSessionCookie(
        reply,
        session.token,
        session.expiresAt,
      )

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
    async (
      request,
      reply,
    ) => {
      const result =
        AuthCredentialsSchema.safeParse(
          request.body,
        )

      if (!result.success) {
        return sendValidationError(
          reply,
          'El email o la contraseña no son válidos.',
        )
      }

      const {
        email,
        password,
      } = result.data

      const normalizedEmail =
        email.toLowerCase()

      const user =
        await prisma.user.findUnique({
          where: {
            email: normalizedEmail,
          },
        })

      if (!user) {
        return reply.code(401).send({
          message:
            'Email o contraseña incorrectos.',
        })
      }

      const validPassword =
        await verifyPassword(
          password,
          user.password,
        )

      if (!validPassword) {
        return reply.code(401).send({
          message:
            'Email o contraseña incorrectos.',
        })
      }

      const session =
        await createSession(
          user.id,
        )

      setSessionCookie(
        reply,
        session.token,
        session.expiresAt,
      )

      return {
        user: {
          id: user.id,
          email: user.email,
        },
      }
    },
  )

  app.get(
    '/api/auth/me',
    async (
      request,
      reply,
    ) => {
      const token =
        getSessionCookie(
          request,
        )

      if (!token) {
        return reply.code(401).send({
          message:
            'No hay una sesión activa.',
        })
      }

      const session =
        await prisma.session.findUnique({
          where: {
            tokenHash:
              hashSessionToken(token),
          },
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
        clearSessionCookie(
          reply,
        )

        return reply.code(401).send({
          message:
            'La sesión no es válida o ha expirado.',
        })
      }

      if (
        session.expiresAt.getTime() <=
        Date.now()
      ) {
        await prisma.session.deleteMany({
          where: {
            tokenHash:
              hashSessionToken(token),
          },
        })

        clearSessionCookie(
          reply,
        )

        return reply.code(401).send({
          message:
            'La sesión no es válida o ha expirado.',
        })
      }

      return {
        user: session.user,
      }
    },
  )

  app.post(
    '/api/auth/logout',
    async (
      request,
      reply,
    ) => {
      const token =
        getSessionCookie(
          request,
        )

      if (token) {
        await deleteSession(
          token,
        )
      }

      clearSessionCookie(
        reply,
      )

      return {
        success: true,
      }
    },
  )
}