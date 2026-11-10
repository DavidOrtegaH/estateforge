import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/prisma.js', () => ({ prisma: {} }))

import { readinessRoutes } from './readiness.routes.js'

async function appWith(probe: () => Promise<unknown>, timeoutMs?: number) {
  const app = Fastify()

  await app.register(readinessRoutes, { probe, timeoutMs })
  await app.ready()

  return app
}

describe('/health/ready', () => {
  it('responde 200 con PostgreSQL disponible', async () => {
    const app = await appWith(async () => 1)
    const response = await app.inject({ url: '/health/ready' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' })
  })

  it('responde 503 sin revelar el error', async () => {
    const app = await appWith(async () => {
      throw new Error('connect ECONNREFUSED postgresql://usuario:secreto@db:5432/x')
    })
    const response = await app.inject({ url: '/health/ready' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'unavailable', database: 'unavailable' })
    expect(response.body).not.toMatch(/secreto|postgresql|ECONNREFUSED/)
  })

  it('una base que no responde agota el tiempo y da 503', async () => {
    const app = await appWith(() => new Promise(() => undefined), 50)
    const started = Date.now()
    const response = await app.inject({ url: '/health/ready' })

    expect(response.statusCode).toBe(503)
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
