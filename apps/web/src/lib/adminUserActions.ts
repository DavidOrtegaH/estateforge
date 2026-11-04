import type { AdminUser, AdminUserAction } from '@/services/adminService'

// Disponibilidad de las acciones de una cuenta en el panel de administración. Solo decide qué
// controles se muestran y cuándo están desactivados; la autorización real la aplica la API.

export const SECURITY_HOLD_ACTION_TITLE = 'La cuenta está protegida por incidente; no se puede modificar aquí.'

export interface UserActionState {
  action: AdminUserAction
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

/**
 * busyUserId es la cuenta cuya acción se está procesando (null si ninguna). Mientras hay una
 * acción en curso, todas las acciones administrativas quedan desactivadas.
 */
export function userActionsAvailability(
  user: Pick<AdminUser, 'id' | 'role' | 'adminSuspendedAt' | 'securityHoldAt'>,
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

  return { detailDisabled, actions: [first, { action: 'revoke-sessions', disabled: busy }] }
}
