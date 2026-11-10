import { useSyncExternalStore } from 'react'

// Cambios pendientes de la página actual. Lo publica quien los tiene (el Checklist) y lo consulta
// el diálogo de cierre de sesión, que es el único punto desde el que se cierra sesión.

export interface PendingChanges {
  dirty: boolean
  saving: boolean
}

const NONE: PendingChanges = {
  dirty: false,
  saving: false,
}

let current = NONE

const listeners = new Set<() => void>()

export function publishPendingChanges(
  next: PendingChanges,
): void {
  if (
    next.dirty === current.dirty &&
    next.saving === current.saving
  ) {
    return
  }

  current = next
  listeners.forEach((listener) => listener())
}

export function clearPendingChanges(): void {
  publishPendingChanges(NONE)
}

export function getPendingChanges(): PendingChanges {
  return current
}

function subscribe(
  listener: () => void,
): () => void {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function usePendingChanges(): PendingChanges {
  return useSyncExternalStore(
    subscribe,
    getPendingChanges,
    () => NONE,
  )
}

export interface LogoutConfirmation {
  warning: string | null
  confirmLabel: string
  confirmDisabled: boolean
}

export function getLogoutConfirmation({
  dirty,
  saving,
}: PendingChanges): LogoutConfirmation {
  if (saving) {
    return {
      warning:
        'Se están guardando cambios del Checklist. Espera a que termine.',
      confirmLabel: 'Guardando...',
      confirmDisabled: true,
    }
  }

  if (dirty) {
    return {
      warning:
        'Tienes cambios sin guardar en el Checklist. Si cierras la sesión, se perderán.',
      confirmLabel: 'Descartar y cerrar sesión',
      confirmDisabled: false,
    }
  }

  return {
    warning: null,
    confirmLabel: 'Cerrar sesión',
    confirmDisabled: false,
  }
}

/**
 * Solo se protege lo que decide el usuario. Ir a /login significa que la sesión ya
 * ha terminado (cierre confirmado, caducidad o invalidación por el servidor).
 */
export function shouldBlockNavigation(
  protect: boolean,
  currentPath: string,
  nextPath: string,
): boolean {
  return (
    protect &&
    currentPath !== nextPath &&
    nextPath !== '/login'
  )
}
