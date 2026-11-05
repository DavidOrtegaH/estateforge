// Mantiene un elemento en la misma posición de la ventana mientras cambia el contenido que
// tiene encima. Lo usa la paginación del panel de administración: al cambiar de página, la
// lista nueva puede ser más alta o más baja que la anterior y, sin corrección, la barra de
// paginación se movería (o el navegador recortaría el desplazamiento al encoger el documento).

/** Lo mínimo que se necesita del elemento de referencia. */
export interface AnchorElement {
  readonly isConnected: boolean
  getBoundingClientRect(): { top: number }
}

/** Lo mínimo que se necesita de la ventana (o del contenedor con desplazamiento). */
export interface AnchorScroller {
  scrollBy(options: { top: number; behavior: 'instant' }): void
}

export interface ScrollAnchor {
  element: AnchorElement
  // Distancia, en px, del borde superior del elemento al de la ventana al guardarla.
  top: number
}

/** Guarda dónde está ahora el elemento en la ventana; null si no hay elemento. */
export function captureScrollAnchor(element: AnchorElement | null | undefined): ScrollAnchor | null {
  if (!element || !element.isConnected) return null
  return { element, top: element.getBoundingClientRect().top }
}

/**
 * Desplaza la ventana lo justo para que el elemento vuelva a la posición guardada. Si el
 * elemento ya no está en el documento o no se ha movido, no hace nada. Devuelve los px
 * desplazados (0 si ninguno). Hay que llamarla tras actualizar el DOM y antes de pintar
 * (useLayoutEffect), para que no se vea el salto.
 */
export function restoreScrollAnchor(anchor: ScrollAnchor | null, scroller: AnchorScroller): number {
  if (!anchor || !anchor.element.isConnected) return 0
  const delta = anchor.element.getBoundingClientRect().top - anchor.top
  // Diferencias de menos de medio píxel (redondeos del navegador) no se corrigen.
  if (Math.abs(delta) < 0.5) return 0
  scroller.scrollBy({ top: delta, behavior: 'instant' })
  return delta
}

/**
 * Ancla a la espera de que se muestre la respuesta de una petición concreta del listado.
 * `version` es el identificador de esa petición, que crece con cada petición del listado: así
 * se sabe si lo que se muestra es anterior, igual o posterior a la navegación del ancla, sin
 * depender del momento en que React ejecute los efectos.
 */
export interface PendingScrollAnchor {
  anchor: ScrollAnchor
  version: number
}

type PendingRef = { current: PendingScrollAnchor | null }

/**
 * Deja pendiente el ancla de `element` para la respuesta de la petición `version`. Nunca
 * sustituye el ancla de una petición posterior; sí la de una anterior, que ya no se va a ver
 * porque esta respuesta la sustituye. Devuelve si el ancla queda guardada.
 */
export function holdScrollAnchor(pending: PendingRef, element: AnchorElement | null | undefined, version: number): boolean {
  if (pending.current && pending.current.version > version) return false
  const anchor = captureScrollAnchor(element)
  pending.current = anchor ? { anchor, version } : null
  return anchor !== null
}

/**
 * Se llama cada vez que el listado muestra datos, con la versión (la petición) de lo que muestra:
 * - la misma versión: devuelve el ancla para restaurarla y la retira (se usa una sola vez);
 * - una versión posterior: el ancla ya no corresponde a lo que se ve y se retira sin restaurarla;
 * - una versión anterior, o desconocida (null, sin datos): es una actualización previa a la
 *   navegación, así que el ancla se conserva para cuando se muestre su respuesta.
 */
export function takeScrollAnchor(pending: PendingRef, shownVersion: number | null): ScrollAnchor | null {
  const current = pending.current
  if (!current || shownVersion === null || shownVersion < current.version) return null
  pending.current = null
  return shownVersion === current.version ? current.anchor : null
}

/**
 * Si `response` sigue siendo la respuesta de la última petición de su listado (`latest` es el
 * contador del listado). Se comprueba justo antes de escribirla en el estado: entre la llegada
 * de una respuesta y su escritura puede haber esperas (por ejemplo, un Promise.all) durante las
 * que empiece otra petición. Así el estado solo recibe versiones crecientes y una respuesta
 * antigua no sustituye a otra más reciente ni deja un ancla pendiente.
 */
export function isLatestResponse(versions: WeakMap<object, number>, response: object, latest: number): boolean {
  return versions.get(response) === latest
}
