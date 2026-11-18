import type { AddressInfo } from 'node:net'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Contrato HTTP real del borrado de inmuebles: Fastify escuchando en localhost y peticiones con fetch,
// con las mismas cabeceras que envía el cliente web. Prisma y la limpieza de almacenamiento son dobles:
// no se toca ninguna base de datos ni ningún dato real.
//
// Regresión QA (2026-11-18): DELETE /api/properties/:id fallaba en producción con un mensaje genérico.
// En Fastify 5, DELETE admite cuerpo: con `Content-Type: application/json` y sin cuerpo, el parser JSON
// responde 400 FST_ERR_CTP_EMPTY_JSON_BODY antes de llegar a la ruta.

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  drain: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({
  prisma: { property: { findFirst: mocks.findFirst, delete: mocks.delete, deleteMany: mocks.deleteMany } },
}))
vi.mock('../media/storage-cleanup.js', () => ({ drainStorageCleanup: mocks.drain }))
vi.mock('../middleware/auth.middleware.js', () => ({
  requireAuth: async (request: { userId?: string | null }) => {
    request.userId = 'user-1'
  },
}))

import { propertyRoutes } from './property.routes.js'

const PROPERTY_ID = 'cjld2cjxh0000qzrmn831i7rn'

describe('DELETE /api/properties/:id sobre HTTP real', () => {
  let app: FastifyInstance
  let base: string

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue({ id: PROPERTY_ID, userId: 'user-1' })
    mocks.delete.mockResolvedValue({ id: PROPERTY_ID })
    mocks.deleteMany.mockResolvedValue({ count: 1 })
    mocks.drain.mockResolvedValue(undefined)
    app = Fastify()
    app.decorateRequest('userId', null)
    await app.register(propertyRoutes)
    await app.listen({ port: 0, host: '127.0.0.1' })
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await app.close()
  })

  it('reproduce el fallo: JSON declarado sin cuerpo se rechaza con 400 antes de borrar', async () => {
    const response = await fetch(`${base}/api/properties/${PROPERTY_ID}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'FST_ERR_CTP_EMPTY_JSON_BODY' })
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('borra el inmueble propio cuando la petición no declara cuerpo (forma del cliente web)', async () => {
    const response = await fetch(`${base}/api/properties/${PROPERTY_ID}`, { method: 'DELETE', credentials: 'include' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: PROPERTY_ID, userId: 'user-1' } })
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: PROPERTY_ID } })
  })

  it('el borrado múltiple, que sí lleva cuerpo JSON, mantiene su contrato', async () => {
    const response = await fetch(`${base}/api/properties`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [PROPERTY_ID] }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, deletedCount: 1 })
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [PROPERTY_ID] }, userId: 'user-1' } })
  })
})
