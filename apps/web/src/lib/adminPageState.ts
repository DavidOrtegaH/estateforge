// Estado asíncrono del panel de administración: peticiones que se sustituyen, errores por
// operación y el resultado de una acción seguida del refresco de datos. Son funciones puras
// (o que solo esperan las promesas que reciben) para poder probarlas sin DOM.

export type LatestResult<T> = { current: true; value: T } | { current: false }

/**
 * Espera una petición y la descarta si, mientras tanto, se lanzó otra más reciente
 * (isCurrent() devuelve false al terminar): ni su resultado ni su error deben tocar la
 * interfaz. Si sigue siendo la vigente, devuelve su valor o propaga su error.
 */
export async function settleLatest<T>(
  request: Promise<T>,
  isCurrent: () => boolean,
): Promise<LatestResult<T>> {
  try {
    const value = await request
    return isCurrent() ? { current: true, value } : { current: false }
  } catch (error) {
    if (!isCurrent()) return { current: false }
    throw error
  }
}

/**
 * Enciende un indicador de carga («Buscando…», cambio de página) y devuelve la función que lo
 * apaga al terminar. Si mientras tanto se inició otra operación del mismo indicador, la
 * anterior ya no lo apaga: solo lo hace la más reciente. counter es una ref por indicador.
 */
export function startLatestIndicator(
  counter: { current: number },
  setActive: (active: boolean) => void,
): () => void {
  const id = ++counter.current
  setActive(true)
  return () => {
    if (id === counter.current) setActive(false)
  }
}

/** Mensaje de la auditoría vacía según los filtros de los registros que se muestran. */
export function auditEmptyMessage(shownFilters: { action: string; target: unknown }): string {
  return shownFilters.action !== '' || shownFilters.target !== null
    ? 'No hay acciones que coincidan con los filtros.'
    : 'Todavía no hay acciones administrativas registradas.'
}

// Cada operación solo crea o borra su propio error.
export type AdminErrorScope = 'load' | 'users' | 'action' | 'refresh' | 'audit'
export type AdminErrors = Partial<Record<AdminErrorScope, string>>

const ERROR_ORDER: readonly AdminErrorScope[] = ['load', 'users', 'action', 'refresh', 'audit']

/** Errores tras fijar (message) o borrar (null) el de una operación, sin tocar los demás. */
export function withScopeError(
  errors: AdminErrors,
  scope: AdminErrorScope,
  message: string | null,
): AdminErrors {
  if ((errors[scope] ?? null) === message) return errors
  const next = { ...errors }
  if (message === null) delete next[scope]
  else next[scope] = message
  return next
}

/** Errores que se muestran, en un orden estable. */
export function visibleErrors(errors: AdminErrors): { scope: AdminErrorScope; message: string }[] {
  return ERROR_ORDER.flatMap(scope => {
    const message = errors[scope]
    return message ? [{ scope, message }] : []
  })
}

export function refreshAfterActionFailedMessage(error: unknown): string {
  const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
  return `La acción se ha completado, pero no se ha podido actualizar la información mostrada${detail}. Recarga la página para ver los datos actuales.`
}

export type ActionOutcome =
  // La acción no se realizó.
  | { kind: 'failed'; error: string }
  // La acción se realizó; refreshError indica si después falló la actualización de los datos.
  | { kind: 'done'; refreshError: string | null }

/**
 * Ejecuta una acción administrativa una sola vez y, si se completa, avisa (onDone) y refresca
 * los datos. Un fallo del refresco no convierte la acción en fallida ni la repite.
 */
export async function runActionThenRefresh(
  run: () => Promise<{ message: string }>,
  onDone: (message: string) => void,
  refresh: () => Promise<void>,
): Promise<ActionOutcome> {
  let message: string
  try {
    message = (await run()).message
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : 'No se pudo completar la acción.' }
  }
  onDone(message)
  try {
    await refresh()
    return { kind: 'done', refreshError: null }
  } catch (error) {
    return { kind: 'done', refreshError: refreshAfterActionFailedMessage(error) }
  }
}
