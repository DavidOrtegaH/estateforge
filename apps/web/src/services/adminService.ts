import { API_URL } from '@/lib/api'

export type AdminOverview = { users: number; properties: number; generations: number; blockedUsers: number; suspendedUsers: number }
export type AdminUser = {
  id: string; email: string; role: 'USER' | 'OWNER'; createdAt: string
  securityHoldAt: string | null; adminSuspendedAt: string | null
  adminSuspensionReason: string | null; properties: number
  // Recuperación obligatoria (R1): desde cuándo está pendiente (null si no lo está) y destino
  // guardado (null si no hay). Opcionales para datos o mocks que todavía no los incluyan.
  passwordResetRequiredAt?: string | null; securityRecoveryEmail?: string | null
}
export type AdminUserDetail = AdminUser & { activeSessions: number }
export type AdminPagination = { page: number; pageSize: number; total: number; pages: number }
export type AdminUsersResponse = { users: AdminUser[]; pagination: AdminPagination }
export type AdminAuditLog = {
  // actorUserId null: acción sin un actor autenticado (p. ej., la solicitud pública de un enlace de recuperación).
  id: string; actorUserId: string | null; targetUserId: string | null; action: string; reason: string | null; createdAt: string
  // Email actual (null si la cuenta ya no existe) y el registrado al hacer la acción (null en registros antiguos).
  actorEmail: string | null; actorEmailAtAction: string | null; actorFound: boolean | null
  targetEmail: string | null; targetEmailAtAction: string | null; targetFound: boolean | null
  revokedCount: number | null
  // De dónde salió el destino de la recuperación (E2.4); la API nunca devuelve la dirección.
  recoveryDestination: AuditRecoveryDestination | null
}
export type AuditRecoveryDestination = 'STORED' | 'OWNER_PROVIDED' | 'OWNER_CORRECTED'
// Las mismas acciones que acepta el filtro de GET /api/admin/audit.
export type AdminAuditAction =
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_UNSUSPENDED'
  | 'SESSIONS_REVOKED'
  | 'SECURITY_HOLD_RESOLVED'
  | 'SECURITY_RECOVERY_DESTINATION_CHANGED'
  | 'SECURITY_RECOVERY_LINK_RESENT'
  | 'SECURITY_RECOVERY_LINK_REQUESTED'
  | 'SECURITY_RECOVERY_COMPLETED'
export type AdminAuditResponse = { logs: AdminAuditLog[]; pagination: AdminPagination }
export type AdminUserAction = 'suspend' | 'unsuspend' | 'revoke-sessions'
// Operaciones de la recuperación obligatoria (E2.4 y E2.5f), solo para cuentas no propietarias.
export type AdminRecoveryAction = 'resolve-security-hold' | 'recovery-destination' | 'resend-recovery'
export type AdminPanelAction = AdminUserAction | AdminRecoveryAction
// Respuesta de las tres operaciones: recoveryEmailSent dice si salió el enlace; changed solo lo
// devuelve la corrección del destino (false si el destino ya era ese y no se envió nada).
export type AdminRecoveryResult = { success: true; message: string; recoveryEmailSent: boolean; changed?: boolean }

// Error de una petición del panel: el mensaje de la API (o uno genérico) y el estado HTTP.
export class AdminApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include', ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  const body = await response.json().catch(() => ({})) as { message?: string }
  if (!response.ok) throw new AdminApiError(body.message ?? `No se pudo completar la operación (${response.status}).`, response.status)
  return body as T
}

export function getAdminOverview(): Promise<AdminOverview> {
  return requestJson<AdminOverview>('/api/admin/overview')
}

// Sin argumentos pide la primera página sin filtro, como la carga inicial del panel.
export function getAdminUsers(query?: { search: string; page: number }): Promise<AdminUsersResponse> {
  const path = query
    ? `/api/admin/users?search=${encodeURIComponent(query.search)}&page=${query.page}`
    : '/api/admin/users'
  return requestJson<AdminUsersResponse>(path)
}

export function getAdminUserDetail(id: string): Promise<AdminUserDetail> {
  return requestJson<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`)
}

// Los filtros vacíos no se envían: sin filtros la URL es la misma de siempre.
export function getAdminAudit(
  page: number,
  filters: { action?: AdminAuditAction; targetUserId?: string } = {},
): Promise<AdminAuditResponse> {
  let path = `/api/admin/audit?page=${page}`
  if (filters.action !== undefined) path += `&action=${encodeURIComponent(filters.action)}`
  if (filters.targetUserId !== undefined && filters.targetUserId.trim() !== '') {
    path += `&targetUserId=${encodeURIComponent(filters.targetUserId)}`
  }
  return requestJson<AdminAuditResponse>(path)
}

export function runAdminUserAction(userId: string, action: AdminUserAction, reason: string): Promise<{ message: string }> {
  return requestJson<{ message: string }>(`/api/admin/users/${encodeURIComponent(userId)}/${action}`, {
    method: 'POST', body: JSON.stringify({ reason }),
  })
}

function runRecoveryAction(userId: string, action: AdminRecoveryAction, body: { reason: string; recoveryEmail?: string }) {
  return requestJson<AdminRecoveryResult>(`/api/admin/users/${encodeURIComponent(userId)}/${action}`, {
    method: 'POST', body: JSON.stringify(body),
  })
}

/**
 * Retira la protección por incidente y deja la cuenta en recuperación obligatoria. Sin
 * recoveryEmail la API usa el destino guardado (400 si no lo hay); con él, ese destino.
 */
export function resolveSecurityHold(userId: string, reason: string, recoveryEmail?: string): Promise<AdminRecoveryResult> {
  return runRecoveryAction(userId, 'resolve-security-hold', recoveryEmail === undefined ? { reason } : { reason, recoveryEmail })
}

/** Corrige el destino de una recuperación pendiente y envía un enlace nuevo (recoveryEmail obligatorio). */
export function changeRecoveryDestination(userId: string, reason: string, recoveryEmail: string): Promise<AdminRecoveryResult> {
  return runRecoveryAction(userId, 'recovery-destination', { reason, recoveryEmail })
}

/** Reenvía el enlace de una recuperación pendiente al destino guardado. */
export function resendRecoveryLink(userId: string, reason: string): Promise<AdminRecoveryResult> {
  return runRecoveryAction(userId, 'resend-recovery', { reason })
}
