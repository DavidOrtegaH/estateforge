

import { API_URL } from '@/lib/api'

export interface AuthUser {
  id: string
  email: string
  role: 'USER' | 'OWNER'
}

async function extractErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as {
      message?: unknown
    }

    if (
      typeof body.message === 'string' &&
      body.message
    ) {
      return body.message
    }
  } catch {
    // Ignorar si la respuesta no es JSON.
  }

  return fallback
}

export async function register(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, turnstileToken }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(response, `Register failed: ${response.status}`),
    )
  }

  const data = (await response.json()) as { user: AuthUser }
  return data.user
}

export async function login(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, turnstileToken }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(response, `Login failed: ${response.status}`),
    )
  }

  const data = (await response.json()) as { user: AuthUser }
  return data.user
}

export async function requestPasswordReset(
  email: string,
  turnstileToken?: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, turnstileToken }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Password recovery failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

export async function resetPassword(
  token: string,
  password: string,
  turnstileToken?: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password, turnstileToken }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Password reset failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

// Recuperación obligatoria tras un incidente (E2.5). La API solo devuelve { message },
// así que los dos 400 que cierran el enlace se distinguen por su texto exacto.
const SECURITY_RECOVERY_INVALID_LINK_MESSAGE =
  'El enlace de recuperación no es válido o ha caducado.'
const SECURITY_RECOVERY_NO_LONGER_VALID_MESSAGE =
  'Este enlace ya no permite completar la recuperación de la cuenta. Contacta con soporte si sigues sin poder acceder.'

export type SecurityRecoveryErrorKind =
  // Token inválido, caducado o ya usado.
  | 'invalid_link'
  // El estado de seguridad de la cuenta ya no permite usar el enlace.
  | 'link_no_longer_valid'
  // 409: el email de destino está ocupado por otra cuenta.
  | 'email_unavailable'
  // Otro 400 (validación o Turnstile): se puede corregir y reintentar.
  | 'rejected'
  // Cualquier otra respuesta (429, 5xx...).
  | 'unexpected'

export class SecurityRecoveryError extends Error {
  readonly kind: SecurityRecoveryErrorKind

  constructor(message: string, kind: SecurityRecoveryErrorKind) {
    super(message)
    this.name = 'SecurityRecoveryError'
    this.kind = kind
  }
}

function securityRecoveryErrorKind(
  status: number,
  message: string,
): SecurityRecoveryErrorKind {
  if (status === 409) return 'email_unavailable'
  if (status !== 400) return 'unexpected'
  if (message === SECURITY_RECOVERY_INVALID_LINK_MESSAGE) return 'invalid_link'
  if (message === SECURITY_RECOVERY_NO_LONGER_VALID_MESSAGE) return 'link_no_longer_valid'
  return 'rejected'
}

export async function completeSecurityRecovery(
  token: string,
  password: string,
  turnstileToken?: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/security-recovery/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password, turnstileToken }),
  })

  if (!response.ok) {
    const message = await extractErrorMessage(
      response,
      `Security recovery failed: ${response.status}`,
    )

    throw new SecurityRecoveryError(
      message,
      securityRecoveryErrorKind(response.status, message),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

// Mensaje del 423 de login cuando la cuenta tiene la recuperación obligatoria pendiente.
// La API solo devuelve { message }, así que se reconoce por su texto exacto.
const PASSWORD_RESET_REQUIRED_MESSAGE =
  'Debes establecer una contraseña nueva antes de volver a acceder. Si no has recibido el enlace de recuperación, contacta con soporte.'

export function isSecurityRecoveryRequiredMessage(message: string): boolean {
  return message === PASSWORD_RESET_REQUIRED_MESSAGE
}

// Solicitud de un enlace nuevo de recuperación obligatoria (E4.1). Ningún mensaje de error
// incluye el email ni detalles del servidor: solo el texto de la API en un 400 o textos propios.
const SECURITY_RECOVERY_REQUEST_RATE_LIMITED_MESSAGE =
  'Has hecho demasiadas solicitudes. Inténtalo de nuevo más tarde.'
const SECURITY_RECOVERY_REQUEST_UNEXPECTED_MESSAGE =
  'No se ha podido enviar la solicitud. Inténtalo de nuevo en unos minutos.'

export type SecurityRecoveryRequestErrorKind =
  // 400: validación o Turnstile; el mensaje de la API indica qué corregir.
  | 'rejected'
  // 429: límite de solicitudes por IP.
  | 'rate_limited'
  // Cualquier otra respuesta, una respuesta no JSON o un fallo de red.
  | 'unexpected'

export class SecurityRecoveryRequestError extends Error {
  readonly kind: SecurityRecoveryRequestErrorKind

  constructor(message: string, kind: SecurityRecoveryRequestErrorKind) {
    super(message)
    this.name = 'SecurityRecoveryRequestError'
    this.kind = kind
  }
}

async function readMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: unknown }
    return typeof body.message === 'string' && body.message ? body.message : null
  } catch {
    return null
  }
}

export async function requestSecurityRecoveryLink(
  email: string,
  turnstileToken?: string,
): Promise<string> {
  let response: Response

  try {
    response = await fetch(`${API_URL}/api/auth/security-recovery/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstileToken }),
    })
  } catch {
    throw new SecurityRecoveryRequestError(SECURITY_RECOVERY_REQUEST_UNEXPECTED_MESSAGE, 'unexpected')
  }

  if (response.status === 429) {
    throw new SecurityRecoveryRequestError(SECURITY_RECOVERY_REQUEST_RATE_LIMITED_MESSAGE, 'rate_limited')
  }

  const message = await readMessage(response)

  if (response.ok && message) {
    return message
  }

  if (response.status === 400 && message) {
    throw new SecurityRecoveryRequestError(message, 'rejected')
  }

  throw new SecurityRecoveryRequestError(SECURITY_RECOVERY_REQUEST_UNEXPECTED_MESSAGE, 'unexpected')
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ currentPassword, newPassword }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Password change failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

export async function deleteAccount(
  currentPassword: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ currentPassword }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Account deletion failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Logout failed: ${response.status}`)
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    credentials: 'include',
  })

  if (response.status === 401) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to load session: ${response.status}`)
  }

  const data = (await response.json()) as { user: AuthUser }
  return data.user
}
export async function requestEmailChange(
  newEmail: string,
  currentPassword: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/change-email/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ newEmail, currentPassword }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Email change request failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

export async function verifyEmailChange(
  code: string,
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/change-email/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Email change verification failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { user: AuthUser }
  return data.user
}
