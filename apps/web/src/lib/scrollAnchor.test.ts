import { describe, expect, it, vi } from 'vitest'

import {
  captureScrollAnchor,
  holdScrollAnchor,
  isLatestResponse,
  restoreScrollAnchor,
  takeScrollAnchor,
  type AnchorElement,
  type PendingScrollAnchor,
} from './scrollAnchor'

// Elemento simulado: su posición en la ventana se cambia a mano, como si el contenido de
// encima hubiera crecido o encogido.
function fakeElement(top: number, isConnected = true) {
  const element = { isConnected, top, getBoundingClientRect: () => ({ top: element.top }) }
  return element
}

function fakeScroller() {
  return { scrollBy: vi.fn<(options: { top: number; behavior: 'instant' }) => void>() }
}

describe('captureScrollAnchor', () => {
  it('guarda la posición actual del elemento en la ventana', () => {
    const element = fakeElement(500)
    expect(captureScrollAnchor(element)).toEqual({ element, top: 500 })
  })

  it('sin elemento o con un elemento fuera del documento no guarda nada', () => {
    expect(captureScrollAnchor(null)).toBeNull()
    expect(captureScrollAnchor(undefined)).toBeNull()
    expect(captureScrollAnchor(fakeElement(500, false))).toBeNull()
  })
})

describe('restoreScrollAnchor', () => {
  it('si la página nueva es más alta, baja lo mismo que ha bajado la barra', () => {
    const element = fakeElement(500)
    const anchor = captureScrollAnchor(element)
    element.top = 1620
    const scroller = fakeScroller()

    expect(restoreScrollAnchor(anchor, scroller)).toBe(1120)
    expect(scroller.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 1120, behavior: 'instant' })
  })

  it('si la página nueva es más baja, sube lo mismo que ha subido la barra', () => {
    const element = fakeElement(784)
    const anchor = captureScrollAnchor(element)
    element.top = 274
    const scroller = fakeScroller()

    expect(restoreScrollAnchor(anchor, scroller)).toBe(-510)
    expect(scroller.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -510, behavior: 'instant' })
  })

  it('no desplaza si la barra no se ha movido o solo por redondeo', () => {
    const scroller = fakeScroller()
    const element = fakeElement(500)
    const anchor = captureScrollAnchor(element)

    expect(restoreScrollAnchor(anchor, scroller)).toBe(0)
    element.top = 500.4
    expect(restoreScrollAnchor(anchor, scroller)).toBe(0)
    expect(scroller.scrollBy).not.toHaveBeenCalled()
  })

  it('no desplaza sin referencia guardada', () => {
    const scroller = fakeScroller()
    expect(restoreScrollAnchor(null, scroller)).toBe(0)
    expect(scroller.scrollBy).not.toHaveBeenCalled()
  })

  it('no desplaza si la barra ha desaparecido del documento', () => {
    const element = fakeElement(500)
    const anchor = captureScrollAnchor(element)
    const gone: AnchorElement & { top: number } = { ...element, isConnected: false }
    const scroller = fakeScroller()

    expect(restoreScrollAnchor(anchor && { ...anchor, element: gone }, scroller)).toBe(0)
    expect(scroller.scrollBy).not.toHaveBeenCalled()
  })

  it('corrige desplazamientos con decimales sin redondearlos', () => {
    const element = fakeElement(100)
    const anchor = captureScrollAnchor(element)
    element.top = 133.75
    const scroller = fakeScroller()

    expect(restoreScrollAnchor(anchor, scroller)).toBe(33.75)
    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 33.75, behavior: 'instant' })
  })
})

// Modelo del cableado de AdminPage para un listado: peticiones numeradas (usersRequest o
// auditRequest), respuestas vigentes o descartadas (settleLatest), el ancla que se guarda antes
// de setData y el efecto que la restaura cuando React muestra los datos.
function listModel(barTop = 500) {
  let lastRequest = 0
  const pending: { current: PendingScrollAnchor | null } = { current: null }
  const bar = fakeElement(barTop)
  const scroller = fakeScroller()
  const requestOf = new Map<object, number>()
  return {
    bar,
    scroller,
    pending,
    // Empieza una petición del listado y devuelve su identificador.
    start: () => ++lastRequest,
    // Llega la respuesta: solo la de la petición vigente se usa (las demás dan null).
    respond(request: number) {
      if (request !== lastRequest) return null
      const response = { request }
      requestOf.set(response, request)
      return response
    },
    // Navegación: guarda el ancla de la barra para esa respuesta (antes de setData).
    hold: (response: object) => holdScrollAnchor(pending, bar, requestOf.get(response) ?? 0),
    // React muestra `shown` y ejecuta el efecto; devuelve los px corregidos.
    commit: (shown: object | null) =>
      restoreScrollAnchor(takeScrollAnchor(pending, shown ? requestOf.get(shown) ?? null : null), scroller),
  }
}

describe('holdScrollAnchor y takeScrollAnchor', () => {
  it('sin barra no deja ancla pendiente', () => {
    const pending: { current: PendingScrollAnchor | null } = { current: null }
    expect(holdScrollAnchor(pending, null, 1)).toBe(false)
    expect(pending.current).toBeNull()
  })

  it('sin concurrencia: restaura al mostrar su respuesta, como hasta ahora', () => {
    const users = listModel(500)
    const page2 = users.respond(users.start())!
    users.hold(page2)
    users.bar.top = 1620

    expect(users.commit(page2)).toBe(1120)
    expect(users.scroller.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 1120, behavior: 'instant' })
  })

  it.each(['usuarios', 'auditoría'])('%s: dos navegaciones seguidas; la actualización de la primera no consume el ancla de la segunda', () => {
    const list = listModel(500)
    // Primera navegación: su respuesta llega y guarda su ancla.
    const first = list.respond(list.start())!
    list.hold(first)
    // Antes de que React la muestre, la segunda navegación recibe su respuesta y guarda la suya.
    const second = list.respond(list.start())!
    list.hold(second)

    // React muestra primero la respuesta de la primera navegación: no restaura ni consume nada.
    list.bar.top = 900
    expect(list.commit(first)).toBe(0)
    expect(list.pending.current?.version).toBe(2)
    expect(list.scroller.scrollBy).not.toHaveBeenCalled()

    // Al mostrar la segunda, se restaura con su propia ancla.
    list.bar.top = 380
    expect(list.commit(second)).toBe(-120)
    expect(list.scroller.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -120, behavior: 'instant' })
    expect(list.pending.current).toBeNull()
  })

  it('respuestas en orden inverso: la anterior, que llega después, no guarda ancla ni restaura', () => {
    const list = listModel(500)
    const older = list.start()
    const newer = list.start()
    const newerResponse = list.respond(newer)!
    list.hold(newerResponse)
    list.bar.top = 600
    expect(list.commit(newerResponse)).toBe(100)

    // La respuesta de la petición anterior llega tarde: settleLatest la descarta.
    expect(list.respond(older)).toBeNull()
    expect(list.pending.current).toBeNull()
    expect(list.scroller.scrollBy).toHaveBeenCalledOnce()
  })

  it('un ancla anterior nunca sustituye a la de una petición posterior', () => {
    const pending: { current: PendingScrollAnchor | null } = { current: null }
    const newerBar = fakeElement(300)
    holdScrollAnchor(pending, newerBar, 7)

    expect(holdScrollAnchor(pending, fakeElement(999), 6)).toBe(false)
    expect(pending.current).toEqual({ anchor: { element: newerBar, top: 300 }, version: 7 })
  })

  it('una actualización ajena anterior (recarga, estado inicial) conserva el ancla válida', () => {
    const list = listModel(500)
    // Una recarga empezó antes de la navegación y su respuesta se muestra después del ancla.
    const refreshResponse = list.respond(list.start())!
    const page = list.respond(list.start())!
    list.hold(page)

    expect(list.commit(refreshResponse)).toBe(0)
    expect(list.commit(null)).toBe(0)
    expect(list.pending.current?.version).toBe(2)
    list.bar.top = 540
    expect(list.commit(page)).toBe(40)
  })

  it('una actualización ajena posterior (búsqueda, filtro) descarta el ancla sin restaurarla', () => {
    const list = listModel(500)
    const page = list.respond(list.start())!
    list.hold(page)
    // Una búsqueda posterior se muestra en la misma actualización (React agrupa los cambios).
    const search = list.respond(list.start())!
    list.bar.top = 800

    expect(list.commit(search)).toBe(0)
    expect(list.pending.current).toBeNull()
    expect(list.scroller.scrollBy).not.toHaveBeenCalled()
  })

  it('usuarios y auditoría coexisten: cada listado restaura solo su ancla', () => {
    const users = listModel(300)
    const audit = listModel(700)
    const usersPage = users.respond(users.start())!
    const auditPage = audit.respond(audit.start())!
    users.hold(usersPage)
    audit.hold(auditPage)
    users.bar.top = 420
    audit.bar.top = 650

    expect(audit.commit(auditPage)).toBe(-50)
    expect(users.pending.current).not.toBeNull()
    expect(users.commit(usersPage)).toBe(120)
    expect(users.scroller.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 120, behavior: 'instant' })
    expect(audit.scroller.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -50, behavior: 'instant' })
  })

  it('cada ancla se restaura una sola vez, aunque el efecto vuelva a ejecutarse', () => {
    const list = listModel(500)
    const page = list.respond(list.start())!
    list.hold(page)
    list.bar.top = 700

    expect(list.commit(page)).toBe(200)
    expect(list.commit(page)).toBe(0)
    expect(list.scroller.scrollBy).toHaveBeenCalledOnce()
  })

  it('limpieza: una respuesta posterior sin ancla retira el ancla de una navegación anterior', () => {
    const list = listModel(500)
    const page = list.respond(list.start())!
    list.hold(page)
    const later = list.respond(list.start())!

    expect(list.commit(later)).toBe(0)
    expect(list.pending.current).toBeNull()
    // Si después React mostrara la respuesta antigua, ya no queda ancla que restaurar.
    expect(list.commit(page)).toBe(0)
    expect(list.scroller.scrollBy).not.toHaveBeenCalled()
  })

  it('limpieza: una navegación posterior sin barra retira el ancla anterior', () => {
    const pending: { current: PendingScrollAnchor | null } = { current: null }
    holdScrollAnchor(pending, fakeElement(500), 1)

    expect(holdScrollAnchor(pending, null, 2)).toBe(false)
    expect(pending.current).toBeNull()
  })

  it('limpieza: una petición descartada no deja ningún ancla pendiente', () => {
    const list = listModel(500)
    const stale = list.start()
    list.start()

    expect(list.respond(stale)).toBeNull()
    expect(list.pending.current).toBeNull()
  })
})

describe('isLatestResponse', () => {
  it('solo es la última la respuesta registrada con el contador actual del listado', () => {
    const versions = new WeakMap<object, number>()
    const older = {}
    const newer = {}
    versions.set(older, 4)
    versions.set(newer, 5)

    expect(isLatestResponse(versions, newer, 5)).toBe(true)
    expect(isLatestResponse(versions, older, 5)).toBe(false)
    // Una respuesta sin registrar nunca se considera la última.
    expect(isLatestResponse(versions, {}, 5)).toBe(false)
  })

  it('una respuesta deja de ser la última en cuanto empieza otra petición del listado', () => {
    const versions = new WeakMap<object, number>()
    const response = {}
    versions.set(response, 3)

    expect(isLatestResponse(versions, response, 3)).toBe(true)
    expect(isLatestResponse(versions, response, 4)).toBe(false)
  })
})

// La recarga tras una acción (refresh) recibe la página actual enseguida, pero la escribe tras
// esperar a las demás peticiones; mientras tanto el usuario cambia de página.
describe('recarga tras una acción y cambio de página durante la espera', () => {
  function scenario() {
    const versions = new WeakMap<object, number>()
    let lastRequest = 0
    const pending: { current: PendingScrollAnchor | null } = { current: null }
    const bar = fakeElement(450)
    const scroller = fakeScroller()
    const respond = () => { const request = ++lastRequest; const response = { request }; versions.set(response, request); return response }
    const shownVersion = (shown: object | null) => (shown ? versions.get(shown) ?? null : null)
    return { versions, pending, bar, scroller, respond, latest: () => lastRequest, shownVersion }
  }

  it('sin comprobar al escribir, la respuesta antigua de la recarga sustituiría a la página nueva', () => {
    const s = scenario()
    const refreshUsers = s.respond() // vigente al llegar
    const page2 = s.respond() // el usuario navega mientras la recarga espera
    holdScrollAnchor(s.pending, s.bar, s.versions.get(page2)!)

    // Lo que pasaba antes: se escribe page2 y después refreshUsers (versión menor).
    s.bar.top = 1570
    expect(restoreScrollAnchor(takeScrollAnchor(s.pending, s.shownVersion(page2)), s.scroller)).toBe(1120)
    expect(s.versions.get(refreshUsers)).toBeLessThan(s.versions.get(page2)!)
    // Con la comprobación, la recarga ya no es la última y no se escribe.
    expect(isLatestResponse(s.versions, refreshUsers, s.latest())).toBe(false)
    expect(isLatestResponse(s.versions, page2, s.latest())).toBe(true)
  })

  it('si React agrupa ambas escrituras, no queda ningún ancla pendiente porque la antigua no se escribe', () => {
    const s = scenario()
    const refreshUsers = s.respond()
    const page2 = s.respond()
    holdScrollAnchor(s.pending, s.bar, s.versions.get(page2)!)

    // Solo se escribe lo que sigue siendo lo último: el estado final es page2, no refreshUsers.
    const written = [page2, refreshUsers].filter(response => isLatestResponse(s.versions, response, s.latest()))
    const shown = written.at(-1) ?? null
    expect(shown).toBe(page2)
    s.bar.top = 450 + 1120
    expect(restoreScrollAnchor(takeScrollAnchor(s.pending, s.shownVersion(shown)), s.scroller)).toBe(1120)
    expect(s.pending.current).toBeNull()
  })
})
