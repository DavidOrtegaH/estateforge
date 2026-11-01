import { API_URL } from '@/lib/api'

export type AdminOverview = { users: number; properties: number; generations: number; blockedUsers: number; suspendedUsers: number }
export type AdminUser = {
  id: string; email: string; role: 'USER' | 'OWNER'; createdAt: string
  securityHoldAt: string | null; adminSuspendedAt: string | null
  adminSuspensionReason: string | null; properties: number
}
export type AdminUserDetail = AdminUser & { activeSessions: number }
export type AdminPagination = { page: number; pageSize: number; total: number; pages: number }
export type AdminUsersResponse = { users: AdminUser[]; pagination: AdminPagination }
export type AdminAuditLog = {
  id: string; actorUserId: string; targetUserId: string | null; action: string; reason: string | null; createdAt: string
  // Email actual (null si la cuenta ya no existe) y el registrado al hacer la acción (null en registros antiguos).
  actorEmail: string | null; actorEmailAtAction: string | null; actorFound: boolean
  targetEmail: string | null; targetEmailAtAction: string | null; targetFound: boolean | null
  revokedCount: number | null
}
export type AdminAuditAction =
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_UNSUSPENDED'
  | 'SESSIONS_REVOKED'
export type AdminAuditResponse = { logs: AdminAuditLog[]; pagination: AdminPagination }
export type AdminUserAction = 'suspend' | 'unsuspend' | 'revoke-sessions'

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include', ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  const body = await response.json().catch(() => ({})) as { message?: string }
  if (!response.ok) throw new Error(body.message ?? `No se pudo completar la operación (${response.status}).`)
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
  if (filters.action !== undefined) path += `&action=${filters.action}`
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
