import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Respuesta del manejador real de buildApp a un fallo de la base (DA-37). La sesión se consulta en
// GET /api/auth/me, una ruta de buildApp; su consulta se sustituye por las formas de error reales.

const db = vi.hoisted(() => ({ findSession: vi.fn() }))

vi.mock('./db/prisma.js', () => ({ prisma: { session: { findUnique: db.findSession } } }))

import { DATABASE_UNAVAILABLE_BODY } from './db/availability.js'

const HOST = '10.20.30.40'
const SQL = 'SELECT "Session"."tokenHash" FROM "public"."Session"'

function prismaKnown(code: string, message: string, cause?: Record<string, unknown>) {
  return Object.assign(new Error(message), {
    name: 'PrismaClientKnownRequestError',
    code,
    meta: cause ? { driverAdapterError: { name: 'DriverAdapterError', cause } } : {},
  })
}

let app: FastifyInstance
// Avisos que registra cada petición (request.log.warn), para comprobar qué campos se escriben.
const warnings: unknown[][] = []

const me = () => app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `estateforge_session=${'a'.repeat(64)}` } })

beforeAll(async () => {
  const { buildApp } = await import('./app.js')
  app = await buildApp()
  app.addHook('onRequest', (request, _reply, done) => {
    const original = request.log.warn.bind(request.log)
    request.log.warn = ((...args: unknown[]) => {
      warnings.push(args)
      return (original as (...a: unknown[]) => void)(...args)
    }) as typeof request.log.warn
    done()
  })
  await app.ready()
})

afterAll(() => app.close())

beforeEach(() => {
  db.findSession.mockReset()
  warnings.length = 0
})

describe('base de datos no disponible: 503 (DA-37)', () => {
  it.each([
    ['límite de conexiones (P2037)', prismaKnown('P2037', `Too many database connections opened: too many connections for role "ef_app" at ${HOST}`, { originalCode: '53300', kind: 'TooManyConnections' })],
    ['servidor inaccesible (P1001)', prismaKnown('P1001', `Can't reach database server at ${HOST}:5432`, { kind: 'DatabaseNotReachable', host: HOST, port: 5432 })],
    ['tiempo agotado del pool', new Error('timeout exceeded when trying to connect')],
    ['pool cerrado', new Error('Cannot use a pool after calling end on the pool')],
    ['backend terminado (57P01)', prismaKnown('P2010', `Raw query failed. Code: \`57P01\`. ${SQL}`, { originalCode: '57P01', kind: 'postgres', code: '57P01' })],
  ])('%s: 503 con Retry-After y sin detalles', async (_label, error) => {
    db.findSession.mockRejectedValue(error)

    const response = await me()

    expect(response.statusCode).toBe(503)
    expect(response.headers['retry-after']).toBe('5')
    expect(response.json()).toEqual(DATABASE_UNAVAILABLE_BODY)
    for (const secret of [HOST, 'Session', '53300', '57P01', 'P2037', 'P1001', 'pool', 'role', 'SELECT']) {
      expect(response.body).not.toContain(secret)
    }
  })

  it.each([
    ['violación de unicidad (P2002)', prismaKnown('P2002', `Unique constraint failed on ${SQL}`, { originalCode: '23505', kind: 'UniqueConstraintViolation' })],
    ['violación de CHECK (P2039)', prismaKnown('P2039', 'check constraint "User_email_lowercase"', { originalCode: '23514', kind: 'postgres', code: '23514', detail: 'Failing row contains (secreto@example.test)' })],
    ['error de programación', new TypeError('Cannot read properties of undefined (reading "id")')],
    ['tabla inexistente (42P01)', prismaKnown('P2010', `relation "Session" does not exist: ${SQL}`, { originalCode: '42P01', kind: 'TableDoesNotExist' })],
  ])('%s: sigue siendo un 500 genérico, no un 503', async (_label, error) => {
    db.findSession.mockRejectedValue(error)

    const response = await me()

    expect(response.statusCode).toBe(500)
    expect(response.headers['retry-after']).toBeUndefined()
    expect(response.json()).toEqual({ message: 'Error interno del servidor' })
    expect(response.body).not.toMatch(/Session|SELECT|secreto|23514|23505|42P01/)
  })

  it('el log registra solo campos cerrados: ni el mensaje, ni el host, ni la URL de conexión', async () => {
    db.findSession.mockRejectedValue(prismaKnown('P1001', `Can't reach database server at postgresql://usuario:clave@${HOST}:5432/estateforge`, { kind: 'DatabaseNotReachable', host: HOST, port: 5432 }))

    await me()

    expect(warnings).toEqual([[{ dbUnavailable: 'unreachable', errorName: 'PrismaClientKnownRequestError', errorCode: 'P1001' }, 'Base de datos no disponible']])
    expect(JSON.stringify(warnings)).not.toMatch(/postgresql:|clave|10\.20\.30\.40|5432/)
  })

  it('la API se recupera en cuanto la base vuelve a responder', async () => {
    db.findSession.mockRejectedValueOnce(new Error('timeout exceeded when trying to connect'))
    db.findSession.mockResolvedValueOnce(null)

    expect((await me()).statusCode).toBe(503)
    expect((await me()).statusCode).toBe(401)
  })

  it('/health no depende de la base', async () => {
    db.findSession.mockRejectedValue(new Error('timeout exceeded when trying to connect'))

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(db.findSession).not.toHaveBeenCalled()
  })
})
