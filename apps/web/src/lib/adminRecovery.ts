import { AdminApiError, type AdminPanelAction, type AdminUser } from '@/services/adminService'

// Lógica pura de la recuperación de cuentas en el panel OWNER (R2): el campo de email del
// diálogo, su validación, los avisos del resultado, los errores y el bloqueo de doble envío.

// Mismo límite que la API (z.string().trim().email().max(254)). La API sigue siendo la que valida.
export const RECOVERY_EMAIL_MAX = 254
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidRecoveryEmail(value: string): boolean {
  const email = value.trim()
  return email.length > 0 && email.length <= RECOVERY_EMAIL_MAX && EMAIL_SHAPE.test(email)
}

// none: la acción no lleva email; optional: si falta, la API usa el destino guardado.
export type RecoveryEmailField = 'none' | 'optional' | 'required'

export function recoveryEmailField(
  action: AdminPanelAction,
  user: Pick<AdminUser, 'securityRecoveryEmail'>,
): RecoveryEmailField {
  if (action === 'recovery-destination') return 'required'
  // Sin destino guardado la API exige uno (400): el campo pasa a ser obligatorio.
  if (action === 'resolve-security-hold') return user.securityRecoveryEmail ? 'optional' : 'required'
  return 'none'
}

/** Error del campo de email, o null si se puede enviar. */
export function recoveryEmailError(field: RecoveryEmailField, value: string): string | null {
  if (field === 'none') return null
  const email = value.trim()
  if (email === '') return field === 'required' ? 'Indica el email al que enviar el enlace de recuperación.' : null
  return isValidRecoveryEmail(email) ? null : 'Escribe un email válido (máximo 254 caracteres).'
}

/** Email que se envía a la API: undefined si la acción no lo lleva o, siendo opcional, está vacío. */
export function recoveryEmailToSend(field: RecoveryEmailField, value: string): string | undefined {
  const email = value.trim()
  return field === 'none' || email === '' ? undefined : email
}

/** Si el destino de recuperación es pertinente: con la recuperación pendiente o la protección activa. */
export function showsRecoveryDestination(
  user: Pick<AdminUser, 'securityHoldAt' | 'passwordResetRequiredAt' | 'securityRecoveryEmail'>,
): boolean {
  return Boolean(user.securityRecoveryEmail) && (Boolean(user.passwordResetRequiredAt) || Boolean(user.securityHoldAt))
}

export type ActionNoticeTone = 'success' | 'warning'
export interface ActionNotice { message: string; tone: ActionNoticeTone }

/**
 * Aviso tras una acción completada, con el mensaje de la API. Si el enlace no se envió
 * (recoveryEmailSent: false, también cuando el destino no cambió), es un aviso, no un éxito.
 */
export function actionNotice(result: { message: string; recoveryEmailSent?: boolean }): ActionNotice {
  return { message: result.message, tone: result.recoveryEmailSent === false ? 'warning' : 'success' }
}

export const STATE_CHANGED_HINT = 'El estado de la cuenta ha cambiado: actualiza la página para ver la información actual antes de volver a intentarlo.'

/**
 * Mensaje de una acción fallida. 409 es un conflicto de estado: se añade que hay que actualizar
 * la información. 400 y los demás conservan el mensaje de la API (o el genérico de siempre).
 */
export function adminActionErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError && error.status === 409) return `${error.message} ${STATE_CHANGED_HINT}`
  if (error instanceof Error && error.message) return error.message
  return 'No se pudo completar la acción.'
}

/**
 * Marca una operación en curso y devuelve la función que la libera; null si ya había una.
 * Evita un segundo envío antes de que React vuelva a renderizar el botón desactivado.
 */
export function tryStartOnce(flag: { current: boolean }): (() => void) | null {
  if (flag.current) return null
  flag.current = true
  return () => { flag.current = false }
}
