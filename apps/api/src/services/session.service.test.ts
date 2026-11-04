import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Doble de Prisma: solo la búsqueda de la sesión con su usuario y el borrado.
const prismaMock = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), deleteMany: vi.fn() },
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))

import { requireAuth } from '../middleware/auth.middleware.js'
import { getUserIdFromSession } from './session.service.js'

const USER_ID = 'user-1'
const TOKEN = 'b'.repeat(64)
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')
const SINCE = new Date('2026-11-02T10:00:00.000Z')

function sessionOf(state: Record<string, Date | null> = {}) {
  return {
    userId: USER_ID,
    expiresAt: new Date(Date.now() + 60_000),
    user: { securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: null, ...state },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.session.deleteMany.mockResolvedValue({ count: 1 })
})

describe('getUserIdFromSession', () => {
  it('lee los tres estados de acceso del usuario', async () => {
    prismaMock.session.findUnique.mockResolvedValue(sessionOf())

    await getUserIdFromSession(TOKEN)

    expect(prismaMock.session.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: TOKEN_HASH },
      select: {
        userId: true,
        expiresAt: true,
        user: { select: { securityHoldAt: true, adminSuspendedAt: true, passwordResetRequiredAt: true } },
      },
    })
  })

  it.each([
    ['recuperación pendiente', { passwordResetRequiredAt: SINCE }],
    ['protección por incidente', { securityHoldAt: SINCE }],
    ['suspensión administrativa', { adminSuspendedAt: SINCE }],
    ['los tres estados', { securityHoldAt: SINCE, adminSuspendedAt: SINCE, passwordResetRequiredAt: SINCE }],
  ])('con %s rechaza e invalida esa sesión', async (_label, state) => {
    prismaMock.session.findUnique.mockResolvedValue(sessionOf(state))

    await expect(getUserIdFromSession(TOKEN)).resolves.toBeNull()

    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: TOKEN_HASH } })
  })

  it('sin estados activos devuelve el usuario y no borra nada', async () => {
    prismaMock.session.findUnique.mockResolvedValue(sessionOf())

    await expect(getUserIdFromSession(TOKEN)).resolves.toBe(USER_ID)

    expect(prismaMock.session.deleteMany).not.toHaveBeenCalled()
  })
})

describe('requireAuth con el servicio de sesión real', () => {
  async function privateRequest() {
    const app = Fastify()
    app.decorateRequest('userId', null)
    app.get('/private', { preHandler: requireAuth }, async request => ({ userId: request.userId }))
    try {
      return await app.inject({ method: 'GET', url: '/private', headers: { cookie: `estateforge_session=${TOKEN}` } })
    } finally {
      await app.close()
    }
  }

  it('rechaza con 401 la sesión de una cuenta con recuperación pendiente', async () => {
    prismaMock.session.findUnique.mockResolvedValue(sessionOf({ passwordResetRequiredAt: SINCE }))

    const response = await privateRequest()

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ message: 'Se requiere una sesión activa.' })
    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: TOKEN_HASH } })
  })

  it('deja pasar la misma cuenta cuando el campo está limpio', async () => {
    prismaMock.session.findUnique.mockResolvedValue(sessionOf())

    const response = await privateRequest()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ userId: USER_ID })
  })
})
