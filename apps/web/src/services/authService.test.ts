import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_URL } from '@/lib/api'
import {
  completeSecurityRecovery,
  getCurrentUser,
  isSecurityRecoveryRequiredMessage,
  login,
  requestSecurityRecoveryLink,
  SecurityRecoveryError,
  SecurityRecoveryRequestError,
  SessionBlockedError,
  sessionBlockReason,
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

  // AuthProvider captura el error y deja al usuario sin sesión; ahora conserva el motivo.
  it('getCurrentUser no devuelve un usuario si /me responde 423 y conserva el motivo', async () => {
    stubFetch(jsonResponse({ message: RESET_REQUIRED_MESSAGE }, 423))

    const error = await getCurrentUser().then(() => null, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(SessionBlockedError)
    expect((error as SessionBlockedError).message).toBe(RESET_REQUIRED_MESSAGE)
    expect((error as SessionBlockedError).reason).toBe('recovery_required')
  })
})

const SECURITY_HOLD_MESSAGE =
  'La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.'
const ADMIN_SUSPENSION_MESSAGE =
  'La cuenta está suspendida por el equipo de EstateForge. Contacta con soporte.'

describe('getCurrentUser', () => {
  it('devuelve el usuario con una sesión válida', async () => {
    const user = { id: 'u1', email: 'titular@estateforge.test', role: 'USER' }
    stubFetch(jsonResponse({ user }, 200))

    await expect(getCurrentUser()).resolves.toEqual(user)
  })

  it('pide /me con las cookies de la sesión', async () => {
    stubFetch(jsonResponse({ user: { id: 'u1', email: 'a@b.test', role: 'USER' } }, 200))

    await getCurrentUser()
    expect(fetch).toHaveBeenCalledWith(`${API_URL}/api/auth/me`, { credentials: 'include' })
  })

  it('devuelve null sin sesión (401), sin tratarlo como un cierre por el estado de la cuenta', async () => {
    stubFetch(jsonResponse({ message: 'La sesión no es válida o ha expirado.' }, 401))

    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it.each([
    [SECURITY_HOLD_MESSAGE, 'security_hold'],
    [ADMIN_SUSPENSION_MESSAGE, 'admin_suspension'],
    [RESET_REQUIRED_MESSAGE, 'recovery_required'],
    ['Otro motivo que la API pudiera dar.', 'unknown'],
  ] as const)('ante un 423 lanza SessionBlockedError con el texto exacto de la API (%s)', async (message, reason) => {
    stubFetch(jsonResponse({ message }, 423))

    const error = await getCurrentUser().then(() => null, (failure: unknown) => failure)
    expect(error).toBeInstanceOf(SessionBlockedError)
    expect((error as SessionBlockedError).message).toBe(message)
    expect((error as SessionBlockedError).reason).toBe(reason)
  })

  it('un 423 sin mensaje se trata como cualquier otro fallo, sin inventar un motivo', async () => {
    stubFetch(new Response(null, { status: 423 }))

    const error = await getCurrentUser().then(() => null, (failure: unknown) => failure)
    expect(error).not.toBeInstanceOf(SessionBlockedError)
    expect((error as Error).message).toBe('Failed to load session: 423')
  })

  it.each([403, 500, 503])('otros estados (%i) mantienen su error genérico', async (status) => {
    stubFetch(jsonResponse({ message: 'Detalle interno' }, status))

    const error = await getCurrentUser().then(() => null, (failure: unknown) => failure)
    expect(error).not.toBeInstanceOf(SessionBlockedError)
    expect((error as Error).message).toBe(`Failed to load session: ${status}`)
  })

  it('un fallo de red rechaza como el propio fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(getCurrentUser()).rejects.toThrow(TypeError)
  })
})

describe('sessionBlockReason', () => {
  it('clasifica solo los textos exactos de la API', () => {
    expect(sessionBlockReason(SECURITY_HOLD_MESSAGE)).toBe('security_hold')
    expect(sessionBlockReason(ADMIN_SUSPENSION_MESSAGE)).toBe('admin_suspension')
    expect(sessionBlockReason(RESET_REQUIRED_MESSAGE)).toBe('recovery_required')
    expect(sessionBlockReason(`${SECURITY_HOLD_MESSAGE} `)).toBe('unknown')
    expect(sessionBlockReason('')).toBe('unknown')
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

describe('requestSecurityRecoveryLink', () => {
  // Valores de prueba, no reales.
  const EMAIL = 'titular@estateforge.test'
  const GENERIC = 'Si la cuenta puede recuperar el acceso, recibirás instrucciones en el destino de recuperación registrado.'
  const RATE_LIMITED = 'Has hecho demasiadas solicitudes. Inténtalo de nuevo más tarde.'
  const UNEXPECTED = 'No se ha podido enviar la solicitud. Inténtalo de nuevo en unos minutos.'

  async function rejection(promise: Promise<unknown>): Promise<SecurityRecoveryRequestError> {
    const error = await promise.then(() => null, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(SecurityRecoveryRequestError)
    expect(error).toBeInstanceOf(Error)
    const requestError = error as SecurityRecoveryRequestError
    // Ningún mensaje de error repite el email introducido.
    expect(requestError.message).not.toContain(EMAIL)
    return requestError
  }

  it('envía POST al endpoint de solicitud con el email y Turnstile, sin cookie', async () => {
    stubFetch(jsonResponse({ message: GENERIC }, 200))

    await requestSecurityRecoveryLink(EMAIL, 'turnstile-de-prueba')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(`${API_URL}/api/auth/security-recovery/request`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    // La API acepta este esquema estricto: exactamente estos campos, ni uno más.
    expect(JSON.parse(String(init?.body))).toEqual({ email: EMAIL, turnstileToken: 'turnstile-de-prueba' })
    // Ruta pública: no se envía la cookie de sesión.
    expect(init).not.toHaveProperty('credentials')
    expect(Object.keys(init ?? {}).sort()).toEqual(['body', 'headers', 'method'])
  })

  it('sin Turnstile configurado no envía el campo', async () => {
    stubFetch(jsonResponse({ message: GENERIC }, 200))

    await requestSecurityRecoveryLink(EMAIL)

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ email: EMAIL })
  })

  it('devuelve el mensaje genérico de la API', async () => {
    stubFetch(jsonResponse({ message: GENERIC }, 200))

    await expect(requestSecurityRecoveryLink(EMAIL)).resolves.toBe(GENERIC)
  })

  it.each([
    ['de validación', 'Introduce un email válido.'],
    ['de Turnstile', 'No se ha podido completar la verificación de seguridad. Inténtalo de nuevo.'],
  ])('un 400 %s es rejected y conserva el mensaje de la API', async (_label, message) => {
    stubFetch(jsonResponse({ message }, 400))

    const error = await rejection(requestSecurityRecoveryLink(EMAIL))

    expect(error.kind).toBe('rejected')
    expect(error.message).toBe(message)
  })

  it('un 429 es rate_limited con un mensaje propio en español, no el del servidor', async () => {
    stubFetch(jsonResponse({ statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded, retry in 15 minutes' }, 429))

    const error = await rejection(requestSecurityRecoveryLink(EMAIL))

    expect(error.kind).toBe('rate_limited')
    expect(error.message).toBe(RATE_LIMITED)
  })

  it.each([
    ['un 500 con mensaje', () => jsonResponse({ message: 'Error interno: detalle del servidor' }, 500)],
    ['un 502 sin cuerpo', () => new Response(null, { status: 502 })],
    ['un 400 sin mensaje', () => jsonResponse({}, 400)],
    ['un 400 no JSON', () => new Response('<html>Bad Request</html>', { status: 400 })],
    ['un 200 no JSON', () => new Response('<html>ok</html>', { status: 200 })],
    ['un 200 sin mensaje', () => jsonResponse({}, 200)],
  ])('%s es unexpected y no expone detalles del servidor', async (_label, makeResponse) => {
    stubFetch(makeResponse())

    const error = await rejection(requestSecurityRecoveryLink(EMAIL))

    expect(error.kind).toBe('unexpected')
    expect(error.message).toBe(UNEXPECTED)
  })

  it('un fallo de red es unexpected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const error = await rejection(requestSecurityRecoveryLink(EMAIL))

    expect(error.kind).toBe('unexpected')
    expect(error.message).toBe(UNEXPECTED)
  })
})

describe('isSecurityRecoveryRequiredMessage', () => {
  it('reconoce el texto exacto del 423 de recuperación pendiente', () => {
    expect(isSecurityRecoveryRequiredMessage(RESET_REQUIRED_MESSAGE)).toBe(true)
  })

  it.each([
    ['otro 423', 'La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.'],
    ['la suspensión', 'La cuenta está suspendida por el equipo de EstateForge. Contacta con soporte.'],
    ['credenciales incorrectas', 'Credenciales incorrectas.'],
    ['el texto con espacios', ` ${RESET_REQUIRED_MESSAGE} `],
    ['el texto en minúsculas', RESET_REQUIRED_MESSAGE.toLowerCase()],
    ['solo una parte', 'Debes establecer una contraseña nueva antes de volver a acceder.'],
    ['un texto vacío', ''],
  ])('no reconoce %s', (_label, message) => {
    expect(isSecurityRecoveryRequiredMessage(message)).toBe(false)
  })
})
