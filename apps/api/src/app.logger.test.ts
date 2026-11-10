import { describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ findSession: vi.fn() }))

vi.mock('./db/prisma.js', () => ({ prisma: { session: { findUnique: db.findSession } } }))

import { buildApp } from './app.js'
import { requestWorkOf } from './request-work.js'

// Revisión de la Fase 1: la app real debe escribir los avisos y errores. Con logger: false,
// request.log y app.log no escriben nada, aunque las pruebas con un Fastify propio pasen.
describe('registro de la API real', () => {
  it('escribe errores y avisos, pero no las peticiones (sus URL pueden llevar un token)', async () => {
    const app = await buildApp()
    try {
      expect(app.log.level).toBe('warn')
      expect(requestWorkOf(app)).toBeDefined()
    } finally {
      await app.close()
    }
  })
})

// M-2: buildApp debe instalar el seguimiento antes de registrar las rutas. GET /api/auth/me la
// registra el propio buildApp, y su manejador queda retenido en la consulta de la sesión, sustituida
// por un doble: si el seguimiento se instalara después de las rutas, este trabajo no se contaría.
describe('seguimiento del trabajo en la API real (M-2)', () => {
  it('cuenta el trabajo de una ruta registrada por buildApp mientras su manejador sigue pendiente', async () => {
    let markStarted: () => void = () => undefined
    const started = new Promise<void>(resolve => { markStarted = resolve })
    let releaseSession: (session: null) => void = () => undefined
    const session = new Promise<null>(resolve => { releaseSession = resolve })
    db.findSession.mockImplementationOnce(() => {
      markStarted()
      return session
    })
    const tcpHandles = () => process.getActiveResourcesInfo().filter(resource => resource.startsWith('TCP')).length
    const tcpBefore = tcpHandles()

    const app = await buildApp()
    let response: Promise<{ statusCode: number }> | undefined
    try {
      // No se añade ninguna ruta: esta la ha registrado buildApp.
      expect(app.hasRoute({ method: 'GET', url: '/api/auth/me' })).toBe(true)
      const work = requestWorkOf(app)
      expect(work?.running()).toBe(0)

      response = app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `estateforge_session=${'a'.repeat(64)}` } })
      await started

      // El manejador sigue pendiente: aún no hay respuesta.
      expect(work?.running()).toBe(1)

      releaseSession(null)
      expect((await response).statusCode).toBe(401)
      await vi.waitFor(() => expect(work?.running()).toBe(0))
    } finally {
      releaseSession(null)
      await response?.catch(() => undefined)
      await app.close()
    }

    expect(db.findSession).toHaveBeenCalledOnce()
    expect(app.server.listening).toBe(false)
    expect(tcpHandles()).toBe(tcpBefore)
  })
})
