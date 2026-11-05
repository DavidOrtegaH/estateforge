import { SessionBlockedError, type AuthUser } from '@/services/authService'

// Decisiones sobre el acceso a las rutas privadas y el aviso del login cuando la API cierra
// una sesión abierta (423 de /me). Son funciones puras para poder probarlas sin DOM.

/** Motivo que dio la API al cerrar la sesión; null para cualquier otro fallo al cargarla. */
export function sessionEndedReasonFrom(error: unknown): string | null {
  return error instanceof SessionBlockedError ? error.message : null
}

export type ProtectedRouteDecision =
  // Aún no se sabe si hay sesión: no se muestra contenido privado.
  | { kind: 'loading' }
  | { kind: 'redirect'; sessionEndedReason: string | null }
  | { kind: 'allow' }

export function protectedRouteDecision(auth: {
  loading: boolean
  user: AuthUser | null
  sessionEndedReason: string | null
}): ProtectedRouteDecision {
  if (auth.loading) return { kind: 'loading' }
  if (!auth.user) return { kind: 'redirect', sessionEndedReason: auth.sessionEndedReason }
  return { kind: 'allow' }
}

/** Estado de la redirección al login: la ruta de origen y, si lo hay, el motivo del cierre. */
export function loginRedirectState<From>(from: From, sessionEndedReason: string | null) {
  return sessionEndedReason ? { from, sessionEndedReason } : { from }
}

/**
 * Aviso que muestra el login: solo el motivo recibido en la redirección desde una ruta
 * privada, es decir, con un estado que trae la ruta de origen (from.pathname, una ruta
 * interna que empieza por «/», pero no por «//») y un motivo no vacío. En una navegación
 * normal el estado no lo trae y no hay aviso.
 */
export function sessionEndedNotice(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null

  const navigationState = state as {
    from?: { pathname?: unknown } | null
    sessionEndedReason?: unknown
  }

  const pathname = navigationState.from?.pathname
  // «//host» empieza por «/», pero el navegador lo interpreta como otro origen.
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) {
    return null
  }

  const reason = navigationState.sessionEndedReason
  return typeof reason === 'string' && reason.trim() !== '' ? reason : null
}
