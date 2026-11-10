import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_URL } from '@/lib/api'
import { emailVerificationNotice } from '@/lib/emailVerificationNotice'
import {
  EMAIL_NOT_VERIFIED_MESSAGE,
  EmailNotVerifiedError,
  RESEND_VERIFICATION_RATE_LIMITED_MESSAGE,
  SessionBlockedError,
  getCurrentUser,
  isEmailNotVerifiedMessage,
  login,
  register,
  requestEmailVerification,
  sessionBlockReason,
  verifyEmail,
} from './authService'

// Fase 0: verificación del email en el cliente. Solo lógica, con fetch simulado.

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const NOT_VERIFIED_BODY = { code: 'EMAIL_NOT_VERIFIED', message: EMAIL_NOT_VERIFIED_MESSAGE }
const USER = { id: 'user-1', email: 'titular@estateforge.test', role: 'USER' as const }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('register', () => {
  it('con sesión devuelve el usuario', async () => {
    stubFetch(jsonResponse({ user: USER }, 201))

    await expect(register(USER.email, 'Contraseña-segura-1')).resolves.toEqual({ kind: 'session', user: USER })
  })

  it('si falta verificar el email devuelve el aviso sin usuario', async () => {
    stubFetch(jsonResponse({ verificationRequired: true, email: USER.email, message: 'Revisa tu correo.' }, 201))

    await expect(register(USER.email, 'Contraseña-segura-1')).resolves.toEqual({
      kind: 'verification_required',
      email: USER.email,
      message: 'Revisa tu correo.',
    })
  })
})

describe('login', () => {
  it('con el email sin verificar lanza EmailNotVerifiedError con el texto de la API', async () => {
    stubFetch(jsonResponse(NOT_VERIFIED_BODY, 403))

    const error = await login(USER.email, 'Contraseña-segura-1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EmailNotVerifiedError)
    expect((error as Error).message).toBe(EMAIL_NOT_VERIFIED_MESSAGE)
    expect(isEmailNotVerifiedMessage((error as Error).message)).toBe(true)
  })

  it('un 403 distinto no se confunde con la verificación', async () => {
    stubFetch(jsonResponse({ message: 'Otra cosa.' }, 403))

    const error = await login(USER.email, 'x').catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(EmailNotVerifiedError)
    expect((error as Error).message).toBe('Otra cosa.')
  })
})

describe('getCurrentUser', () => {
  it('devuelve el estado de verificación que envía /me', async () => {
    const emailVerification = { status: 'GRACE', graceUntil: '2027-01-01T00:00:00.000Z' }
    stubFetch(jsonResponse({ user: { ...USER, emailVerification } }, 200))

    await expect(getCurrentUser()).resolves.toEqual({ ...USER, emailVerification })
  })

  it('si /me cierra la sesión por falta de verificación lanza SessionBlockedError con el motivo', async () => {
    stubFetch(jsonResponse(NOT_VERIFIED_BODY, 403))

    const error = await getCurrentUser().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SessionBlockedError)
    expect((error as SessionBlockedError).reason).toBe('email_not_verified')
    expect((error as Error).message).toBe(EMAIL_NOT_VERIFIED_MESSAGE)
  })

  it('un 403 sin el código de verificación es un fallo normal', async () => {
    stubFetch(jsonResponse({ message: 'Prohibido.' }, 403))

    await expect(getCurrentUser()).rejects.toThrow('Failed to load session: 403')
  })

  it('sessionBlockReason reconoce el texto de la verificación', () => {
    expect(sessionBlockReason(EMAIL_NOT_VERIFIED_MESSAGE)).toBe('email_not_verified')
  })
})

describe('verifyEmail', () => {
  it('envía el token en el cuerpo y devuelve el mensaje de éxito', async () => {
    const fetchMock = stubFetch(jsonResponse({ verified: true, message: 'Email verificado. Ya puedes iniciar sesión.' }, 200))

    await expect(verifyEmail('e'.repeat(64))).resolves.toEqual({ ok: true, message: 'Email verificado. Ya puedes iniciar sesión.' })
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/auth/verify-email`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'e'.repeat(64) }),
    }))
  })

  it.each([
    ['EXPIRED', 'expired', 'El enlace de verificación ha caducado. Solicita uno nuevo.'],
    ['INVALID', 'invalid', 'El enlace de verificación no es válido o ya se ha usado.'],
  ])('un 400 %s se clasifica como %s con el texto de la API', async (code, reason, message) => {
    stubFetch(jsonResponse({ code, message }, 400))

    await expect(verifyEmail('e'.repeat(64))).resolves.toEqual({ ok: false, reason, message })
  })

  it('un 429 se clasifica como demasiados intentos', async () => {
    stubFetch(new Response(null, { status: 429 }))

    await expect(verifyEmail('e'.repeat(64))).resolves.toMatchObject({ ok: false, reason: 'rate_limited' })
  })

  it('un fallo de red o una respuesta inesperada no se presentan como enlace inválido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(verifyEmail('e'.repeat(64))).resolves.toMatchObject({ ok: false, reason: 'unexpected' })

    stubFetch(new Response(null, { status: 500 }))
    await expect(verifyEmail('e'.repeat(64))).resolves.toMatchObject({ ok: false, reason: 'unexpected' })
  })
})

describe('requestEmailVerification', () => {
  it('devuelve el mensaje genérico de la API', async () => {
    const fetchMock = stubFetch(jsonResponse({ message: 'Si la cuenta existe…' }, 200))

    await expect(requestEmailVerification(USER.email)).resolves.toBe('Si la cuenta existe…')
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/auth/verify-email/resend`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: USER.email }),
    }))
  })

  it('con 429 explica que hay que esperar', async () => {
    stubFetch(new Response(null, { status: 429 }))

    await expect(requestEmailVerification(USER.email)).rejects.toThrow(RESEND_VERIFICATION_RATE_LIMITED_MESSAGE)
  })
})

describe('emailVerificationNotice', () => {
  it('no avisa sin sesión, sin el dato o con el email verificado', () => {
    expect(emailVerificationNotice(null)).toBeNull()
    expect(emailVerificationNotice({})).toBeNull()
    expect(emailVerificationNotice({ emailVerification: { status: 'VERIFIED', graceUntil: null } })).toBeNull()
  })

  it('en el periodo de gracia avisa con la fecha límite', () => {
    const notice = emailVerificationNotice({ emailVerification: { status: 'GRACE', graceUntil: '2027-01-01T00:00:00.000Z' } })

    expect(notice?.title).toBe('Verifica tu email')
    expect(notice?.detail).toMatch(/antes del .*2027/)
  })

  it('en el periodo de gracia sin fecha de fin avisa sin fecha', () => {
    const notice = emailVerificationNotice({ emailVerification: { status: 'GRACE', graceUntil: null } })

    expect(notice?.detail).not.toMatch(/antes del/)
  })

  it('sin la verificación exigida (NOT_ENFORCED) no muestra ningún aviso', () => {
    expect(emailVerificationNotice({ emailVerification: { status: 'NOT_ENFORCED', graceUntil: null } })).toBeNull()
  })

  it('solo el periodo de gracia muestra aviso', () => {
    const shown = (['VERIFIED', 'NOT_ENFORCED', 'GRACE'] as const)
      .filter(status => emailVerificationNotice({ emailVerification: { status, graceUntil: null } }) !== null)
    expect(shown).toEqual(['GRACE'])
  })
})
