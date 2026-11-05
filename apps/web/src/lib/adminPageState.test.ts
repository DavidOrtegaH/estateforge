import { describe, expect, it, vi } from 'vitest'

import {
  auditEmptyMessage,
  refreshAfterActionFailedMessage,
  runActionThenRefresh,
  settleLatest,
  startLatestIndicator,
  visibleErrors,
  withScopeError,
} from './adminPageState'

// Lógica pura del panel de administración. No renderiza AdminPage: el proyecto no tiene
// entorno DOM, así que el comportamiento visual se prueba a mano.

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Simula el contador de peticiones de AdminPage (usersRequest / auditRequest).
function requestCounter() {
  let current = 0
  return { start: () => { const id = ++current; return () => id === current } }
}

describe('settleLatest (O1: peticiones sustituidas)', () => {
  it('una respuesta antigua correcta que llega después no sobrescribe a la más reciente', async () => {
    const counter = requestCounter()
    const old = deferred<string>()
    const recent = deferred<string>()
    const oldResult = settleLatest(old.promise, counter.start())
    const recentResult = settleLatest(recent.promise, counter.start())

    recent.resolve('filtros nuevos')
    old.resolve('filtros antiguos')

    await expect(recentResult).resolves.toEqual({ current: true, value: 'filtros nuevos' })
    await expect(oldResult).resolves.toEqual({ current: false })
  })

  it('un error de una petición antigua se descarta y no llega al estado actual', async () => {
    const counter = requestCounter()
    const old = deferred<string>()
    const recent = deferred<string>()
    const oldResult = settleLatest(old.promise, counter.start())
    const recentResult = settleLatest(recent.promise, counter.start())

    old.reject(new Error('Fallo de la petición antigua'))
    recent.resolve('filtros nuevos')

    await expect(oldResult).resolves.toEqual({ current: false })
    await expect(recentResult).resolves.toEqual({ current: true, value: 'filtros nuevos' })
  })

  it('la petición vigente devuelve su valor', async () => {
    await expect(settleLatest(Promise.resolve(3), () => true)).resolves.toEqual({ current: true, value: 3 })
  })

  it('el error de la petición vigente se propaga para mostrarlo', async () => {
    await expect(settleLatest(Promise.reject(new Error('Sin conexión')), () => true)).rejects.toThrow('Sin conexión')
  })

  it('decide si es vigente al terminar, no al empezar', async () => {
    const counter = requestCounter()
    const pending = deferred<number>()
    const result = settleLatest(pending.promise, counter.start())
    counter.start() // se lanza otra mientras la primera sigue en curso
    pending.resolve(1)

    await expect(result).resolves.toEqual({ current: false })
  })
})

describe('startLatestIndicator', () => {
  it('una sola operación enciende el indicador y lo apaga al terminar', () => {
    const counter = { current: 0 }
    const setActive = vi.fn()
    const finish = startLatestIndicator(counter, setActive)
    expect(setActive).toHaveBeenLastCalledWith(true)
    finish()
    expect(setActive).toHaveBeenLastCalledWith(false)
  })

  it('una operación anterior no apaga el indicador de la más reciente', () => {
    const counter = { current: 0 }
    const setActive = vi.fn()
    const finishOld = startLatestIndicator(counter, setActive)
    const finishRecent = startLatestIndicator(counter, setActive)
    finishOld()
    expect(setActive).not.toHaveBeenCalledWith(false)
    finishRecent()
    expect(setActive).toHaveBeenLastCalledWith(false)
    expect(setActive).toHaveBeenCalledTimes(3)
  })

  it('si la más reciente termina antes, la anterior no vuelve a tocar el indicador', () => {
    const counter = { current: 0 }
    const setActive = vi.fn()
    const finishOld = startLatestIndicator(counter, setActive)
    const finishRecent = startLatestIndicator(counter, setActive)
    finishRecent()
    finishOld()
    expect(setActive.mock.calls).toEqual([[true], [true], [false]])
  })
})

// Reproduce el patrón de searchUsers y changeUsersPage en AdminPage: un contador común de
// peticiones de usuarios (settleLatest) y un indicador propio para cada operación.
function usersPanel() {
  const usersRequest = { current: 0 }
  const searchCounter = { current: 0 }
  const pageCounter = { current: 0 }
  const state = { searching: false, changingPage: false, data: null as string | null, error: null as string | null }

  async function load(request: Promise<string>) {
    const id = ++usersRequest.current
    const result = await settleLatest(request, () => id === usersRequest.current)
    return result.current ? result.value : null
  }

  async function run(request: Promise<string>, counter: { current: number }, setActive: (active: boolean) => void) {
    const finish = startLatestIndicator(counter, setActive)
    try {
      const data = await load(request)
      if (data) state.data = data
    } catch (error) {
      state.error = (error as Error).message
    } finally {
      finish()
    }
  }

  return {
    state,
    search: (request: Promise<string>) => run(request, searchCounter, active => { state.searching = active }),
    changePage: (request: Promise<string>) => run(request, pageCounter, active => { state.changingPage = active }),
  }
}

describe('indicadores de usuarios con peticiones solapadas', () => {
  it('búsqueda: la antigua termina después de lanzar la nueva y no apaga «Buscando…»', async () => {
    const panel = usersPanel()
    const old = deferred<string>()
    const recent = deferred<string>()
    const oldSearch = panel.search(old.promise)
    const recentSearch = panel.search(recent.promise)

    old.resolve('resultados antiguos')
    await oldSearch
    expect(panel.state.searching).toBe(true)
    expect(panel.state.data).toBeNull()

    recent.resolve('resultados nuevos')
    await recentSearch
    expect(panel.state.searching).toBe(false)
    expect(panel.state.data).toBe('resultados nuevos')
  })

  it('búsqueda: un error de la antigua tampoco apaga el indicador ni se muestra', async () => {
    const panel = usersPanel()
    const old = deferred<string>()
    const recent = deferred<string>()
    const oldSearch = panel.search(old.promise)
    const recentSearch = panel.search(recent.promise)

    old.reject(new Error('Error de búsqueda.'))
    await oldSearch
    expect(panel.state.searching).toBe(true)
    expect(panel.state.error).toBeNull()

    recent.resolve('resultados nuevos')
    await recentSearch
    expect(panel.state.searching).toBe(false)
  })

  it('paginación: un doble cambio de página solo se apaga al terminar el último', async () => {
    const panel = usersPanel()
    const page2 = deferred<string>()
    const page3 = deferred<string>()
    const first = panel.changePage(page2.promise)
    const second = panel.changePage(page3.promise)

    page3.resolve('página 3')
    await second
    expect(panel.state.changingPage).toBe(false)
    expect(panel.state.data).toBe('página 3')

    page2.resolve('página 2')
    await first
    expect(panel.state.changingPage).toBe(false)
    expect(panel.state.data).toBe('página 3')
  })

  it('paginación: el cambio antiguo no apaga el indicador mientras el nuevo sigue en curso', async () => {
    const panel = usersPanel()
    const page2 = deferred<string>()
    const page3 = deferred<string>()
    const first = panel.changePage(page2.promise)
    const second = panel.changePage(page3.promise)

    page2.resolve('página 2')
    await first
    expect(panel.state.changingPage).toBe(true)

    page3.resolve('página 3')
    await second
    expect(panel.state.changingPage).toBe(false)
    expect(panel.state.data).toBe('página 3')
  })

  it('cada indicador es independiente: una búsqueda que sustituye a un cambio de página no se apaga con él', async () => {
    const panel = usersPanel()
    const page = deferred<string>()
    const search = deferred<string>()
    const pageChange = panel.changePage(page.promise)
    const searching = panel.search(search.promise)

    page.resolve('página antigua')
    await pageChange
    expect(panel.state.changingPage).toBe(false)
    expect(panel.state.searching).toBe(true)
    expect(panel.state.data).toBeNull()

    search.resolve('resultados')
    await searching
    expect(panel.state.searching).toBe(false)
    expect(panel.state.data).toBe('resultados')
  })
})

describe('auditEmptyMessage (O2: filtros mostrados)', () => {
  it('sin filtros en los registros mostrados: aún no hay acciones', () => {
    expect(auditEmptyMessage({ action: '', target: null })).toBe('Todavía no hay acciones administrativas registradas.')
  })

  it('con filtro de acción o de cuenta en los registros mostrados: no hay coincidencias', () => {
    expect(auditEmptyMessage({ action: 'ACCOUNT_SUSPENDED', target: null })).toBe('No hay acciones que coincidan con los filtros.')
    expect(auditEmptyMessage({ action: '', target: { id: 'u1', label: 'a@b.test' } })).toBe('No hay acciones que coincidan con los filtros.')
  })

  it('depende solo de los filtros mostrados, no de los que se están cargando en los controles', () => {
    const shown = { action: '', target: null }
    const inControls = { action: 'ACCOUNT_SUSPENDED', target: null }
    expect(auditEmptyMessage(shown)).not.toBe(auditEmptyMessage(inControls))
    expect(auditEmptyMessage(shown)).toBe('Todavía no hay acciones administrativas registradas.')
  })
})

describe('withScopeError y visibleErrors (O3: errores por operación)', () => {
  const errors = { action: 'No se pudo suspender la cuenta.', users: 'Error de búsqueda.' }

  it('cambiar filtros o página de la auditoría solo borra el error de la auditoría', () => {
    const withAudit = withScopeError(errors, 'audit', 'No se pudo cargar la auditoría.')
    const cleared = withScopeError(withAudit, 'audit', null)
    expect(cleared).toEqual(errors)
  })

  it('una búsqueda o un cambio de página de usuarios no borra el error de una acción', () => {
    expect(withScopeError(errors, 'users', null)).toEqual({ action: 'No se pudo suspender la cuenta.' })
  })

  it('cada operación sustituye solo su propio mensaje', () => {
    expect(withScopeError(errors, 'action', 'Otro fallo.')).toEqual({ action: 'Otro fallo.', users: 'Error de búsqueda.' })
  })

  it('no crea un estado nuevo si no hay cambios', () => {
    expect(withScopeError(errors, 'audit', null)).toBe(errors)
    expect(withScopeError(errors, 'users', 'Error de búsqueda.')).toBe(errors)
  })

  it('muestra todos los errores pendientes en un orden estable', () => {
    expect(visibleErrors({ audit: 'A', load: 'L', refresh: 'R', action: 'X', users: 'U' }).map(error => error.scope))
      .toEqual(['load', 'users', 'action', 'refresh', 'audit'])
    expect(visibleErrors({})).toEqual([])
  })
})

describe('runActionThenRefresh (O4: acción y refresco)', () => {
  it('una acción correcta seguida de un fallo del refresco se comunica como éxito más fallo de actualización', async () => {
    const run = vi.fn().mockResolvedValue({ message: 'Cuenta suspendida.' })
    const onDone = vi.fn()
    const refresh = vi.fn().mockRejectedValue(new Error('No se pudo cargar la auditoría.'))

    const outcome = await runActionThenRefresh(run, onDone, refresh)

    expect(onDone).toHaveBeenCalledWith('Cuenta suspendida.')
    expect(outcome).toEqual({ kind: 'done', refreshError: refreshAfterActionFailedMessage(new Error('No se pudo cargar la auditoría.')) })
    expect(outcome.kind === 'done' && outcome.refreshError).toContain('La acción se ha completado')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('una acción correcta con refresco correcto no deja errores', async () => {
    const onDone = vi.fn()
    const outcome = await runActionThenRefresh(() => Promise.resolve({ message: 'Hecho.' }), onDone, () => Promise.resolve())

    expect(outcome).toEqual({ kind: 'done', refreshError: null })
    expect(onDone).toHaveBeenCalledWith('Hecho.')
  })

  it('si la acción falla no se avisa de éxito ni se refresca', async () => {
    const onDone = vi.fn()
    const refresh = vi.fn()
    const outcome = await runActionThenRefresh(() => Promise.reject(new Error('La cuenta está protegida.')), onDone, refresh)

    expect(outcome).toEqual({ kind: 'failed', error: 'La cuenta está protegida.' })
    expect(onDone).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('un fallo de la acción sin mensaje usa el texto genérico de siempre', async () => {
    const outcome = await runActionThenRefresh(() => Promise.reject('desconocido'), vi.fn(), vi.fn())
    expect(outcome).toEqual({ kind: 'failed', error: 'No se pudo completar la acción.' })
  })

  it('el aviso de éxito llega antes de que termine el refresco', async () => {
    const events: string[] = []
    const refresh = deferred<void>()
    const outcome = runActionThenRefresh(
      () => Promise.resolve({ message: 'Hecho.' }),
      () => events.push('aviso'),
      () => { events.push('refresco'); return refresh.promise },
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    // El aviso y el inicio del refresco ya han ocurrido, aunque el refresco siga pendiente.
    expect(events).toEqual(['aviso', 'refresco'])
    refresh.resolve()
    await expect(outcome).resolves.toEqual({ kind: 'done', refreshError: null })
  })
})

describe('refreshAfterActionFailedMessage', () => {
  it('incluye el detalle del error si lo hay', () => {
    expect(refreshAfterActionFailedMessage(new Error('Sin conexión'))).toBe(
      'La acción se ha completado, pero no se ha podido actualizar la información mostrada (Sin conexión). Recarga la página para ver los datos actuales.',
    )
  })

  it('sin detalle no inventa uno', () => {
    expect(refreshAfterActionFailedMessage('x')).toBe(
      'La acción se ha completado, pero no se ha podido actualizar la información mostrada. Recarga la página para ver los datos actuales.',
    )
  })
})
