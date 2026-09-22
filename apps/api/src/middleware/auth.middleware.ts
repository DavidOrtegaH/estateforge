import type {
  FastifyReply,
  FastifyRequest,
} from 'fastify'

import {
  getUserIdFromSession,
} from '../services/session.service.js'

const SESSION_COOKIE =
  'estateforge_session'

function getSessionToken(
  request: FastifyRequest,
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

    const value =
      cookie.slice(
        separatorIndex + 1,
      )

    try {
      return decodeURIComponent(value)
    } catch {
      return null
    }
  }

  return null
}

export async function authenticateRequest(
  request: FastifyRequest,
): Promise<string | null> {
  const token =
    getSessionToken(request)

  if (!token) {
    request.userId = null
    return null
  }

  const userId =
    await getUserIdFromSession(token)

  request.userId = userId

  return userId
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId =
    await authenticateRequest(request)

  if (!userId) {
    reply.code(401).send({
      message:
        'Se requiere una sesión activa.',
    })

    return
  }
}