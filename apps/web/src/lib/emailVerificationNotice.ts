import type { AuthUser } from '@/services/authService'

// Aviso para quien tiene sesión pero aún no ha verificado su email (Fase 0). Es una función
// pura para poder probarla sin DOM.

export interface EmailVerificationNotice {
  title: string
  detail: string
}

function formatDeadline(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })
}

/**
 * Aviso que corresponde al usuario de la sesión; null si no hace falta ninguno. Solo se avisa
 * durante el periodo de gracia (GRACE). Con el email verificado o sin la verificación exigida
 * (NOT_ENFORCED) no hay ninguna obligación pendiente, aunque el enlace siga llegando por correo.
 * REQUIRED no llega a una sesión: la API la cierra antes.
 */
export function emailVerificationNotice(user: Pick<AuthUser, 'emailVerification'> | null): EmailVerificationNotice | null {
  const state = user?.emailVerification
  if (!state || state.status !== 'GRACE') return null

  const deadline = state.graceUntil ? formatDeadline(state.graceUntil) : null
  return {
    title: 'Verifica tu email',
    detail: deadline
      ? `Tu email todavía no está verificado. Verifícalo antes del ${deadline} para seguir accediendo a EstateForge.`
      : 'Tu email todavía no está verificado. Verifícalo para seguir accediendo a EstateForge cuando sea obligatorio.',
  }
}
