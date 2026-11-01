import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  getAdminAudit, getAdminOverview, getAdminUsers, runAdminUserAction,
  type AdminAuditResponse, type AdminOverview, type AdminUser, type AdminUserAction, type AdminUsersResponse,
} from '@/services/adminService'
import { describeAuditAccount, type AuditAccountView } from '@/lib/adminAudit'

const REASON_MIN = 3
const REASON_MAX = 500

type PendingAction = { user: AdminUser; action: AdminUserAction }

function AuditAccount({ view }: { view: AuditAccountView | null }) {
  if (!view) return <>—</>
  return <>
    <span className="block break-all font-medium">{view.primary}</span>
    <span className="block break-all font-mono text-xs text-muted-foreground">{view.id}</span>
    {view.note !== null && <span className="mt-1 block text-xs text-muted-foreground">{view.note}</span>}
  </>
}

// Muestra el motivo una sola vez. El control de expandir solo aparece si el texto
// ocupa más de 3 líneas con el ancho y la fuente reales, medidos tras renderizar.
function AuditReason({ reason }: { reason: string }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [expandable, setExpandable] = useState(false)
  const [open, setOpen] = useState(false)
  const clamped = !(expandable && open)

  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    function measure() {
      if (!element) return
      if (clamped) {
        // Con line-clamp, el texto recortado tiene más altura de la visible.
        const overflows = element.scrollHeight > element.clientHeight + 1
        setExpandable(overflows)
        if (!overflows) setOpen(false)
        return
      }
      // Desplegado no hay recorte: se compara la altura con 3 líneas.
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return
      if (element.scrollHeight <= lineHeight * 3 + 1) { setExpandable(false); setOpen(false) }
    }
    measure()
    // Cambios de ancho (ventana, columna) y la carga tardía de fuentes cambian el número de líneas.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    let active = true
    void document.fonts?.ready.then(() => { if (active) measure() })
    return () => { active = false; observer.disconnect() }
  }, [reason, clamped, expandable])

  const text = <span ref={textRef} className={`whitespace-pre-wrap wrap-break-word ${clamped ? 'line-clamp-3' : 'block'}`}>{reason}</span>
  if (!expandable) return <div className="max-w-xl text-sm">{text}</div>
  return <details className="max-w-xl" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm">{text}</summary></details>
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    ACCOUNT_SUSPENDED: 'Cuenta suspendida',
    ACCOUNT_UNSUSPENDED: 'Suspensión retirada',
    SESSIONS_REVOKED: 'Sesiones cerradas',
  }
  return labels[action] ?? action
}

function actionTitle(action: AdminUserAction) {
  if (action === 'suspend') return 'Suspender cuenta'
  if (action === 'unsuspend') return 'Reactivar cuenta'
  return 'Cerrar todas las sesiones'
}

function actionDescription(action: AdminUserAction, email: string) {
  if (action === 'suspend') return `La cuenta ${email} quedará suspendida y se cerrarán sus sesiones.`
  if (action === 'unsuspend') return `Se retirará la suspensión administrativa de ${email}. Una protección por incidente de seguridad seguirá activa.`
  return `Se cerrarán todas las sesiones activas de ${email}.`
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [data, setData] = useState<AdminUsersResponse | null>(null)
  const [audit, setAudit] = useState<AdminAuditResponse | null>(null)
  const [search, setSearch] = useState('')
  // Último filtro enviado; search es solo el texto que se está escribiendo.
  const [appliedSearch, setAppliedSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [changingUsersPage, setChangingUsersPage] = useState(false)
  // Identifica la última petición de usuarios; las respuestas anteriores se descartan.
  const usersRequest = useRef(0)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [auditPage, setAuditPage] = useState(1)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  // Devuelve null si mientras tanto se lanzó otra petición de usuarios.
  async function loadUsers(query: { search: string; page: number }) {
    const requestId = ++usersRequest.current
    try {
      const result = await getAdminUsers(query)
      return requestId === usersRequest.current ? result : null
    } catch (e) {
      if (requestId !== usersRequest.current) return null
      throw e
    }
  }

  async function refresh(nextAuditPage = auditPage) {
    const [stats, users, auditResult] = await Promise.all([
      getAdminOverview(),
      loadUsers({ search: appliedSearch, page: data?.pagination.page ?? 1 }),
      getAdminAudit(nextAuditPage),
    ])
    setOverview(stats); setAudit(auditResult); setAuditPage(auditResult.pagination.page)
    if (!users) return
    // Si la página actual ha quedado vacía, se carga la última página con resultados.
    if (users.users.length === 0 && users.pagination.page > 1) {
      const lastPage = await loadUsers({ search: appliedSearch, page: Math.max(1, users.pagination.pages) })
      if (lastPage) setData(lastPage)
      return
    }
    setData(users)
  }

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); setError(null)
      const requestId = ++usersRequest.current
      try {
        const [stats, users, auditResult] = await Promise.all([
          getAdminOverview(),
          getAdminUsers(),
          getAdminAudit(1),
        ])
        if (active) {
          setOverview(stats); setAudit(auditResult); setAuditPage(1)
          if (requestId === usersRequest.current) setData(users)
        }
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
    const submittedSearch = search
    try {
      const users = await loadUsers({ search: submittedSearch, page: 1 })
      if (users) { setData(users); setAppliedSearch(submittedSearch) }
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Error de búsqueda.') }
    finally { setSearching(false) }
  }

  async function changeUsersPage(page: number) {
    if (!data || page < 1 || page > data.pagination.pages || page === data.pagination.page) return
    setChangingUsersPage(true); setError(null)
    try {
      const users = await loadUsers({ search: appliedSearch, page })
      if (users) setData(users)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la página de usuarios.') }
    finally { setChangingUsersPage(false) }
  }

  function openAction(user: AdminUser, action: AdminUserAction) {
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
      const result = await runAdminUserAction(user.id, action, trimmedReason)
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
      const result = await getAdminAudit(page)
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
        <div className="min-h-48 overflow-x-auto" aria-live="polite" aria-busy={searching}>
          <table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">Cuenta</th><th className="p-3">Rol</th><th className="p-3">Inmuebles</th><th className="p-3">Alta</th><th className="p-3">Estado</th><th className="p-3">Acciones</th></tr></thead><tbody>{data?.users.map(user => <tr key={user.id} className="border-b align-top last:border-0">
            <td className="p-3"><div className="font-medium">{user.email}</div><div className="max-w-52 truncate text-xs text-muted-foreground">{user.id}</div></td>
            <td className="p-3">{user.role === 'OWNER' ? 'Propietario' : 'Usuario'}</td><td className="p-3">{user.properties}</td><td className="p-3 whitespace-nowrap">{new Date(user.createdAt).toLocaleDateString('es-ES')}</td>
            <td className="p-3"><div>{user.securityHoldAt ? <span className="font-medium text-red-700">Protección por incidente</span> : user.adminSuspendedAt ? <span className="font-medium text-amber-700">Suspendida por admin</span> : <span className="text-green-700">Normal</span>}</div>{user.adminSuspensionReason && <p className="mt-1 max-w-56 whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">Motivo: {user.adminSuspensionReason}</p>}</td>
            <td className="p-3"><div className="flex min-w-40 flex-col items-start gap-2">{user.role !== 'OWNER' && <>
              {user.adminSuspendedAt ? <button disabled={busyUserId !== null} onClick={() => openAction(user, 'unsuspend')} className="text-xs font-semibold text-primary underline disabled:opacity-50">Reactivar cuenta</button> : <button disabled={busyUserId !== null || !!user.securityHoldAt} title={user.securityHoldAt ? 'La cuenta está protegida por incidente; no se puede modificar aquí.' : undefined} onClick={() => openAction(user, 'suspend')} className="text-xs font-semibold text-red-700 underline disabled:opacity-50">Suspender cuenta</button>}
              <button disabled={busyUserId !== null} onClick={() => openAction(user, 'revoke-sessions')} className="text-xs font-semibold text-muted-foreground underline disabled:opacity-50">Cerrar sesiones</button>
            </>}</div></td>
          </tr>)}</tbody></table>
          {!loading && !searching && data?.users.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No se han encontrado cuentas.</p>}
        </div>
        {data && <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{data.pagination.total} cuentas en total · Página {data.pagination.page} de {Math.max(1, data.pagination.pages)}</p>
          <div className="flex items-center gap-2"><button type="button" aria-label="Página anterior de usuarios" onClick={() => void changeUsersPage(data.pagination.page - 1)} disabled={loading || searching || changingUsersPage || data.pagination.page <= 1} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">Anterior</button><button type="button" aria-label="Página siguiente de usuarios" onClick={() => void changeUsersPage(data.pagination.page + 1)} disabled={loading || searching || changingUsersPage || data.pagination.page >= data.pagination.pages} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">Siguiente</button></div>
        </div>}
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div><h2 className="text-xl font-semibold">Auditoría administrativa</h2><p className="mt-1 text-sm text-muted-foreground">Acciones administrativas ordenadas de más recientes a más antiguas. Se muestran 10 registros por página.</p></div>
        {!audit || audit.logs.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay acciones administrativas registradas.</p> : <>
          <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="w-36 p-3">Acción</th><th className="w-40 p-3">Cuenta afectada</th><th className="w-40 p-3">Operador</th><th className="w-44 p-3">Fecha</th><th className="p-3">Motivo</th></tr></thead><tbody>{audit.logs.map(log => <tr key={log.id} className="border-b align-top last:border-0"><td className="p-3">{actionLabel(log.action)}{log.revokedCount !== null && ` (${log.revokedCount})`}</td><td className="p-3"><AuditAccount view={describeAuditAccount({ id: log.targetUserId, email: log.targetEmail, emailAtAction: log.targetEmailAtAction, found: log.targetFound })} /></td><td className="p-3"><AuditAccount view={describeAuditAccount({ id: log.actorUserId, email: log.actorEmail, emailAtAction: log.actorEmailAtAction, found: log.actorFound })} /></td><td className="p-3">{new Date(log.createdAt).toLocaleString('es-ES')}</td><td className="p-3">{log.reason ? <AuditReason reason={log.reason} /> : '—'}</td></tr>)}</tbody></table></div>
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
