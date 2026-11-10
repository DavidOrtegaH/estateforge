import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_URL } from '@/lib/api'
import { emailVerificationNotice } from '@/lib/emailVerificationNotice'
import * as authService from '@/services/authService'
import {
  emailChangeCompletedMessage,
  loginWithSessionState,
  registerWithSessionState,
  updateEmailWithSessionState,
} from './authSession'

// Fase 0.3a: tras el login, el registro con sesión y el cambio de email, AuthProvider guarda el
// usuario que devuelven estas funciones. Se usa el authService real con fetch simulado por ruta,
// así que se comprueba el usuario resultante y cuántas veces se consulta /me de verdad.

const EMAIL = 'titular@estateforge.test'
const NEW_EMAIL = 'nuevo@estateforge.test'
const PASSWORD = 'Contraseña-segura-1!'
const CODE = '123456'
const BASE_USER = { id: 'user-1', email: EMAIL, role: 'USER' as const }
const GRACE = { status: 'GRACE' as const, graceUntil: '2099-01-01T00:00:00.000Z' }
const ME_USER = { ...BASE_USER, emailVerification: GRACE }

type Reply = () => Response | Promise<Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Cada ruta responde con su función; las rutas sin respuesta definida fallan la prueba.
function stubApi(routes: Record<string, Reply>) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).slice(API_URL.length)
    calls.push(path)
    const reply = routes[path]
    if (!reply) throw new Error(`Ruta no esperada en la prueba: ${path}`)
    return reply()
  })
  vi.stubGlobal('fetch', fetchMock)
  return { count: (path: string) => calls.filter(call => call === path).length }
}

const ME = '/api/auth/me'
const LOGIN = '/api/auth/login'
const REGISTER = '/api/auth/register'
const CHANGE = '/api/auth/change-email/verify'

// Formas en que puede fallar /me después de una operación correcta.
const ME_FAILURES: [string, Reply][] = [
  ['un error 500', () => json({ message: 'Error interno' }, 500)],
  ['un fallo de red', () => Promise.reject(new TypeError('Failed to fetch'))],
  ['un 401 (sin usuario)', () => json({ message: 'No autenticado' }, 401)],
  ['un 403 con EMAIL_NOT_VERIFIED', () => json({ code: 'EMAIL_NOT_VERIFIED', message: authService.EMAIL_NOT_VERIFIED_MESSAGE }, 403)],
]

let errorLog: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorLog.mockRestore()
  vi.unstubAllGlobals()
})

function expectNoSecretsLogged() {
  const logged = JSON.stringify(errorLog.mock.calls)
  expect(logged).not.toContain(PASSWORD)
  expect(logged).not.toContain(CODE)
}

describe('login', () => {
  it('el usuario incorpora el estado de verificación de /me y el aviso de gracia se puede mostrar', async () => {
    const api = stubApi({ [LOGIN]: () => json({ user: BASE_USER }), [ME]: () => json({ user: ME_USER }) })

    const user = await loginWithSessionState(authService, EMAIL, PASSWORD)

    expect(user).toEqual(ME_USER)
    expect(emailVerificationNotice(user)?.title).toBe('Verifica tu email')
    expect(api.count(LOGIN)).toBe(1)
    expect(api.count(ME)).toBe(1)
    expect(errorLog).not.toHaveBeenCalled()
  })

  it.each(ME_FAILURES)('si /me falla con %s, conserva el usuario del login y lo registra', async (_label, meReply) => {
    const api = stubApi({ [LOGIN]: () => json({ user: BASE_USER }), [ME]: meReply })

    const user = await loginWithSessionState(authService, EMAIL, PASSWORD)

    expect(user).toEqual(BASE_USER)
    expect(api.count(ME)).toBe(1)
    expect(errorLog).toHaveBeenCalledOnce()
    expectNoSecretsLogged()
  })

  it('un login fallido sigue fallando con el mensaje de la API y no consulta /me', async () => {
    const api = stubApi({ [LOGIN]: () => json({ message: 'Email o contraseña incorrectos.' }, 401) })

    await expect(loginWithSessionState(authService, EMAIL, PASSWORD)).rejects.toThrow('Email o contraseña incorrectos.')
    expect(api.count(ME)).toBe(0)
  })

  it('un email sin verificar sigue rechazando el login sin consultar /me', async () => {
    const api = stubApi({
      [LOGIN]: () => json({ code: 'EMAIL_NOT_VERIFIED', message: authService.EMAIL_NOT_VERIFIED_MESSAGE }, 403),
    })

    await expect(loginWithSessionState(authService, EMAIL, PASSWORD)).rejects.toBeInstanceOf(authService.EmailNotVerifiedError)
    expect(api.count(ME)).toBe(0)
  })
})

describe('registro', () => {
  it('con sesión, el usuario incorpora el estado de verificación de /me', async () => {
    const api = stubApi({ [REGISTER]: () => json({ user: BASE_USER }, 201), [ME]: () => json({ user: ME_USER }) })

    const result = await registerWithSessionState(authService, EMAIL, PASSWORD)

    expect(result).toEqual({ kind: 'session', user: ME_USER })
    if (result.kind === 'session') expect(emailVerificationNotice(result.user)).not.toBeNull()
    expect(api.count(REGISTER)).toBe(1)
    expect(api.count(ME)).toBe(1)
  })

  it('sin sesión (verificación exigida) devuelve el aviso tal cual y no consulta /me', async () => {
    const pending = { verificationRequired: true, email: EMAIL, message: 'Cuenta creada. Revisa tu correo.' }
    const api = stubApi({ [REGISTER]: () => json(pending, 201) })

    const result = await registerWithSessionState(authService, EMAIL, PASSWORD)

    expect(result).toEqual({ kind: 'verification_required', email: EMAIL, message: pending.message })
    expect(api.count(ME)).toBe(0)
  })

  it.each(ME_FAILURES)('con sesión, si /me falla con %s, conserva el usuario del registro', async (_label, meReply) => {
    const api = stubApi({ [REGISTER]: () => json({ user: BASE_USER }, 201), [ME]: meReply })

    const result = await registerWithSessionState(authService, EMAIL, PASSWORD)

    expect(result).toEqual({ kind: 'session', user: BASE_USER })
    expect(api.count(ME)).toBe(1)
    expect(errorLog).toHaveBeenCalledOnce()
    expectNoSecretsLogged()
  })

  it('un registro fallido sigue fallando y no consulta /me', async () => {
    const api = stubApi({ [REGISTER]: () => json({ message: 'Ese email ya está registrado.' }, 409) })

    await expect(registerWithSessionState(authService, EMAIL, PASSWORD)).rejects.toThrow('Ese email ya está registrado.')
    expect(api.count(ME)).toBe(0)
  })
})

describe('cambio de email', () => {
  // Con la decisión D1, /me devuelve la cuenta verificada tras el cambio: el aviso desaparece.
  const VERIFIED = { status: 'VERIFIED' as const, graceUntil: null }

  it('el usuario es el de /me, con el email nuevo y su estado de verificación', async () => {
    const changed = { ...BASE_USER, email: NEW_EMAIL }
    const fromMe = { ...changed, emailVerification: VERIFIED }
    const api = stubApi({
      [CHANGE]: () => json({ user: changed, securityNoticeSent: true, message: 'Email actualizado correctamente.' }),
      [ME]: () => json({ user: fromMe }),
    })

    const result = await updateEmailWithSessionState(authService, CODE)

    expect(result).toEqual({ user: fromMe, securityNoticeSent: true })
    expect(emailVerificationNotice(result.user)).toBeNull()
    expect(api.count(CHANGE)).toBe(1)
    expect(api.count(ME)).toBe(1)
  })

  it.each(ME_FAILURES)('si /me falla con %s, conserva el usuario del cambio y no lo presenta como fallido', async (_label, meReply) => {
    const changed = { ...BASE_USER, email: NEW_EMAIL }
    const api = stubApi({ [CHANGE]: () => json({ user: changed, securityNoticeSent: true }), [ME]: meReply })

    const result = await updateEmailWithSessionState(authService, CODE)

    expect(result).toEqual({ user: changed, securityNoticeSent: true })
    expect(api.count(ME)).toBe(1)
    expect(errorLog).toHaveBeenCalledOnce()
    expectNoSecretsLogged()
  })

  it('aviso fallido (D4): el cambio se da por hecho y se conserva securityNoticeSent: false', async () => {
    const changed = { ...BASE_USER, email: NEW_EMAIL }
    const fromMe = { ...changed, emailVerification: VERIFIED }
    const api = stubApi({
      [CHANGE]: () => json({ user: changed, securityNoticeSent: false, message: 'Email actualizado correctamente, pero no hemos podido enviar el aviso…' }),
      [ME]: () => json({ user: fromMe }),
    })

    const result = await updateEmailWithSessionState(authService, CODE)

    expect(result).toEqual({ user: fromMe, securityNoticeSent: false })
    expect(api.count(ME)).toBe(1)
  })

  it('una respuesta sin securityNoticeSent (API anterior) se trata como aviso enviado', async () => {
    const changed = { ...BASE_USER, email: NEW_EMAIL }
    stubApi({ [CHANGE]: () => json({ user: changed, message: 'Email actualizado correctamente.' }), [ME]: () => json({ user: changed }) })

    expect((await updateEmailWithSessionState(authService, CODE)).securityNoticeSent).toBe(true)
  })

  it('un código incorrecto sigue fallando con el mensaje de la API y no consulta /me', async () => {
    const api = stubApi({ [CHANGE]: () => json({ message: 'El código de verificación no es válido.' }, 400) })

    await expect(updateEmailWithSessionState(authService, CODE)).rejects.toThrow('El código de verificación no es válido.')
    expect(api.count(ME)).toBe(0)
  })
})

describe('mensaje tras confirmar el cambio de email (D4)', () => {
  const user = { ...BASE_USER, email: NEW_EMAIL }

  it('con el aviso enviado, el mensaje de siempre', () => {
    expect(emailChangeCompletedMessage({ user, securityNoticeSent: true })).toBe(`Email actualizado correctamente a ${NEW_EMAIL}.`)
  })

  it('con el aviso fallido, confirma el cambio, explica el aviso y no invita a repetirlo', () => {
    const message = emailChangeCompletedMessage({ user, securityNoticeSent: false })

    expect(message).toBe(
      `Email actualizado correctamente a ${NEW_EMAIL}. No hemos podido enviar el aviso de seguridad a tu dirección anterior; no hace falta repetir el cambio.`,
    )
    expect(message).not.toMatch(/inténtalo de nuevo|error/i)
  })
})
