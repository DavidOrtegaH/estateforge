import type { AuthUser, EmailChangeResult, RegisterResult } from '@/services/authService'

// Fase 0.3a: las respuestas del login, del registro con sesión y del cambio de email traen
// { id, email, role }, pero no el estado de verificación del email (emailVerification), que
// solo devuelve /me. Tras esas operaciones se consulta /me una vez y el contexto guarda ese
// usuario, el mismo que obtiene al cargar la aplicación. Lógica pura para probarla sin DOM.

/** Operaciones de authService que usa AuthProvider (en las pruebas, con fetch simulado). */
export interface AuthSessionService {
  login: (email: string, password: string, turnstileToken?: string) => Promise<AuthUser>
  register: (email: string, password: string, turnstileToken?: string) => Promise<RegisterResult>
  verifyEmailChange: (code: string) => Promise<EmailChangeResult>
  getCurrentUser: () => Promise<AuthUser | null>
}

/**
 * Usuario de la sesión según /me, tras una operación que ya ha tenido éxito. Si /me falla o no
 * devuelve usuario, se conserva `fallback` (el de la operación): la operación no se presenta
 * como fallida ni se da la sesión por cerrada, y el fallo queda registrado sin datos de la cuenta.
 */
export async function withSessionState(
  service: Pick<AuthSessionService, 'getCurrentUser'>,
  fallback: AuthUser,
): Promise<AuthUser> {
  try {
    const current = await service.getCurrentUser()
    if (current) return current
    console.error('No se pudo actualizar el estado de la sesión: /me no devolvió ningún usuario.')
  } catch (error) {
    console.error(
      'No se pudo actualizar el estado de la sesión:',
      error instanceof Error ? error.message : 'error desconocido',
    )
  }
  return fallback
}

/** Login y, si es correcto, el usuario completo de /me. Un login fallido no consulta /me. */
export async function loginWithSessionState(
  service: AuthSessionService,
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<AuthUser> {
  const user = await service.login(email, password, turnstileToken)
  return withSessionState(service, user)
}

/** Registro; solo si abre sesión se completa el usuario con /me. */
export async function registerWithSessionState(
  service: AuthSessionService,
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<RegisterResult> {
  const result = await service.register(email, password, turnstileToken)
  if (result.kind !== 'session') return result
  return { kind: 'session', user: await withSessionState(service, result.user) }
}

/**
 * Cambio de email confirmado y, si es correcto, el usuario completo de /me. Conserva si se pudo
 * avisar a la dirección anterior (decisión D4): el cambio está hecho en ambos casos.
 */
export async function updateEmailWithSessionState(
  service: AuthSessionService,
  code: string,
): Promise<EmailChangeResult> {
  const result = await service.verifyEmailChange(code)
  return { user: await withSessionState(service, result.user), securityNoticeSent: result.securityNoticeSent }
}

/** Mensaje de la cuenta tras confirmar el cambio de email (decisión D4). */
export function emailChangeCompletedMessage(result: EmailChangeResult): string {
  const done = `Email actualizado correctamente a ${result.user.email}.`
  if (result.securityNoticeSent) return done
  // El cambio está hecho: el aviso no invita a repetirlo.
  return `${done} No hemos podido enviar el aviso de seguridad a tu dirección anterior; no hace falta repetir el cambio.`
}
