import { useEffect, useState, type FormEvent } from 'react'
import { API_URL } from '@/lib/api'

const REASON_MIN = 3
const REASON_MAX = 500

type Overview = { users: number; properties: number; generations: number; blockedUsers: number; suspendedUsers: number }
type AdminUser = {
  id: string; email: string; role: 'USER' | 'OWNER'; createdAt: string
  securityHoldAt: string | null; adminSuspendedAt: string | null
  adminSuspensionReason: string | null; properties: number
}
type UserResponse = { users: AdminUser[]; pagination: { page: number; pageSize: number; total: number; pages: number } }
type AuditLog = { id: string; actorUserId: string; targetUserId: string | null; action: string; reason: string | null; createdAt: string }
type AuditResponse = { logs: AuditLog[]; pagination: { page: number; pageSize: number; total: number; pages: number } }
type UserAction = 'suspend' | 'unsuspend' | 'revoke-sessions'
type PendingAction = { user: AdminUser; action: UserAction }

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include', ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  const body = await response.json().catch(() => ({})) as { message?: string }
  if (!response.ok) throw new Error(body.message ?? `No se pudo completar la operación (${response.status}).`)
  return body as T
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    ACCOUNT_SUSPENDED: 'Cuenta suspendida',
    ACCOUNT_UNSUSPENDED: 'Suspensión retirada',
    SESSIONS_REVOKED: 'Sesiones cerradas',
  }
  return labels[action] ?? action
}

function actionTitle(action: UserAction) {
  if (action === 'suspend') return 'Suspender cuenta'
  if (action === 'unsuspend') return 'Reactivar cuenta'
  return 'Cerrar todas las sesiones'
}

function actionDescription(action: UserAction, email: string) {
  if (action === 'suspend') return `La cuenta ${email} quedará suspendida y se cerrarán sus sesiones.`
  if (action === 'unsuspend') return `Se retirará la suspensión administrativa de ${email}. Una protección por incidente de seguridad seguirá activa.`
  return `Se cerrarán todas las sesiones activas de ${email}.`
}

export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [data, setData] = useState<UserResponse | null>(null)
  const [audit, setAudit] = useState<AuditResponse | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [auditPage, setAuditPage] = useState(1)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  async function refresh(nextAuditPage = auditPage) {
    const [stats, users, auditResult] = await Promise.all([
      requestJson<Overview>('/api/admin/overview'),
      requestJson<UserResponse>(`/api/admin/users?search=${encodeURIComponent(search)}&page=${data?.pagination.page ?? 1}`),
      requestJson<AuditResponse>(`/api/admin/audit?page=${nextAuditPage}`),
    ])
    setOverview(stats); setData(users); setAudit(auditResult); setAuditPage(auditResult.pagination.page)
  }

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); setError(null)
      try {
        const [stats, users, auditResult] = await Promise.all([
          requestJson<Overview>('/api/admin/overview'),
          requestJson<UserResponse>('/api/admin/users'),
          requestJson<AuditResponse>('/api/admin/audit?page=1'),
        ])
        if (active) { setOverview(stats); setData(users); setAudit(auditResult); setAuditPage(1) }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Error al cargar el panel.') }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [])

  async function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (searching) return
    setSearching(true); setError(null)
    try { setData(await requestJson<UserResponse>(`/api/admin/users?search=${encodeURIComponent(search)}&page=1`)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Error de búsqueda.') }
    finally { setSearching(false) }
  }

  function openAction(user: AdminUser, action: UserAction) {
    setPendingAction({ user, action })
    setReason('')
    setReasonError(null)
    setError(null)
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pendingAction || busyUserId) return
    const trimmedReason = reason.trim()
    if (trimmedReason.length < REASON_MIN || trimmedReason.length > REASON_MAX) {
      setReasonError(`Escribe un motivo de entre ${REASON_MIN} y ${REASON_MAX} caracteres.`)
      return
    }

    const { user, action } = pendingAction
    setBusyUserId(user.id); setError(null); setNotice(null)
    try {
      const result = await requestJson<{ message: string }>(`/api/admin/users/${encodeURIComponent(user.id)}/${action}`, {
        method: 'POST', body: JSON.stringify({ reason: trimmedReason }),
      })
      setNotice(result.message)
      setPendingAction(null)
      setReason('')
      await refresh(1)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la acción.') }
    finally { setBusyUserId(null) }
  }

  async function changeAuditPage(page: number) {
    if (!audit || page < 1 || page > audit.pagination.pages || page === auditPage) return
    try {
      setError(null)
      const result = await requestJson<AuditResponse>(`/api/admin/audit?page=${page}`)
      setAudit(result); setAuditPage(result.pagination.page)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la auditoría.') }
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-6 lg:p-10">
      <header><p className="text-sm font-medium text-primary">ESTATEFORGE · CONTROL DEL SAAS</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Administración</h1><p className="mt-2 text-sm text-muted-foreground">Vista general de la plataforma y gestión de cuentas.</p></header>
      {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-800">{notice}</div>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {([['Usuarios', overview?.users], ['Inmuebles', overview?.properties], ['Generaciones', overview?.generations], ['Cuentas protegidas', overview?.blockedUsers], ['Suspendidas por admin', overview?.suspendedUsers]] as const).map(([label, value]) => <article key={label} className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{loading ? '—' : value}</p></article>)}
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div><h2 className="text-xl font-semibold">Usuarios</h2><p className="mt-1 text-sm text-muted-foreground">Datos de cuenta y estado de seguridad. No se muestran contraseñas, claves ni contenido privado. Las cuentas propietarias no se pueden modificar desde este panel.</p></div>
        <form onSubmit={searchUsers} className="flex flex-col gap-2 sm:flex-row">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por email" aria-label="Buscar usuarios por email" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" />
          <button type="submit" disabled={loading || searching} aria-busy={searching} className="inline-flex min-w-32 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-80 disabled:shadow-none">
            {searching && <svg aria-hidden="true" className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {searching ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        <div className="min-h-[12rem] overflow-x-auto" aria-live="polite" aria-busy={searching}>
          <table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">Cuenta</th><th className="p-3">Rol</th><th className="p-3">Inmuebles</th><th className="p-3">Alta</th><th className="p-3">Estado</th><th className="p-3">Acciones</th></tr></thead><tbody>{data?.users.map(user => <tr key={user.id} className="border-b align-top last:border-0">
            <td className="p-3"><div className="font-medium">{user.email}</div><div className="max-w-52 truncate text-xs text-muted-foreground">{user.id}</div></td>
            <td className="p-3">{user.role === 'OWNER' ? 'Propietario' : 'Usuario'}</td><td className="p-3">{user.properties}</td><td className="p-3 whitespace-nowrap">{new Date(user.createdAt).toLocaleDateString('es-ES')}</td>
            <td className="p-3"><div>{user.securityHoldAt ? <span className="font-medium text-red-700">Protección por incidente</span> : user.adminSuspendedAt ? <span className="font-medium text-amber-700">Suspendida por admin</span> : <span className="text-green-700">Normal</span>}</div>{user.adminSuspensionReason && <p className="mt-1 max-w-56 whitespace-pre-wrap break-words text-xs text-muted-foreground">Motivo: {user.adminSuspensionReason}</p>}</td>
            <td className="p-3"><div className="flex min-w-40 flex-col items-start gap-2">{user.role !== 'OWNER' && <>
              {user.adminSuspendedAt ? <button disabled={busyUserId !== null} onClick={() => openAction(user, 'unsuspend')} className="text-xs font-semibold text-primary underline disabled:opacity-50">Reactivar cuenta</button> : <button disabled={busyUserId !== null || !!user.securityHoldAt} title={user.securityHoldAt ? 'La cuenta está protegida por incidente; no se puede modificar aquí.' : undefined} onClick={() => openAction(user, 'suspend')} className="text-xs font-semibold text-red-700 underline disabled:opacity-50">Suspender cuenta</button>}
              <button disabled={busyUserId !== null} onClick={() => openAction(user, 'revoke-sessions')} className="text-xs font-semibold text-muted-foreground underline disabled:opacity-50">Cerrar sesiones</button>
            </>}</div></td>
          </tr>)}</tbody></table>
          {!loading && !searching && data?.users.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No se han encontrado cuentas.</p>}
        </div>
        {data && <p className="text-xs text-muted-foreground">{data.pagination.total} cuentas en total · Página {data.pagination.page} de {Math.max(1, data.pagination.pages)}</p>}
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div><h2 className="text-xl font-semibold">Auditoría administrativa</h2><p className="mt-1 text-sm text-muted-foreground">Acciones administrativas ordenadas de más recientes a más antiguas. Se muestran 10 registros por página.</p></div>
        {!audit || audit.logs.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay acciones administrativas registradas.</p> : <>
          <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="w-36 p-3">Acción</th><th className="w-40 p-3">Cuenta afectada</th><th className="w-40 p-3">Operador</th><th className="w-44 p-3">Fecha</th><th className="p-3">Motivo</th></tr></thead><tbody>{audit.logs.map(log => <tr key={log.id} className="border-b align-top last:border-0"><td className="p-3">{actionLabel(log.action)}</td><td className="p-3"><span className="block break-all font-mono text-xs">{log.targetUserId ?? '—'}</span></td><td className="p-3"><span className="block break-all font-mono text-xs">{log.actorUserId}</span></td><td className="p-3">{new Date(log.createdAt).toLocaleString('es-ES')}</td><td className="p-3">{log.reason ? <details className="max-w-xl"><summary className="cursor-pointer text-sm"><span className="line-clamp-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{log.reason}</span></summary><p className="mt-2 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{log.reason}</p></details> : '—'}</td></tr>)}</tbody></table></div>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{audit.pagination.total} acciones · Página {audit.pagination.page} de {Math.max(1, audit.pagination.pages)}</p>
            <div className="flex items-center gap-2"><button type="button" onClick={() => void changeAuditPage(auditPage - 1)} disabled={auditPage <= 1} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">Anterior</button><button type="button" onClick={() => void changeAuditPage(auditPage + 1)} disabled={auditPage >= audit.pagination.pages} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">Siguiente</button></div>
          </div>
        </>}
      </section>

      {pendingAction && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busyUserId) setPendingAction(null) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="admin-action-title" className="my-auto w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl">
          <h2 id="admin-action-title" className="text-xl font-semibold">{actionTitle(pendingAction.action)}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{actionDescription(pendingAction.action, pendingAction.user.email)}</p>
          <form onSubmit={submitAction} className="mt-5 space-y-3">
            <label htmlFor="admin-action-reason" className="block text-sm font-medium">Motivo <span className="text-muted-foreground">(obligatorio)</span></label>
            <textarea id="admin-action-reason" autoFocus rows={4} maxLength={REASON_MAX} value={reason} onChange={event => { setReason(event.target.value); if (reasonError) setReasonError(null) }} aria-invalid={!!reasonError} aria-describedby="admin-action-reason-help admin-action-reason-error" placeholder="Explica brevemente por qué realizas esta acción…" className={`w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${reasonError ? 'border-red-500 focus-visible:ring-red-400' : ''}`} />
            <div className="flex items-start justify-between gap-3"><p id="admin-action-reason-help" className="text-xs text-muted-foreground">Entre {REASON_MIN} y {REASON_MAX} caracteres. Se guardará en la auditoría.</p><p className="shrink-0 text-xs tabular-nums text-muted-foreground">{reason.trim().length}/{REASON_MAX}</p></div>
            {reasonError && <p id="admin-action-reason-error" role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{reasonError}</p>}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end"><button type="button" disabled={!!busyUserId} onClick={() => setPendingAction(null)} className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50">Cancelar</button><button type="submit" disabled={!!busyUserId} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-60">{busyUserId ? 'Procesando…' : 'Confirmar acción'}</button></div>
          </form>
        </section>
      </div>}
    </main>
  )
}
