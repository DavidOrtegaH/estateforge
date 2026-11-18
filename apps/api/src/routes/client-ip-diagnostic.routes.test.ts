import Fastify, { type FastifyReply } from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import { CLIENT_IP_DIAGNOSTIC_MAX_WINDOW_MS, CLIENT_IP_DIAGNOSTIC_PATH, clientIpDiagnosticRoutes, diagnosticWindowEnd } from './client-ip-diagnostic.routes.js'

// Diagnóstico temporal de MD-4. Sin base de datos: la autorización (requireOwner) se sustituye por un
// doble; su comportamiento real (USER 403, OWNER 200) se prueba en account-isolation.integration.test.ts.

const NOW = Date.parse('2026-11-18T10:00:00.000Z')
const inHours = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString()
const allow = vi.fn(async () => undefined)
const deny = vi.fn(async (_request: unknown, reply: FastifyReply) => {
  reply.code(403).send({ message: 'No tienes permisos para acceder a esta sección.' })
})

async function appWith(env: NodeJS.ProcessEnv, options: { now?: () => number; guard?: typeof allow | typeof deny } = {}) {
  const app = Fastify()
  await app.register(clientIpDiagnosticRoutes, { env, now: options.now ?? (() => NOW), guard: options.guard ?? allow })
  await app.ready()
  return app
}

describe('ventana del diagnóstico', () => {
  it('solo una fecha ISO 8601 futura y como mucho a 72 h', () => {
    expect(diagnosticWindowEnd(inHours(1), NOW)).toBe(NOW + 3_600_000)
    expect(diagnosticWindowEnd(inHours(72), NOW)).toBe(NOW + CLIENT_IP_DIAGNOSTIC_MAX_WINDOW_MS)
    expect(diagnosticWindowEnd('2026-11-18T12:00:00+01:00', NOW)).toBe(Date.parse('2026-11-18T11:00:00Z'))
    for (const value of [undefined, '', '   ', inHours(-1), new Date(NOW).toISOString(), inHours(72.01), inHours(24 * 365), '2026-11-19', 'mañana', '1763460000000', '2026-11-18T25:00:00Z', 'true']) {
      expect(diagnosticWindowEnd(value, NOW), String(value)).toBeNull()
    }
  })
})

describe('ruta de diagnóstico de la IP del cliente', () => {
  it('sin CLIENT_IP_DIAGNOSTIC_UNTIL no existe: igual que una ruta desconocida', async () => {
    const app = await appWith({})
    const response = await app.inject({ url: CLIENT_IP_DIAGNOSTIC_PATH })
    const unknown = await app.inject({ url: '/api/admin/diagnostics/otra' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ ...unknown.json(), message: response.json().message })
    expect(allow).not.toHaveBeenCalled()
  })

  it('con la ventana vencida (o demasiado larga) responde 404 sin comprobar la sesión ni devolver datos', async () => {
    for (const until of [inHours(-0.1), inHours(100)]) {
      allow.mockClear()
      const app = await appWith({ CLIENT_IP_DIAGNOSTIC_UNTIL: until })
      const response = await app.inject({ url: CLIENT_IP_DIAGNOSTIC_PATH, remoteAddress: '203.0.113.7' })
      expect(response.statusCode, until).toBe(404)
      expect(response.body).not.toContain('203.0.113.7')
      expect(allow).not.toHaveBeenCalled()
    }
  })

  it('caduca sola: abierta a las 10:00 con fin a las 11:00, a las 11:00 ya no responde', async () => {
    let clock = NOW
    const app = await appWith({ CLIENT_IP_DIAGNOSTIC_UNTIL: inHours(1) }, { now: () => clock })
    expect((await app.inject({ url: CLIENT_IP_DIAGNOSTIC_PATH })).statusCode).toBe(200)
    clock = NOW + 3_600_000
    expect((await app.inject({ url: CLIENT_IP_DIAGNOSTIC_PATH })).statusCode).toBe(404)
  })

  it('sin permiso de OWNER: 403 y no se ejecuta', async () => {
    const app = await appWith({ CLIENT_IP_DIAGNOSTIC_UNTIL: inHours(2) }, { guard: deny })
    const response = await app.inject({ url: CLIENT_IP_DIAGNOSTIC_PATH, remoteAddress: '203.0.113.8' })
    expect(response.statusCode).toBe(403)
    expect(response.body).not.toContain('203.0.113.8')
  })

  it('devuelve solo direcciones de la propia petición, sin caché, y muestra que las cabeceras del cliente no cambian la IP del modo socket', async () => {
    const app = await appWith({ CLIENT_IP_DIAGNOSTIC_UNTIL: inHours(2) })
    const response = await app.inject({
      url: CLIENT_IP_DIAGNOSTIC_PATH,
      remoteAddress: '198.51.100.20',
      headers: {
        host: 'estateforge-api.vercel.app',
        // Cabeceras falsificadas por el cliente: se muestran tal cual, pero no cambian la IP en modo socket.
        'x-forwarded-for': '1.2.3.4',
        'x-vercel-forwarded-for': '1.2.3.4',
        'x-real-ip': '1.2.3.4',
        cookie: 'estateforge_session=secreto-de-sesion',
        authorization: 'Bearer secreto-del-cron-0123456789',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const body = response.json()
    expect(body).toEqual({
      observedAt: new Date(NOW).toISOString(),
      expiresAt: inHours(2),
      host: 'estateforge-api.vercel.app',
      socketIp: '198.51.100.20',
      headers: { 'x-forwarded-for': '1.2.3.4', 'x-vercel-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4', forwarded: null, 'x-vercel-id': null },
      clientIp: { configuredSource: 'socket', socket: '198.51.100.20', vercel: '1.2.3.4' },
    })
    // Fuera de Vercel cualquiera puede escribir X-Vercel-Forwarded-For: por eso «vercel» solo se admite con VERCEL=1.
    expect(response.body).not.toMatch(/secreto|estateforge_session|Bearer/)
  })

  it('recorta cabeceras largas y no falla con una CLIENT_IP_SOURCE no válida', async () => {
    const app = await appWith({ CLIENT_IP_DIAGNOSTIC_UNTIL: inHours(2), CLIENT_IP_SOURCE: 'headers' })
    const response = await app.inject({ url: CLIENT_IP_DIAGNOSTIC_PATH, headers: { 'x-forwarded-for': '9.9.9.9, '.repeat(100) } })
    expect(response.json().headers['x-forwarded-for'].length).toBeLessThanOrEqual(201)
    expect(response.json().clientIp.configuredSource).toBe('invalid')
  })
})
