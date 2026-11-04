// Gestión del foco y del teclado en los diálogos modales. Las decisiones son funciones
// puras; getFocusableElements y getTabStops son los únicos puntos que leen el DOM y solo
// se usan desde efectos y manejadores de eventos, nunca durante el renderizado.
//
// El confinamiento no calcula cada paso de Tab: deja la navegación al navegador y solo
// interviene en los extremos (Tab en el último punto de tabulación, Shift+Tab en el
// primero) o cuando el foco no está en ningún punto del diálogo.

export type DialogKeyAction = 'close' | 'focus-next' | 'focus-previous'

/** Qué hacer con una tecla pulsada mientras el diálogo está abierto; null si no le afecta. */
export function dialogKeyAction(
  key: string,
  shiftKey: boolean,
  canClose: boolean,
): DialogKeyAction | null {
  if (key === 'Escape' || key === 'Esc') return canClose ? 'close' : null
  if (key === 'Tab') return shiftKey ? 'focus-previous' : 'focus-next'
  return null
}

export interface TabStopCandidate {
  tabIndex: number
  // Clave del grupo de radio (nombre y formulario); null si no es un radio con nombre.
  radioGroup: string | null
  checked: boolean
}

/**
 * Agrupa los candidatos (ya filtrados y en el orden del documento) en puntos de tabulación,
 * ordenados como los recorre el navegador dentro del diálogo:
 * - primero los de tabindex positivo, de menor a mayor (a igual valor, en orden del documento);
 *   después los de tabindex 0, en orden del documento;
 * - los radios con el mismo nombre forman un único punto, situado donde aparece su primer
 *   radio en ese orden. Cada punto lista sus miembros (índices de candidatos) en orden del
 *   documento.
 * Es una aproximación acotada, no el algoritmo completo del navegador (ver limitaciones).
 */
export function buildTabStops(candidates: TabStopCandidate[]): number[][] {
  const order = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const pa = a.candidate.tabIndex > 0 ? a.candidate.tabIndex : Number.POSITIVE_INFINITY
      const pb = b.candidate.tabIndex > 0 ? b.candidate.tabIndex : Number.POSITIVE_INFINITY
      if (pa !== pb) return pa < pb ? -1 : 1
      return a.index - b.index
    })

  const stops: number[][] = []
  const groupStop = new Map<string, number[]>()
  for (const { candidate, index } of order) {
    const group = candidate.radioGroup
    const existing = group === null ? undefined : groupStop.get(group)
    if (existing) {
      existing.push(index)
      continue
    }
    const stop = [index]
    stops.push(stop)
    if (group !== null) groupStop.set(group, stop)
  }
  for (const stop of stops) stop.sort((a, b) => a - b)
  return stops
}

/**
 * Miembro de un punto de tabulación que recibe el foco al llegar a él: el radio marcado si
 * lo hay; si no, el primero (hacia delante) o el último (hacia atrás). Para un punto de un
 * solo elemento, ese elemento.
 */
export function entryMember(checked: boolean[], backwards: boolean): number {
  const marked = checked.indexOf(true)
  if (marked !== -1) return marked
  return backwards ? checked.length - 1 : 0
}

export type TabBoundaryAction =
  // No se interviene: el navegador mueve el foco.
  | { type: 'native' }
  // Se impide el movimiento y el foco se queda donde está (único punto de tabulación).
  | { type: 'stay' }
  // No hay puntos de tabulación: el foco va al propio diálogo.
  | { type: 'focus-dialog' }
  // Se impide el movimiento y el foco va a este punto.
  | { type: 'focus-stop'; stop: number }

/**
 * Qué hacer al pulsar Tab (o Shift+Tab, backwards) dentro del diálogo. activeStop es el
 * índice del punto de tabulación que tiene el foco, o -1 si el foco no está en ninguno
 * (fuera del diálogo, en el propio diálogo o en un elemento que no es punto de tabulación).
 */
export function tabBoundaryAction(
  stopCount: number,
  activeStop: number,
  backwards: boolean,
): TabBoundaryAction {
  if (stopCount <= 0) return { type: 'focus-dialog' }
  if (activeStop < 0 || activeStop >= stopCount) {
    return { type: 'focus-stop', stop: backwards ? stopCount - 1 : 0 }
  }
  const atEdge = backwards ? activeStop === 0 : activeStop === stopCount - 1
  if (!atEdge) return { type: 'native' }
  const target = backwards ? stopCount - 1 : 0
  return target === activeStop ? { type: 'stay' } : { type: 'focus-stop', stop: target }
}

export interface FocusCandidate {
  disabled: boolean
  tabIndex: number
  // Él o un antecesor tiene hidden o inert, o el estilo lo oculta (visibility: hidden).
  hidden: boolean
  // Ocupa espacio en la página (false con display: none).
  rendered: boolean
}

/** Un control puede recibir el foco con el teclado si está activo, visible y en el orden de tabulación. */
export function canReceiveFocus(candidate: FocusCandidate): boolean {
  return !candidate.disabled && candidate.tabIndex >= 0 && !candidate.hidden && candidate.rendered
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')

function describeForFocus(element: HTMLElement): FocusCandidate {
  return {
    disabled: element.matches(':disabled'),
    tabIndex: element.tabIndex,
    hidden: element.closest('[hidden], [inert]') !== null || getComputedStyle(element).visibility === 'hidden',
    rendered: element.getClientRects().length > 0,
  }
}

/** Elementos del contenedor que pueden recibir el foco, en el orden del documento. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => canReceiveFocus(describeForFocus(element)))
}

export interface DialogTabStops {
  elements: HTMLElement[]
  stops: number[][]
  checked: boolean[]
}

/** Puntos de tabulación del contenedor (ver buildTabStops) y los elementos a los que remiten. */
export function getTabStops(container: HTMLElement): DialogTabStops {
  const elements = getFocusableElements(container)
  // Un grupo de radio lo forman los radios con el mismo nombre del mismo formulario.
  const formIds = new Map<HTMLFormElement | null, number>()
  const candidates = elements.map((element): TabStopCandidate => {
    const isRadio = element instanceof HTMLInputElement && element.type === 'radio'
    if (!isRadio || !element.name) return { tabIndex: element.tabIndex, radioGroup: null, checked: false }
    const form = element.form
    if (!formIds.has(form)) formIds.set(form, formIds.size)
    return { tabIndex: element.tabIndex, radioGroup: `${formIds.get(form)}:${element.name}`, checked: element.checked }
  })
  return { elements, stops: buildTabStops(candidates), checked: candidates.map(c => c.checked) }
}

/** Si un elemento concreto sigue en la página y puede recibir el foco. */
export function isElementFocusable(element: HTMLElement): boolean {
  return element.isConnected && canReceiveFocus(describeForFocus(element))
}
