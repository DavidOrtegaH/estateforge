import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_URL } from '@/lib/api'
import {
  completeSecurityRecovery,
  getCurrentUser,
  login,
  SecurityRecoveryError,
} from './authService'

const RESET_REQUIRED_MESSAGE =
  'Debes establecer una contraseña nueva antes de volver a acceder. Si no has recibido el enlace de recuperación, contacta con soporte.'

function stubFetch(response: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('authService ante un 423', () => {
  // LoginPage muestra error.message tal cual: el texto específico lo pone la API.
  it('login lanza el mensaje de la API para la recuperación obligatoria', async () => {
    stubFetch(jsonResponse({ message: RESET_REQUIRED_MESSAGE }, 423))

    await expect(login('titular@estateforge.test', 'contraseña')).rejects.toThrow(RESET_REQUIRED_MESSAGE)
  })

  it('login usa un texto genérico si el 423 no trae mensaje', async () => {
    stubFetch(new Response(null, { status: 423 }))

    await expect(login('titular@estateforge.test', 'contraseña')).rejects.toThrow('Login failed: 423')
  })

  // AuthProvider captura el error y deja al usuario sin sesión.
  it('getCurrentUser no devuelve un usuario si /me responde 423', async () => {
    stubFetch(jsonResponse({ message: RESET_REQUIRED_MESSAGE }, 423))

    await expect(getCurrentUser()).rejects.toThrow('Failed to load session: 423')
  })
})

describe('completeSecurityRecovery', () => {
  // Valores de prueba, no reales.
  const TOKEN = 'c'.repeat(64)
  const PASSWORD = 'Nueva-Contrasena-Segura-1'
  const INVALID_LINK = 'El enlace de recuperación no es válido o ha caducado.'
  const NO_LONGER_VALID = 'Este enlace ya no permite completar la recuperación de la cuenta. Contacta con soporte si sigues sin poder acceder.'
  const EMAIL_UNAVAILABLE = 'No se ha podido completar la recuperación porque el email de recuperación no está disponible. Contacta con soporte.'

  async function rejection(promise: Promise<unknown>): Promise<SecurityRecoveryError> {
    const error = await promise.then(() => null, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(SecurityRecoveryError)
    // Sigue siendo un Error normal para el código que solo lee .message.
    expect(error).toBeInstanceOf(Error)
    return error as SecurityRecoveryError
  }

  it('envía POST al endpoint de recuperación con token, contraseña y Turnstile', async () => {
    stubFetch(jsonResponse({ message: 'Contraseña establecida.' }, 200))

    await completeSecurityRecovery(TOKEN, PASSWORD, 'turnstile-de-prueba')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(`${API_URL}/api/auth/security-recovery/complete`)
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    // Exactamente los campos del contrato de la API, ni uno más.
    expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN, password: PASSWORD, turnstileToken: 'turnstile-de-prueba' })
  })

  it('sin Turnstile configurado no envía el campo, como resetPassword', async () => {
    stubFetch(jsonResponse({ message: 'ok' }, 200))

    await completeSecurityRecovery(TOKEN, PASSWORD)

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ token: TOKEN, password: PASSWORD })
  })

  it('devuelve el mensaje de éxito de la API', async () => {
    stubFetch(jsonResponse({ message: 'Contraseña establecida y acceso recuperado.' }, 200))

    await expect(completeSecurityRecovery(TOKEN, PASSWORD)).resolves.toBe('Contraseña establecida y acceso recuperado.')
  })

  it.each([
    ['400 de enlace inválido', 400, INVALID_LINK, 'invalid_link'],
    ['400 de state_mismatch', 400, NO_LONGER_VALID, 'link_no_longer_valid'],
    ['409 de email ocupado', 409, EMAIL_UNAVAILABLE, 'email_unavailable'],
    ['400 de validación', 400, 'La contraseña debe tener entre 12 y 128 caracteres.', 'rejected'],
    ['400 de Turnstile', 400, 'No se ha podido completar la verificación de seguridad. Inténtalo de nuevo.', 'rejected'],
    ['429 del rate limit', 429, 'Rate limit exceeded', 'unexpected'],
    ['500', 500, 'Error interno', 'unexpected'],
  ])('clasifica un %s', async (_label, status, message, kind) => {
    stubFetch(jsonResponse({ message }, status))

    const error = await rejection(completeSecurityRecovery(TOKEN, PASSWORD))

    expect(error.kind).toBe(kind)
    expect(error.message).toBe(message)
  })

  it('un 409 se clasifica por el estado, aunque el mensaje cambie', async () => {
    stubFetch(jsonResponse({ message: 'Otro texto' }, 409))

    expect((await rejection(completeSecurityRecovery(TOKEN, PASSWORD))).kind).toBe('email_unavailable')
  })

  it('un error sin cuerpo JSON mantiene el texto genérico de los demás servicios', async () => {
    stubFetch(new Response(null, { status: 502 }))

    const error = await rejection(completeSecurityRecovery(TOKEN, PASSWORD))

    expect(error.message).toBe('Security recovery failed: 502')
    expect(error.kind).toBe('unexpected')
  })

  it('un fallo de red se propaga sin transformar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(completeSecurityRecovery(TOKEN, PASSWORD)).rejects.toThrow(TypeError)
  })
})
