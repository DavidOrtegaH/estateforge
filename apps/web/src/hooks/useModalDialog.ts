import { useEffect, useRef, type RefObject } from 'react'

import {
  dialogKeyAction,
  entryMember,
  getFocusableElements,
  getTabStops,
  isElementFocusable,
  tabBoundaryAction,
  type DialogTabStops,
  type TabBoundaryAction,
} from '@/lib/dialogFocus'

interface ModalDialogOptions {
  // Si el diálogo está abierto. El efecto solo se reinicia cuando cambia.
  open: boolean
  onClose: () => void
  // Si Escape puede cerrarlo ahora (false, por ejemplo, mientras se envía).
  canClose?: boolean
  // Control que recibe el foco al abrir; si falta, el primero que pueda recibirlo.
  initialFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Foco y teclado de un diálogo modal: al abrir guarda el elemento que tenía el foco y lo
 * lleva al diálogo; deja que el navegador mueva el foco con Tab y Shift+Tab y solo
 * interviene en los extremos para que no salga del diálogo; Escape lo cierra si canClose lo
 * permite; al cerrar devuelve el foco al elemento anterior si sigue pudiendo recibirlo.
 * Devuelve la ref que hay que poner en el elemento con role="dialog" (con tabIndex={-1},
 * para poder enfocarlo si no contiene ningún control).
 */
export function useModalDialog<T extends HTMLElement>({
  open,
  onClose,
  canClose = true,
  initialFocusRef,
}: ModalDialogOptions): RefObject<T | null> {
  const dialogRef = useRef<T>(null)
  // Valores más recientes, para no reiniciar el efecto (ni mover el foco) en cada render.
  const onCloseRef = useRef(onClose)
  const canCloseRef = useRef(canClose)

  useEffect(() => {
    onCloseRef.current = onClose
    canCloseRef.current = canClose
  })

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const initial = initialFocusRef?.current ?? getFocusableElements(dialog)[0] ?? dialog
    initial.focus()

    // Dirección de un Tab que se ha dejado al navegador (true = Shift+Tab), hasta que el foco
    // se mueva o se suelte la tecla. Sirve para recuperar el foco si ese Tab lo saca del diálogo.
    let pendingTab: boolean | null = null

    function applyBoundary(action: TabBoundaryAction, tabs: DialogTabStops, backwards: boolean) {
      if (!dialog || action.type === 'native' || action.type === 'stay') return
      if (action.type === 'focus-dialog') {
        dialog.focus()
        return
      }
      const members = tabs.stops[action.stop]
      const member = members[entryMember(members.map(index => tabs.checked[index]), backwards)]
      tabs.elements[member].focus()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!dialog) return
      const action = dialogKeyAction(event.key, event.shiftKey, canCloseRef.current)
      if (action === null) return

      if (action === 'close') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      // Tab: el navegador decide el siguiente elemento; solo se interviene en los extremos
      // o si el foco no está en ningún punto de tabulación del diálogo.
      const backwards = action === 'focus-previous'
      const tabs = getTabStops(dialog)
      const active = document.activeElement
      const activeStop = tabs.stops.findIndex(members => members.some(index => tabs.elements[index] === active))
      const boundary = tabBoundaryAction(tabs.stops.length, activeStop, backwards)
      if (boundary.type === 'native') {
        pendingTab = backwards
        return
      }
      event.preventDefault()
      pendingTab = null
      applyBoundary(boundary, tabs, backwards)
    }

    function handleFocusIn(event: FocusEvent) {
      if (pendingTab === null || !dialog) return
      const backwards = pendingTab
      pendingTab = null
      if (event.target instanceof Node && dialog.contains(event.target)) return
      // Un Tab nativo ha sacado el foco (por ejemplo, por un tabindex positivo de fuera):
      // se devuelve al extremo del diálogo en la dirección del Tab.
      const tabs = getTabStops(dialog)
      applyBoundary(tabBoundaryAction(tabs.stops.length, -1, backwards), tabs, backwards)
    }

    function handleKeyUp() {
      pendingTab = null
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('keyup', handleKeyUp)
      // Si el elemento anterior ya no existe o está desactivado, el foco se queda donde esté.
      // Sin desplazar la página: el cierre puede haber llevado la vista a otra sección.
      if (previous && isElementFocusable(previous)) previous.focus({ preventScroll: true })
    }
  }, [open, initialFocusRef])

  return dialogRef
}
