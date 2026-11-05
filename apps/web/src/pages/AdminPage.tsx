import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  changeRecoveryDestination, getAdminAudit, getAdminOverview, getAdminUserDetail, getAdminUsers, resendRecoveryLink, resolveSecurityHold, runAdminUserAction,
  type AdminAuditAction, type AdminAuditLog, type AdminAuditResponse, type AdminOverview, type AdminPanelAction, type AdminRecoveryResult, type AdminUser, type AdminUserDetail, type AdminUsersResponse,
} from '@/services/adminService'
import { actionNotice, adminActionErrorMessage, recoveryEmailError, recoveryEmailField, recoveryEmailToSend, RECOVERY_EMAIL_MAX, showsRecoveryDestination, tryStartOnce, type ActionNotice } from '@/lib/adminRecovery'
import { AUDIT_ACTIONS, auditActionLabel, describeAuditAccount, describeAuditAction, describeAuditActor, type AuditAccountView } from '@/lib/adminAudit'
import { userActionsAvailability } from '@/lib/adminUserActions'
import { accountStatuses } from '@/lib/adminAccountStatus'
import { auditEmptyMessage, runActionThenRefresh, settleLatest, startLatestIndicator, visibleErrors, withScopeError, type AdminErrorScope, type AdminErrors } from '@/lib/adminPageState'
import { useModalDialog } from '@/hooks/useModalDialog'

const REASON_MIN = 3
const REASON_MAX = 500

type PendingAction = { user: AdminUser; action: AdminPanelAction }
type DetailView = { userId: string; email: string; data: AdminUserDetail | null; error: string | null }
type AuditFilters = { action: AdminAuditAction | ''; target: { id: string; label: string } | null }

const NO_AUDIT_FILTERS: AuditFilters = { action: '', target: null }

function auditQuery(filters: AuditFilters) {
  return { action: filters.action === '' ? undefined : filters.action, targetUserId: filters.target?.id }
}

// Estado de la cuenta: si concurren varios estados (protección, suspensión, recuperación) se muestran todos.
function AccountStatus({ user }: { user: Pick<AdminUser, 'securityHoldAt' | 'adminSuspendedAt' | 'passwordResetRequiredAt'> }) {
  return <>{accountStatuses(user).map((status, index) => <Fragment key={status.label}>{index > 0 && ' · '}<span className={status.className}>{status.label}</span></Fragment>)}</>
}

// Destino de la recuperación: dato personal, solo en el panel OWNER y cuando es pertinente.
function RecoveryDestination({ user, className }: { user: Pick<AdminUser, 'securityHoldAt' | 'passwordResetRequiredAt' | 'securityRecoveryEmail'>; className: string }) {
  if (!showsRecoveryDestination(user)) return null
  return <p className={className}>Destino de recuperación: <span className="break-all">{user.securityRecoveryEmail}</span></p>
}

const USER_ACTION_BUTTONS: Record<AdminPanelAction, { label: string; tone: string }> = {
  unsuspend: { label: 'Reactivar cuenta', tone: 'text-primary' },
  suspend: { label: 'Suspender cuenta', tone: 'text-red-700' },
  'revoke-sessions': { label: 'Cerrar sesiones', tone: 'text-muted-foreground' },
  'resolve-security-hold': { label: 'Retirar protección', tone: 'text-primary' },
  'recovery-destination': { label: 'Corregir destino', tone: 'text-primary' },
  'resend-recovery': { label: 'Reenviar enlace', tone: 'text-primary' },
}

// Acciones de una cuenta. Tabla (escritorio) y tarjetas (móvil) usan la misma disponibilidad;
// solo cambia la presentación.
function UserActions({ user, busyUserId, variant, onDetail, onAction }: {
  user: AdminUser
  busyUserId: string | null
  variant: 'table' | 'card'
  onDetail: () => void
  onAction: (action: AdminPanelAction) => void
}) {
  const availability = userActionsAvailability(user, busyUserId)
  if (variant === 'table') {
    return <div className="flex min-w-40 flex-col items-start gap-2"><button type="button" disabled={availability.detailDisabled} onClick={onDetail} className="text-xs font-semibold text-foreground underline disabled:opacity-50">Ver detalle</button>
      {availability.actions.map(({ action, disabled, title }) => <button key={action} disabled={disabled} title={title} onClick={() => onAction(action)} className={`text-xs font-semibold ${USER_ACTION_BUTTONS[action].tone} underline disabled:opacity-50`}>{USER_ACTION_BUTTONS[action].label}</button>)}
    </div>
  }
  const notes = availability.actions.flatMap(({ title }) => title ? [title] : [])
  const button = 'inline-flex min-h-10 flex-1 basis-36 items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
  return <>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={availability.detailDisabled} onClick={onDetail} className={`${button} text-foreground`}>Ver detalle</button>
      {availability.actions.map(({ action, disabled, title }) => <button key={action} type="button" disabled={disabled} title={title} onClick={() => onAction(action)} className={`${button} ${USER_ACTION_BUTTONS[action].tone}`}>{USER_ACTION_BUTTONS[action].label}</button>)}
    </div>
    {notes.map(note => <p key={note} className="mt-2 text-xs text-muted-foreground">{note}</p>)}
  </>
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('es-ES')
}

function AuditAccount({ view, filter }: { view: AuditAccountView | null; filter?: { label: string; onClick: () => void } }) {
  if (!view) return <>—</>
  return <>
    <span className="block break-all font-medium">{view.primary}</span>
    {view.id !== null && <span className="block break-all font-mono text-xs text-muted-foreground">{view.id}</span>}
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

function actionTitle(action: AdminPanelAction) {
  if (action === 'suspend') return 'Suspender cuenta'
  if (action === 'unsuspend') return 'Reactivar cuenta'
  if (action === 'resolve-security-hold') return 'Retirar la protección por incidente'
  if (action === 'recovery-destination') return 'Corregir el destino de recuperación'
  if (action === 'resend-recovery') return 'Reenviar el enlace de recuperación'
  return 'Cerrar todas las sesiones'
}

function actionDescription(action: AdminPanelAction, user: AdminUser) {
  const { email } = user
  const destination = user.securityRecoveryEmail
  if (action === 'suspend') return `La cuenta ${email} quedará suspendida y se cerrarán sus sesiones.`
  if (action === 'unsuspend') return `Se retirará la suspensión administrativa de ${email}. Una protección por incidente de seguridad seguirá activa.`
  if (action === 'resolve-security-hold') {
    return `Se retirará la protección de ${email} y la cuenta quedará en recuperación obligatoria: no podrá acceder hasta establecer una contraseña nueva con el enlace que se enviará ${destination ? `al destino guardado (${destination}) o al email que indiques` : 'al email que indiques'}.`
  }
  if (action === 'recovery-destination') {
    return `Se cambiará el destino de recuperación de ${email}${destination ? ` (ahora ${destination})` : ''} y se enviará un enlace nuevo; los anteriores dejarán de ser válidos.`
  }
  if (action === 'resend-recovery') return `Se enviará un enlace de recuperación nuevo a ${destination ?? 'el destino guardado'}; los anteriores dejarán de ser válidos.`
  return `Se cerrarán todas las sesiones activas de ${email}.`
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [data, setData] = useState<AdminUsersResponse | null>(null)
  const [audit, setAudit] = useState<AdminAuditResponse | null>(null)
  const [search, setSearch] = useState('')
  // Último filtro enviado; search es solo el texto que se está escribiendo.
  const [appliedSearch, setAppliedSearch] = useState('')
  // Un error por operación: cada una solo crea o borra el suyo.
  const [errors, setErrors] = useState<AdminErrors>({})
  // Aviso tras una acción completada: éxito, o advertencia si el enlace de recuperación no se envió.
  const [notice, setNotice] = useState<ActionNotice | null>(null)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [changingUsersPage, setChangingUsersPage] = useState(false)
  // Última búsqueda y último cambio de página iniciados: solo ellos apagan su indicador.
  const searchIndicator = useRef(0)
  const usersPageIndicator = useRef(0)
  // Identifica la última petición de usuarios; las respuestas anteriores se descartan.
  const usersRequest = useRef(0)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [auditPage, setAuditPage] = useState(1)
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(NO_AUDIT_FILTERS)
  // Identifica la última petición de auditoría; las respuestas anteriores se descartan.
  const auditRequest = useRef(0)
  // Hay una petición de auditoría vigente en curso; mientras tanto no se pagina.
  const [auditLoading, setAuditLoading] = useState(false)
  // Filtros de los registros que se están mostrando: deciden el mensaje de la lista vacía y
  // son a los que vuelven los controles si falla un cambio.
  const [shownAuditFilters, setShownAuditFilters] = useState<AuditFilters>(NO_AUDIT_FILTERS)
  const auditSection = useRef<HTMLElement>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  // Email de recuperación del diálogo (retirar la protección o corregir el destino).
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryEmailMessage, setRecoveryEmailMessage] = useState<string | null>(null)
  // Hay un envío de acción en curso: impide un segundo envío antes de volver a renderizar.
  const actionInFlight = useRef(false)
  const [detail, setDetail] = useState<DetailView | null>(null)
  // Identifica la última petición de detalle; las respuestas anteriores se descartan.
  const detailRequest = useRef(0)
  const actionReasonRef = useRef<HTMLTextAreaElement>(null)
  const detailCloseRef = useRef<HTMLButtonElement>(null)
  // Mientras se procesa la acción, ni Escape ni el fondo cierran el diálogo.
  const actionDialogRef = useModalDialog<HTMLElement>({
    open: pendingAction !== null,
    onClose: () => setPendingAction(null),
    canClose: !busyUserId,
    initialFocusRef: actionReasonRef,
  })
  const detailDialogRef = useModalDialog<HTMLElement>({
    open: detail !== null,
    onClose: () => closeDetail(),
    initialFocusRef: detailCloseRef,
  })

  function setError(scope: AdminErrorScope, message: string | null) {
    setErrors(current => withScopeError(current, scope, message))
  }

  // Devuelve null si mientras tanto se lanzó otra petición de usuarios (también si falla).
  async function loadUsers(query: { search: string; page: number }) {
    const requestId = ++usersRequest.current
    const result = await settleLatest(getAdminUsers(query), () => requestId === usersRequest.current)
    return result.current ? result.value : null
  }

  // Igual que loadUsers: devuelve null si mientras tanto se lanzó otra petición de auditoría.
  async function loadAudit(page: number, filters: AuditFilters) {
    const requestId = ++auditRequest.current
    setAuditLoading(true)
    try {
      const result = await settleLatest(getAdminAudit(page, auditQuery(filters)), () => requestId === auditRequest.current)
      return result.current ? result.value : null
    } finally {
      // Solo la petición vigente termina la carga; una sustituida no la toca.
      if (requestId === auditRequest.current) setAuditLoading(false)
    }
  }

  function showAudit(result: AdminAuditResponse, filters: AuditFilters) {
    setAudit(result); setAuditPage(result.pagination.page)
    setShownAuditFilters(filters)
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
      setLoading(true); setErrors(current => withScopeError(current, 'load', null))
      const requestId = ++usersRequest.current
      const auditRequestId = ++auditRequests.current
      try {
        // Si mientras tanto se lanzó otra búsqueda o un cambio de filtros, la respuesta inicial
        // de usuarios o de auditoría se descarta, también si falla.
        const [stats, users, auditResult] = await Promise.all([
          getAdminOverview(),
          settleLatest(getAdminUsers(), () => requestId === usersRequest.current),
          settleLatest(getAdminAudit(1), () => auditRequestId === auditRequests.current),
        ])
        if (active) {
          setOverview(stats)
          if (auditResult.current) {
            setAudit(auditResult.value); setAuditPage(1)
            setShownAuditFilters(NO_AUDIT_FILTERS)
          }
          if (users.current) setData(users.value)
        }
      } catch (e) { if (active) setErrors(current => withScopeError(current, 'load', e instanceof Error ? e.message : 'Error al cargar el panel.')) }
      finally { if (active) setLoading(false) }
    }
    void load()
    // Al salir del panel se invalidan las peticiones de auditoría pendientes.
    return () => { active = false; auditRequests.current += 1 }
  }, [])

  async function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (searching) return
    const finishSearching = startLatestIndicator(searchIndicator, setSearching); setError('users', null)
    const submittedSearch = search
    try {
      const users = await loadUsers({ search: submittedSearch, page: 1 })
      if (users) { setData(users); setAppliedSearch(submittedSearch) }
    }
    catch (e) { setError('users', e instanceof Error ? e.message : 'Error de búsqueda.') }
    finally { finishSearching() }
  }

  async function changeUsersPage(page: number) {
    if (!data || page < 1 || page > data.pagination.pages || page === data.pagination.page) return
    const finishChangingPage = startLatestIndicator(usersPageIndicator, setChangingUsersPage); setError('users', null)
    try {
      const users = await loadUsers({ search: appliedSearch, page })
      if (users) setData(users)
    } catch (e) { setError('users', e instanceof Error ? e.message : 'No se pudo cargar la página de usuarios.') }
    finally { finishChangingPage() }
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

  function openAction(user: AdminUser, action: AdminPanelAction) {
    setPendingAction({ user, action })
    setReason('')
    setReasonError(null)
    setRecoveryEmail('')
    setRecoveryEmailMessage(null)
    setError('action', null)
  }

  // Llama a la API de la acción. Las de recuperación devuelven además si se envió el enlace.
  function performAction(user: AdminUser, action: AdminPanelAction, reasonText: string, email: string | undefined): Promise<{ message: string } | AdminRecoveryResult> {
    if (action === 'resolve-security-hold') return resolveSecurityHold(user.id, reasonText, email)
    if (action === 'recovery-destination') return changeRecoveryDestination(user.id, reasonText, email ?? '')
    if (action === 'resend-recovery') return resendRecoveryLink(user.id, reasonText)
    return runAdminUserAction(user.id, action, reasonText)
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pendingAction || busyUserId) return
    const trimmedReason = reason.trim()
    const emailField = recoveryEmailField(pendingAction.action, pendingAction.user)
    const emailMessage = recoveryEmailError(emailField, recoveryEmail)
    const reasonInvalid = trimmedReason.length < REASON_MIN || trimmedReason.length > REASON_MAX
    if (reasonInvalid) setReasonError(`Escribe un motivo de entre ${REASON_MIN} y ${REASON_MAX} caracteres.`)
    setRecoveryEmailMessage(emailMessage)
    if (reasonInvalid || emailMessage) return
    // Un segundo envío (doble clic antes de desactivar el botón) no repite la acción.
    const release = tryStartOnce(actionInFlight)
    if (!release) return

    const { user, action } = pendingAction
    const email = recoveryEmailToSend(emailField, recoveryEmail)
    setBusyUserId(user.id); setError('action', null); setError('refresh', null); setNotice(null)
    try {
      // La acción se ejecuta una sola vez; si después falla el refresco, se avisa de eso y
      // no de un fallo de la acción. El aviso solo aparece con la respuesta del servidor.
      // Respuesta de la acción, para saber en el aviso si se envió el enlace.
      const response: { result: { message: string; recoveryEmailSent?: boolean } | null } = { result: null }
      const outcome = await runActionThenRefresh(
        async () => {
          try {
            response.result = await performAction(user, action, trimmedReason, email)
            return response.result
          } catch (e) {
            throw new Error(adminActionErrorMessage(e))
          }
        },
        message => { setNotice(actionNotice(response.result ?? { message })); setPendingAction(null); setReason(''); setRecoveryEmail('') },
        () => refresh(1),
      )
      if (outcome.kind === 'failed') setError('action', outcome.error)
      else setError('refresh', outcome.refreshError)
    } finally { setBusyUserId(null); release() }
  }

  async function changeAuditPage(page: number) {
    if (auditLoading || !audit || page < 1 || page > audit.pagination.pages || page === auditPage) return
    const filters = auditFilters
    try {
      setError('audit', null)
      const result = await loadAudit(page, filters)
      if (result) showAudit(result, filters)
    } catch (e) { setError('audit', e instanceof Error ? e.message : 'No se pudo cargar la auditoría.') }
  }

  // Cualquier cambio de filtros vuelve a la página 1.
  async function applyAuditFilters(filters: AuditFilters) {
    setAuditFilters(filters); setError('audit', null)
    try {
      const result = await loadAudit(1, filters)
      if (result) showAudit(result, filters)
    } catch (e) {
      // Los controles vuelven a los filtros de los registros que siguen en pantalla. Solo la
      // petición vigente llega aquí, así que esos filtros no han cambiado desde que empezó.
      setAuditFilters(shownAuditFilters)
      setError('audit', e instanceof Error ? e.message : 'No se pudo cargar la auditoría.')
    }
  }

  function showAccountHistory(target: { id: string; label: string }) {
    closeDetail()
    void applyAuditFilters({ ...auditFilters, target })
    // Con «reducir movimiento» activado en el sistema, el desplazamiento es inmediato.
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    auditSection.current?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' })
  }

  const hasAuditFilters = auditFilters.action !== '' || auditFilters.target !== null

  function targetFilter(id: string, label: string) {
    return { label, onClick: () => void applyAuditFilters({ ...auditFilters, target: { id, label } }) }
  }

  // Lo que muestra cada registro; la tabla (escritorio) y las tarjetas (móvil) lo comparten.
  function auditRow(log: AdminAuditLog) {
    return {
      action: describeAuditAction(log),
      target: describeAuditAccount({ id: log.targetUserId, email: log.targetEmail, emailAtAction: log.targetEmailAtAction, found: log.targetFound }),
      targetFilter: log.targetUserId !== null && auditFilters.target?.id !== log.targetUserId ? targetFilter(log.targetUserId, log.targetEmail ?? log.targetEmailAtAction ?? log.targetUserId) : undefined,
      actor: describeAuditActor({ id: log.actorUserId, email: log.actorEmail, emailAtAction: log.actorEmailAtAction, found: log.actorFound }),
      date: new Date(log.createdAt).toLocaleString('es-ES'),
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-0 md:p-6 lg:p-10">
      <header><p className="text-sm font-medium text-primary">ESTATEFORGE · CONTROL DEL SAAS</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Administración</h1><p className="mt-2 text-sm text-muted-foreground">Vista general de la plataforma y gestión de cuentas.</p></header>
      {visibleErrors(errors).map(({ scope, message }) => <div key={scope} role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">{message}</div>)}
      {notice && <div role="status" className={notice.tone === 'warning' ? 'rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900' : 'rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-800'}>{notice.message}</div>}
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-5">
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
          <div className="hidden md:block"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">Cuenta</th><th className="p-3">Rol</th><th className="p-3">Inmuebles</th><th className="p-3">Alta</th><th className="p-3">Estado</th><th className="p-3">Acciones</th></tr></thead><tbody>{data?.users.map(user => <tr key={user.id} className="border-b align-top last:border-0">
            <td className="p-3"><div className="font-medium">{user.email}</div><div className="max-w-52 truncate text-xs text-muted-foreground">{user.id}</div></td>
            <td className="p-3">{user.role === 'OWNER' ? 'Propietario' : 'Usuario'}</td><td className="p-3">{user.properties}</td><td className="p-3 whitespace-nowrap">{new Date(user.createdAt).toLocaleDateString('es-ES')}</td>
            <td className="p-3"><div><AccountStatus user={user} /></div>{user.adminSuspensionReason && <p className="mt-1 max-w-56 whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">Motivo: {user.adminSuspensionReason}</p>}<RecoveryDestination user={user} className="mt-1 max-w-56 text-xs text-muted-foreground" /></td>
            <td className="p-3"><UserActions variant="table" user={user} busyUserId={busyUserId} onDetail={() => void openDetail(user)} onAction={action => openAction(user, action)} /></td>
          </tr>)}</tbody></table></div>
          <ul className="space-y-3 md:hidden">{data?.users.map(user => <li key={user.id} className="rounded-lg border bg-background p-4">
            <p className="break-all font-medium">{user.email}</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{user.id}</p>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Estado</dt><dd><AccountStatus user={user} /></dd>
              {user.adminSuspensionReason && <><dt className="text-muted-foreground">Motivo</dt><dd className="whitespace-pre-wrap wrap-anywhere">{user.adminSuspensionReason}</dd></>}
              {showsRecoveryDestination(user) && <><dt className="text-muted-foreground">Destino</dt><dd className="wrap-anywhere">{user.securityRecoveryEmail}</dd></>}
              <dt className="text-muted-foreground">Rol</dt><dd>{user.role === 'OWNER' ? 'Propietario' : 'Usuario'}</dd>
              <dt className="text-muted-foreground">Inmuebles</dt><dd>{user.properties}</dd>
              <dt className="text-muted-foreground">Alta</dt><dd>{new Date(user.createdAt).toLocaleDateString('es-ES')}</dd>
            </dl>
            <div className="mt-4 border-t pt-3"><UserActions variant="card" user={user} busyUserId={busyUserId} onDetail={() => void openDetail(user)} onAction={action => openAction(user, action)} /></div>
          </li>)}</ul>
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
              {AUDIT_ACTIONS.map(action => <option key={action} value={action}>{auditActionLabel(action)}</option>)}
            </select>
          </label>
          {auditFilters.target && <p className="flex flex-wrap items-center gap-2 text-sm">Cuenta afectada: <span className="break-all font-medium">{auditFilters.target.label}</span><button type="button" aria-label="Quitar filtro de cuenta afectada" onClick={() => void applyAuditFilters({ ...auditFilters, target: null })} className="text-xs font-semibold text-primary underline">Quitar filtro</button></p>}
          {hasAuditFilters && <button type="button" onClick={() => void applyAuditFilters(NO_AUDIT_FILTERS)} className="rounded-lg border px-3 py-2 text-sm font-medium">Limpiar filtros</button>}
        </div>
        {!audit || audit.logs.length === 0 ? <p className="text-sm text-muted-foreground">{auditEmptyMessage(shownAuditFilters)}</p> : <>
          <div className="hidden overflow-x-auto md:block"><table className="w-full table-fixed text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="w-36 p-3">Acción</th><th className="w-40 p-3">Cuenta afectada</th><th className="w-40 p-3">Operador</th><th className="w-44 p-3">Fecha</th><th className="p-3">Motivo</th></tr></thead><tbody>{audit.logs.map(log => { const row = auditRow(log); return <tr key={log.id} className="border-b align-top last:border-0"><td className="p-3">{row.action}</td><td className="p-3"><AuditAccount view={row.target} filter={row.targetFilter} /></td><td className="p-3"><AuditAccount view={row.actor} /></td><td className="p-3">{row.date}</td><td className="p-3">{log.reason ? <AuditReason reason={log.reason} /> : '—'}</td></tr> })}</tbody></table></div>
          <ul className="space-y-3 md:hidden">{audit.logs.map(log => { const row = auditRow(log); return <li key={log.id} className="rounded-lg border bg-background p-4">
            <p className="wrap-anywhere font-medium">{row.action}</p>
            <p className="mt-1 text-xs text-muted-foreground"><time dateTime={log.createdAt}>{row.date}</time></p>
            <dl className="mt-3 space-y-3 text-sm">
              <div><dt className="text-muted-foreground">Cuenta afectada</dt><dd className="mt-1"><AuditAccount view={row.target} filter={row.targetFilter} /></dd></div>
              <div><dt className="text-muted-foreground">Operador</dt><dd className="mt-1"><AuditAccount view={row.actor} /></dd></div>
              <div><dt className="text-muted-foreground">Motivo</dt><dd className="mt-1">{log.reason ? <AuditReason reason={log.reason} /> : '—'}</dd></div>
            </dl>
          </li> })}</ul>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{audit.pagination.total} acciones · Página {audit.pagination.page} de {Math.max(1, audit.pagination.pages)}</p>
            <div className="flex items-center gap-2"><button type="button" onClick={() => void changeAuditPage(auditPage - 1)} disabled={auditLoading || auditPage <= 1} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">Anterior</button><button type="button" onClick={() => void changeAuditPage(auditPage + 1)} disabled={auditLoading || auditPage >= audit.pagination.pages} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">Siguiente</button></div>
          </div>
        </>}
      </section>

      {pendingAction && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busyUserId) setPendingAction(null) }}>
        <section ref={actionDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="admin-action-title" aria-describedby="admin-action-description" className="my-auto w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl">
          <h2 id="admin-action-title" className="text-xl font-semibold">{actionTitle(pendingAction.action)}</h2>
          <p id="admin-action-description" className="mt-2 text-sm text-muted-foreground">{actionDescription(pendingAction.action, pendingAction.user)}</p>
          <form onSubmit={submitAction} noValidate className="mt-5 space-y-3">
            <label htmlFor="admin-action-reason" className="block text-sm font-medium">Motivo <span className="text-muted-foreground">(obligatorio)</span></label>
            <textarea id="admin-action-reason" ref={actionReasonRef} rows={4} maxLength={REASON_MAX} value={reason} onChange={event => { setReason(event.target.value); if (reasonError) setReasonError(null) }} aria-invalid={!!reasonError} aria-describedby="admin-action-reason-help admin-action-reason-error" placeholder="Explica brevemente por qué realizas esta acción…" className={`w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${reasonError ? 'border-red-500 focus-visible:ring-red-400' : ''}`} />
            <div className="flex items-start justify-between gap-3"><p id="admin-action-reason-help" className="text-xs text-muted-foreground">Entre {REASON_MIN} y {REASON_MAX} caracteres. Se guardará en la auditoría.</p><p className="shrink-0 text-xs tabular-nums text-muted-foreground">{reason.trim().length}/{REASON_MAX}</p></div>
            {reasonError && <p id="admin-action-reason-error" role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{reasonError}</p>}
            {(() => {
              const field = recoveryEmailField(pendingAction.action, pendingAction.user)
              if (field === 'none') return null
              return <>
                <label htmlFor="admin-action-recovery-email" className="block text-sm font-medium">Email de recuperación <span className="text-muted-foreground">({field === 'required' ? 'obligatorio' : 'opcional'})</span></label>
                <input id="admin-action-recovery-email" type="email" inputMode="email" autoComplete="off" maxLength={RECOVERY_EMAIL_MAX} aria-required={field === 'required'} value={recoveryEmail} onChange={event => { setRecoveryEmail(event.target.value); if (recoveryEmailMessage) setRecoveryEmailMessage(null) }} aria-invalid={!!recoveryEmailMessage} aria-describedby="admin-action-recovery-email-help admin-action-recovery-email-error" placeholder={field === 'optional' && pendingAction.user.securityRecoveryEmail ? pendingAction.user.securityRecoveryEmail : 'nombre@ejemplo.com'} className={`w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${recoveryEmailMessage ? 'border-red-500 focus-visible:ring-red-400' : ''}`} />
                <p id="admin-action-recovery-email-help" className="text-xs text-muted-foreground">{field === 'optional' ? 'Déjalo vacío para usar el destino guardado.' : 'El enlace de recuperación se enviará a este email.'}</p>
                {recoveryEmailMessage && <p id="admin-action-recovery-email-error" role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{recoveryEmailMessage}</p>}
              </>
            })()}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end"><button type="button" disabled={!!busyUserId} onClick={() => setPendingAction(null)} className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50">Cancelar</button><button type="submit" disabled={!!busyUserId} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-60">{busyUserId ? 'Procesando…' : 'Confirmar acción'}</button></div>
          </form>
        </section>
      </div>}

      {detail && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) closeDetail() }}>
        <section ref={detailDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="admin-detail-title" aria-busy={!detail.data && !detail.error} className="my-auto w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl">
          <h2 id="admin-detail-title" className="text-xl font-semibold">Detalle de la cuenta</h2>
          <p className="mt-1 break-all text-sm text-muted-foreground">{detail.email}</p>
          {detail.error ? <p role="alert" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{detail.error}</p>
            : !detail.data ? <p className="mt-5 text-sm text-muted-foreground">Cargando…</p>
            : <dl className="mt-5 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">Email</dt><dd className="break-all font-medium">{detail.data.email}</dd>
              <dt className="text-muted-foreground">Identificador</dt><dd className="break-all font-mono text-xs">{detail.data.id}</dd>
              <dt className="text-muted-foreground">Rol</dt><dd>{detail.data.role === 'OWNER' ? 'Propietario' : 'Usuario'}</dd>
              <dt className="text-muted-foreground">Alta</dt><dd>{formatDateTime(detail.data.createdAt)}</dd>
              <dt className="text-muted-foreground">Inmuebles</dt><dd>{detail.data.properties}</dd>
              <dt className="text-muted-foreground">Sesiones activas</dt><dd>{detail.data.activeSessions}</dd>
              <dt className="text-muted-foreground">Estado</dt><dd><AccountStatus user={detail.data} /></dd>
              <dt className="text-muted-foreground">Protección por incidente</dt><dd>{detail.data.securityHoldAt ? `Activa desde ${formatDateTime(detail.data.securityHoldAt)}` : 'No'}</dd>
              <dt className="text-muted-foreground">Suspensión administrativa</dt><dd>{detail.data.adminSuspendedAt ? `Activa desde ${formatDateTime(detail.data.adminSuspendedAt)}` : 'No'}</dd>
              <dt className="text-muted-foreground">Recuperación obligatoria</dt><dd>{detail.data.passwordResetRequiredAt ? `Pendiente desde ${formatDateTime(detail.data.passwordResetRequiredAt)}` : 'No'}</dd>
              <dt className="text-muted-foreground">Destino de recuperación</dt><dd className="break-all">{detail.data.securityRecoveryEmail ?? 'Sin destino guardado'}</dd>
              {detail.data.adminSuspensionReason !== null && <><dt className="text-muted-foreground">Motivo de la suspensión</dt><dd className="whitespace-pre-wrap wrap-break-word">{detail.data.adminSuspensionReason}</dd></>}
            </dl>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => showAccountHistory({ id: detail.userId, label: detail.email })} className="rounded-lg border px-4 py-2 text-sm font-medium">Ver su historial de auditoría</button><button type="button" ref={detailCloseRef} onClick={closeDetail} className="rounded-lg border px-4 py-2 text-sm font-medium">Cerrar</button></div>
        </section>
      </div>}
    </main>
  )
}
