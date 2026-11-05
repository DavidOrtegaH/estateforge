import type { AdminPanelAction, AdminUser } from '@/services/adminService'

// Disponibilidad de las acciones de una cuenta en el panel de administración. Solo decide qué
// controles se muestran y cuándo están desactivados; la autorización real la aplica la API.

export const SECURITY_HOLD_ACTION_TITLE = 'La cuenta está protegida por incidente: no se puede suspender mientras la protección siga activa.'
// Mismo texto que la API (400) al reenviar sin destino guardado.
export const NO_STORED_DESTINATION_TITLE = 'La cuenta no tiene un destino de recuperación guardado. Corrige el destino antes de reenviar.'

export interface UserActionState {
  action: AdminPanelAction
  disabled: boolean
  // Explicación de por qué no está disponible, si la hay.
  title?: string
}

export interface UserActionsAvailability {
  // «Ver detalle» se muestra siempre; solo se desactiva mientras esa misma cuenta se procesa.
  detailDisabled: boolean
  // Acciones administrativas en el orden en que se muestran; ninguna para cuentas propietarias.
  actions: UserActionState[]
}

/** Recuperación obligatoria gestionable: pendiente, sin protección ni suspensión (como exige la API). */
export function canManageRecovery(
  user: Pick<AdminUser, 'securityHoldAt' | 'adminSuspendedAt' | 'passwordResetRequiredAt'>,
): boolean {
  return Boolean(user.passwordResetRequiredAt) && !user.securityHoldAt && !user.adminSuspendedAt
}

/**
 * busyUserId es la cuenta cuya acción se está procesando (null si ninguna). Mientras hay una
 * acción en curso, todas las acciones administrativas quedan desactivadas.
 */
export function userActionsAvailability(
  user: Pick<AdminUser, 'id' | 'role' | 'adminSuspendedAt' | 'securityHoldAt' | 'passwordResetRequiredAt' | 'securityRecoveryEmail'>,
  busyUserId: string | null,
): UserActionsAvailability {
  const detailDisabled = busyUserId === user.id
  if (user.role === 'OWNER') return { detailDisabled, actions: [] }

  const busy = busyUserId !== null
  // Una cuenta suspendida se puede reactivar aunque esté protegida; una no suspendida no se
  // puede suspender mientras esté protegida por incidente.
  const first: UserActionState = user.adminSuspendedAt
    ? { action: 'unsuspend', disabled: busy }
    : user.securityHoldAt
      ? { action: 'suspend', disabled: true, title: SECURITY_HOLD_ACTION_TITLE }
      : { action: 'suspend', disabled: busy }

  const actions: UserActionState[] = [first, { action: 'revoke-sessions', disabled: busy }]

  // La retirada solo existe con una protección activa (también si la cuenta está suspendida).
  if (user.securityHoldAt) actions.push({ action: 'resolve-security-hold', disabled: busy })

  // Corregir y reenviar solo con la recuperación pendiente, sin protección ni suspensión.
  // El reenvío además necesita un destino guardado.
  if (canManageRecovery(user)) {
    actions.push({ action: 'recovery-destination', disabled: busy })
    actions.push(user.securityRecoveryEmail
      ? { action: 'resend-recovery', disabled: busy }
      : { action: 'resend-recovery', disabled: true, title: NO_STORED_DESTINATION_TITLE })
  }

  return { detailDisabled, actions }
}
