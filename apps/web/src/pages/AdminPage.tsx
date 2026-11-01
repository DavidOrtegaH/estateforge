import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  getAdminAudit, getAdminOverview, getAdminUserDetail, getAdminUsers, runAdminUserAction,
  type AdminAuditAction, type AdminAuditResponse, type AdminOverview, type AdminUser, type AdminUserAction, type AdminUserDetail, type AdminUsersResponse,
} from '@/services/adminService'
import { describeAuditAccount, type AuditAccountView } from '@/lib/adminAudit'

const REASON_MIN = 3
const REASON_MAX = 500

type PendingAction = { user: AdminUser; action: AdminUserAction }
type DetailView = { userId: string; email: string; data: AdminUserDetail | null; error: string | null }
type AuditFilters = { action: AdminAuditAction | ''; target: { id: string; label: string } | null }

const NO_AUDIT_FILTERS: AuditFilters = { action: '', target: null }
const AUDIT_ACTIONS: AdminAuditAction[] = ['ACCOUNT_SUSPENDED', 'ACCOUNT_UNSUSPENDED', 'SESSIONS_REVOKED']

function auditQuery(filters: AuditFilters) {
  return { action: filters.action === '' ? undefined : filters.action, targetUserId: filters.target?.id }
}

// Estado resumido de la cuenta: la protección por incidente prevalece sobre la suspensión administrativa.
function accountStatus(user: Pick<AdminUser, 'securityHoldAt' | 'adminSuspendedAt'>) {
  if (user.securityHoldAt) return { label: 'Protección por incidente', className: 'font-medium text-red-700' }
  if (user.adminSuspendedAt) return { label: 'Suspendida por admin', className: 'font-medium text-amber-700' }
  return { label: 'Normal', className: 'text-green-700' }
}

function AccountStatus({ user }: { user: Pick<AdminUser, 'securityHoldAt' | 'adminSuspendedAt'> }) {
  const status = accountStatus(user)
  return <span className={status.className}>{status.label}</span>
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('es-ES')
}

function AuditAccount({ view, filter }: { view: AuditAccountView | null; filter?: { label: string; onClick: () => void } }) {
  if (!view) return <>—</>
  return <>
    <span className="block break-all font-medium">{view.primary}</span>
    <span className="block break-all font-mono text-xs text-muted-foreground">{view.id}</span>
    {view.note !== null && <span className="mt-1 block text-xs text-muted-foreground">{view.note}</span>}
    {filter && <button type="button" aria-label={`Filtrar el historial por ${filter.label}`} onClick={filter.onClick} className="mt-1 text-xs font-semibold text-primary underline">Filtrar</button>}
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
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(NO_AUDIT_FILTERS)
  // Identifica la última petición de auditoría; las respuestas anteriores se descartan.
  const auditRequest = useRef(0)
  // Hay una petición de auditoría vigente en curso; mientras tanto no se pagina.
  const [auditLoading, setAuditLoading] = useState(false)
  // Filtros de los registros que se están mostrando, para volver a ellos si falla un cambio.
  const shownAuditFilters = useRef<AuditFilters>(NO_AUDIT_FILTERS)
  const auditSection = useRef<HTMLElement>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailView | null>(null)
  // Identifica la última petición de detalle; las respuestas anteriores se descartan.
  const detailRequest = useRef(0)

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

  // Igual que loadUsers: devuelve null si mientras tanto se lanzó otra petición de auditoría.
  async function loadAudit(page: number, filters: AuditFilters) {
    const requestId = ++auditRequest.current
    setAuditLoading(true)
    try {
      const result = await getAdminAudit(page, auditQuery(filters))
      return requestId === auditRequest.current ? result : null
    } catch (e) {
      if (requestId !== auditRequest.current) return null
      throw e
    } finally {
      // Solo la petición vigente termina la carga; una sustituida no la toca.
      if (requestId === auditRequest.current) setAuditLoading(false)
    }
  }

  function showAudit(result: AdminAuditResponse, filters: AuditFilters) {
    setAudit(result); setAuditPage(result.pagination.page)
    shownAuditFilters.current = filters
  }

  async function refresh(nextAuditPage = auditPage) {
    const filters = auditFilters
    const [stats, users, auditResult] = await Promise.all([
      getAdminOverview(),
      loadUsers({ search: appliedSearch, page: data?.pagination.page ?? 1 }),
      loadAudit(nextAuditPage, filters),
    ])
    setOverview(stats)
    if (auditResult) showAudit(auditResult, filters)
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
    const auditRequests = auditRequest
    async function load() {
      setLoading(true); setError(null)
      const requestId = ++usersRequest.current
      const auditRequestId = ++auditRequests.current
      try {
        const [stats, users, auditResult] = await Promise.all([
          getAdminOverview(),
          getAdminUsers(),
          getAdminAudit(1),
        ])
        if (active) {
          setOverview(stats)
          if (auditRequestId === auditRequests.current) {
            setAudit(auditResult); setAuditPage(1)
            shownAuditFilters.current = NO_AUDIT_FILTERS
          }
          if (requestId === usersRequest.current) setData(users)
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Error al cargar el panel.') }
      finally { if (active) setLoading(false) }
    }
    void load()
    // Al salir del panel se invalidan las peticiones de auditoría pendientes.
    return () => { active = false; auditRequests.current += 1 }
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

  async function openDetail(user: AdminUser) {
    const requestId = ++detailRequest.current
    const base = { userId: user.id, email: user.email }
    setDetail({ ...base, data: null, error: null })
    try {
      const data = await getAdminUserDetail(user.id)
      if (requestId === detailRequest.current) setDetail({ ...base, data, error: null })
    } catch (e) {
      if (requestId === detailRequest.current) {
        setDetail({ ...base, data: null, error: e instanceof Error ? e.message : 'No se pudo cargar el detalle de la cuenta.' })
      }
    }
  }

  function closeDetail() {
    // Invalida la petición en curso para que no vuelva a abrir el diálogo al responder.
    detailRequest.current += 1
    setDetail(null)
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
    if (auditLoading || !audit || page < 1 || page > audit.pagination.pages || page === auditPage) return
    const filters = auditFilters
    try {
      setError(null)
      const result = await loadAudit(page, filters)
      if (result) showAudit(result, filters)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la auditoría.') }
  }

  // Cualquier cambio de filtros vuelve a la página 1.
  async function applyAuditFilters(filters: AuditFilters) {
    setAuditFilters(filters); setError(null)
    try {
      const result = await loadAudit(1, filters)
      if (result) showAudit(result, filters)
    } catch (e) {
      // Los controles vuelven a los filtros de los registros que siguen en pantalla.
      setAuditFilters(shownAuditFilters.current)
      setError(e instanceof Error ? e.message : 'No se pudo cargar la auditoría.')
    }
  }

  function showAccountHistory(target: { id: string; label: string }) {
    closeDetail()
    void applyAuditFilters({ ...auditFilters, target })
    auditSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const hasAuditFilters = auditFilters.action !== '' || auditFilters.target !== null

  function targetFilter(id: string, label: string) {
    return { label, onClick: () => void applyAuditFilters({ ...auditFilters, target: { id, label } }) }
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
            <td className="p-3"><div><AccountStatus user={user} /></div>{user.adminSuspensionReason && <p className="mt-1 max-w-56 whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">Motivo: {user.adminSuspensionReason}</p>}</td>
            <td className="p-3"><div className="flex min-w-40 flex-col items-start gap-2"><button type="button" disabled={busyUserId === user.id} onClick={() => void openDetail(user)} className="text-xs font-semibold text-foreground underline disabled:opacity-50">Ver detalle</button>{user.role !== 'OWNER' && <>
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
      <section ref={auditSection} className="scroll-mt-6 space-y-4 rounded-xl border bg-card p-5">
        <div><h2 className="text-xl font-semibold">Auditoría administrativa</h2><p className="mt-1 text-sm text-muted-foreground">Acciones administrativas ordenadas de más recientes a más antiguas. Se muestran 10 registros por página.</p></div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Acción</span>
            <select value={auditFilters.action} onChange={event => void applyAuditFilters({ ...auditFilters, action: event.target.value as AdminAuditAction | '' })} className="rounded-lg border bg-background px-3 py-2 text-sm">
              <option value="">Todas</option>
              {AUDIT_ACTIONS.map(action => <option key={action} value={action}>{actionLabel(action)}</option>)}
            </select>
          </label>
          {auditFilters.target && <p className="flex flex-wrap items-center gap-2 text-sm">Cuenta afectada: <span className="break-all font-medium">{auditFilters.target.label}</span><button type="button" onClick={() => void applyAuditFilters({ ...auditFilters, target: null })} className="text-xs font-semibold text-primary underline">Quitar filtro</button></p>}
          {hasAuditFilters && <button type="button" onClick={() => void applyAuditFilters(NO_AUDIT_FILTERS)} className="rounded-lg border px-3 py-2 text-sm font-medium">Limpiar filtros</button>}
        </div>
        {!audit || audit.logs.length === 0 ? <p className="text-sm text-muted-foreground">{hasAuditFilters ? 'No hay acciones que coincidan con los filtros.' : 'Todavía no hay acciones administrativas registradas.'}</p> : <>
          <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="w-36 p-3">Acción</th><th className="w-40 p-3">Cuenta afectada</th><th className="w-40 p-3">Operador</th><th className="w-44 p-3">Fecha</th><th className="p-3">Motivo</th></tr></thead><tbody>{audit.logs.map(log => <tr key={log.id} className="border-b align-top last:border-0"><td className="p-3">{actionLabel(log.action)}{log.revokedCount !== null && ` (${log.revokedCount})`}</td><td className="p-3"><AuditAccount view={describeAuditAccount({ id: log.targetUserId, email: log.targetEmail, emailAtAction: log.targetEmailAtAction, found: log.targetFound })} filter={log.targetUserId !== null && auditFilters.target?.id !== log.targetUserId ? targetFilter(log.targetUserId, log.targetEmail ?? log.targetEmailAtAction ?? log.targetUserId) : undefined} /></td><td className="p-3"><AuditAccount view={describeAuditAccount({ id: log.actorUserId, email: log.actorEmail, emailAtAction: log.actorEmailAtAction, found: log.actorFound })} /></td><td className="p-3">{new Date(log.createdAt).toLocaleString('es-ES')}</td><td className="p-3">{log.reason ? <AuditReason reason={log.reason} /> : '—'}</td></tr>)}</tbody></table></div>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{audit.pagination.total} acciones · Página {audit.pagination.page} de {Math.max(1, audit.pagination.pages)}</p>
            <div className="flex items-center gap-2"><button type="button" onClick={() => void changeAuditPage(auditPage - 1)} disabled={auditLoading || auditPage <= 1} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">Anterior</button><button type="button" onClick={() => void changeAuditPage(auditPage + 1)} disabled={auditLoading || auditPage >= audit.pagination.pages} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">Siguiente</button></div>
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

      {detail && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) closeDetail() }}>
        <section role="dialog" aria-modal="true" aria-labelledby="admin-detail-title" aria-busy={!detail.data && !detail.error} className="my-auto w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl">
          <h2 id="admin-detail-title" className="text-xl font-semibold">Detalle de la cuenta</h2>
          <p className="mt-1 break-all text-sm text-muted-foreground">{detail.email}</p>
          {detail.error ? <p role="alert" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{detail.error}</p>
            : !detail.data ? <p className="mt-5 text-sm text-muted-foreground">Cargando…</p>
            : <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Email</dt><dd className="break-all font-medium">{detail.data.email}</dd>
              <dt className="text-muted-foreground">Identificador</dt><dd className="break-all font-mono text-xs">{detail.data.id}</dd>
              <dt className="text-muted-foreground">Rol</dt><dd>{detail.data.role === 'OWNER' ? 'Propietario' : 'Usuario'}</dd>
              <dt className="text-muted-foreground">Alta</dt><dd>{formatDateTime(detail.data.createdAt)}</dd>
              <dt className="text-muted-foreground">Inmuebles</dt><dd>{detail.data.properties}</dd>
              <dt className="text-muted-foreground">Sesiones activas</dt><dd>{detail.data.activeSessions}</dd>
              <dt className="text-muted-foreground">Estado</dt><dd><AccountStatus user={detail.data} /></dd>
              <dt className="text-muted-foreground">Protección por incidente</dt><dd>{detail.data.securityHoldAt ? `Activa desde ${formatDateTime(detail.data.securityHoldAt)}` : 'No'}</dd>
              <dt className="text-muted-foreground">Suspensión administrativa</dt><dd>{detail.data.adminSuspendedAt ? `Activa desde ${formatDateTime(detail.data.adminSuspendedAt)}` : 'No'}</dd>
              {detail.data.adminSuspensionReason !== null && <><dt className="text-muted-foreground">Motivo de la suspensión</dt><dd className="whitespace-pre-wrap wrap-break-word">{detail.data.adminSuspensionReason}</dd></>}
            </dl>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => showAccountHistory({ id: detail.userId, label: detail.email })} className="rounded-lg border px-4 py-2 text-sm font-medium">Ver su historial de auditoría</button><button type="button" autoFocus onClick={closeDetail} className="rounded-lg border px-4 py-2 text-sm font-medium">Cerrar</button></div>
        </section>
      </div>}
    </main>
  )
}
