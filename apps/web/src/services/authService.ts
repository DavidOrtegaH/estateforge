

import { API_URL } from '@/lib/api'

export interface AuthUser {
  id: string
  email: string
  role: 'USER' | 'OWNER'
  // Estado de la verificación del email que devuelve /me (Fase 0). No lo traen el login, el
  // registro ni el cambio de email: AuthProvider lo completa con /me (lib/authSession.ts).
  // GRACE incluye la fecha hasta la que la cuenta puede entrar sin verificar.
  emailVerification?: EmailVerificationState
}

export interface EmailVerificationState {
  status: 'VERIFIED' | 'NOT_ENFORCED' | 'GRACE'
  graceUntil: string | null
}

// Texto exacto de la API cuando falta verificar el email (403 con code EMAIL_NOT_VERIFIED).
export const EMAIL_NOT_VERIFIED_MESSAGE =
  'Tienes que verificar tu email antes de acceder. Revisa tu correo o solicita un enlace nuevo.'

export function isEmailNotVerifiedMessage(message: string): boolean {
  return message === EMAIL_NOT_VERIFIED_MESSAGE
}

// El login es correcto, pero la cuenta debe verificar su email antes de acceder.
export class EmailNotVerifiedError extends Error {
  constructor(message: string = EMAIL_NOT_VERIFIED_MESSAGE) {
    super(message)
    this.name = 'EmailNotVerifiedError'
  }
}

async function readErrorBody(response: Response): Promise<{ code: string | null; message: string | null }> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown }
    return {
      code: typeof body.code === 'string' ? body.code : null,
      message: typeof body.message === 'string' && body.message ? body.message : null,
    }
  } catch {
    return { code: null, message: null }
  }
}

export type RegisterResult =
  // Cuenta creada con la sesión abierta (la verificación todavía no se exige).
  | { kind: 'session'; user: AuthUser }
  // Cuenta creada sin sesión: hay que verificar el email y después iniciar sesión.
  | { kind: 'verification_required'; email: string; message: string }

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
): Promise<RegisterResult> {
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

  const data = (await response.json()) as
    | { user: AuthUser }
    | { verificationRequired: true; email: string; message: string }
  if ('verificationRequired' in data && data.verificationRequired) {
    return { kind: 'verification_required', email: data.email, message: data.message }
  }
  return { kind: 'session', user: (data as { user: AuthUser }).user }
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

  if (response.status === 403) {
    const body = await readErrorBody(response)
    if (body.code === 'EMAIL_NOT_VERIFIED') throw new EmailNotVerifiedError(body.message ?? undefined)
    throw new Error(body.message ?? `Login failed: ${response.status}`)
  }

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

// /me responde 423 cuando la sesión existía pero la cuenta ya no puede usarse: la API borra
// sus sesiones y explica el motivo en { message }. Son los textos exactos de la API; el de la
// recuperación pendiente es PASSWORD_RESET_REQUIRED_MESSAGE.
const SECURITY_HOLD_MESSAGE =
  'La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.'
const ADMIN_SUSPENSION_MESSAGE =
  'La cuenta está suspendida por el equipo de EstateForge. Contacta con soporte.'

export type SessionBlockReason =
  | 'security_hold'
  | 'admin_suspension'
  | 'recovery_required'
  // 403 con code EMAIL_NOT_VERIFIED (Fase 0): falta verificar el email.
  | 'email_not_verified'
  // Un 423 con otro texto: se conserva el mensaje, pero no se clasifica.
  | 'unknown'

export function sessionBlockReason(message: string): SessionBlockReason {
  if (message === SECURITY_HOLD_MESSAGE) return 'security_hold'
  if (message === ADMIN_SUSPENSION_MESSAGE) return 'admin_suspension'
  if (isSecurityRecoveryRequiredMessage(message)) return 'recovery_required'
  if (isEmailNotVerifiedMessage(message)) return 'email_not_verified'
  return 'unknown'
}

// La API cerró la sesión por el estado de la cuenta; message es el texto de la API.
export class SessionBlockedError extends Error {
  readonly reason: SessionBlockReason

  constructor(message: string) {
    super(message)
    this.name = 'SessionBlockedError'
    this.reason = sessionBlockReason(message)
  }
}

/**
 * Usuario de la sesión actual; null si no hay sesión (401). Si la API cierra la sesión por el
 * estado de la cuenta (423 con mensaje) lanza SessionBlockedError con ese mensaje; cualquier
 * otra respuesta lanza un Error y un fallo de red rechaza como el propio fetch.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    credentials: 'include',
  })

  if (response.status === 401) {
    return null
  }

  if (response.status === 423) {
    const message = await readMessage(response)
    // Sin mensaje no hay motivo que mostrar: se trata como cualquier otro fallo.
    if (message) throw new SessionBlockedError(message)
  }

  // Fase 0: la API cierra la sesión si ya se exige verificar el email y no se ha hecho.
  if (response.status === 403) {
    const body = await readErrorBody(response)
    if (body.code === 'EMAIL_NOT_VERIFIED' && body.message) throw new SessionBlockedError(body.message)
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

// Resultado de confirmar el cambio de email. El cambio está hecho en ambos casos;
// `securityNoticeSent` indica si se pudo avisar a la dirección anterior (decisión D4).
export interface EmailChangeResult {
  user: AuthUser
  securityNoticeSent: boolean
}

export async function verifyEmailChange(
  code: string,
): Promise<EmailChangeResult> {
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

  const data = (await response.json()) as { user: AuthUser; securityNoticeSent?: boolean }
  // Solo un `false` explícito indica que el aviso falló; una API anterior no envía el campo.
  return { user: data.user, securityNoticeSent: data.securityNoticeSent !== false }
}

// ==========================================================
// VERIFICACIÓN DEL EMAIL (Fase 0)
// ==========================================================

export type VerifyEmailResult =
  | { ok: true; message: string }
  | { ok: false; reason: 'expired' | 'invalid' | 'rate_limited' | 'unexpected'; message: string }

const VERIFY_EMAIL_UNEXPECTED_MESSAGE = 'No se ha podido verificar el email. Inténtalo de nuevo más tarde.'
const VERIFY_EMAIL_RATE_LIMITED_MESSAGE = 'Has hecho demasiados intentos. Espera unos minutos e inténtalo de nuevo.'

/** Confirma el email con el token del enlace. No inicia sesión. */
export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
  } catch {
    return { ok: false, reason: 'unexpected', message: VERIFY_EMAIL_UNEXPECTED_MESSAGE }
  }

  const body = await readErrorBody(response)
  if (response.ok) return { ok: true, message: body.message ?? 'Email verificado. Ya puedes iniciar sesión.' }
  if (response.status === 429) return { ok: false, reason: 'rate_limited', message: VERIFY_EMAIL_RATE_LIMITED_MESSAGE }
  if (response.status === 400 && body.message) {
    return { ok: false, reason: body.code === 'EXPIRED' ? 'expired' : 'invalid', message: body.message }
  }
  return { ok: false, reason: 'unexpected', message: VERIFY_EMAIL_UNEXPECTED_MESSAGE }
}

export const RESEND_VERIFICATION_RATE_LIMITED_MESSAGE =
  'Has pedido demasiados enlaces. Espera unos minutos antes de volver a intentarlo.'

/** Pide un enlace de verificación nuevo. La respuesta es la misma exista o no la cuenta. */
export async function requestEmailVerification(email: string): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/verify-email/resend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  })

  if (response.status === 429) throw new Error(RESEND_VERIFICATION_RATE_LIMITED_MESSAGE)
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, 'No se ha podido solicitar el enlace. Inténtalo de nuevo más tarde.'))
  }
  const data = (await response.json()) as { message: string }
  return data.message
}
