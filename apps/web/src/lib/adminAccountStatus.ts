import type { AdminUser } from '@/services/adminService'

export interface AccountStatusLabel {
  label: string
  className: string
}

/**
 * Etiquetas del estado de una cuenta en el panel de administración. La protección por
 * incidente, la suspensión administrativa y la recuperación obligatoria pendiente son
 * independientes: si concurren se muestran todas (protección, suspensión, recuperación);
 * sin ninguna, «Normal».
 */
export function accountStatuses(
  user: Pick<AdminUser, 'securityHoldAt' | 'adminSuspendedAt' | 'passwordResetRequiredAt'>,
): AccountStatusLabel[] {
  const statuses: AccountStatusLabel[] = []
  if (user.securityHoldAt) statuses.push({ label: 'Protección por incidente', className: 'font-medium text-red-700' })
  if (user.adminSuspendedAt) statuses.push({ label: 'Suspendida por admin', className: 'font-medium text-amber-700' })
  if (user.passwordResetRequiredAt) statuses.push({ label: 'Recuperación pendiente', className: 'font-medium text-sky-700' })
  return statuses.length > 0 ? statuses : [{ label: 'Normal', className: 'text-green-700' }]
}
