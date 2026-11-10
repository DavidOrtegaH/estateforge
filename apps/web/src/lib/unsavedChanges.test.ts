import { afterEach, describe, expect, it } from 'vitest'

import {
  clearPendingChanges,
  getLogoutConfirmation,
  getPendingChanges,
  publishPendingChanges,
  shouldBlockNavigation,
} from './unsavedChanges'

afterEach(clearPendingChanges)

describe('almacén de cambios pendientes', () => {
  it('empieza sin cambios', () => {
    expect(getPendingChanges()).toEqual({ dirty: false, saving: false })
  })

  it('refleja lo publicado y se limpia al salir', () => {
    publishPendingChanges({ dirty: true, saving: false })
    expect(getPendingChanges().dirty).toBe(true)

    clearPendingChanges()
    expect(getPendingChanges().dirty).toBe(false)
  })
})

describe('diálogo de cierre de sesión', () => {
  it('sin cambios conserva el comportamiento habitual', () => {
    expect(getLogoutConfirmation({ dirty: false, saving: false })).toEqual({
      warning: null,
      confirmLabel: 'Cerrar sesión',
      confirmDisabled: false,
    })
  })

  it('con cambios avisa y lo dice en el botón', () => {
    const result = getLogoutConfirmation({ dirty: true, saving: false })

    expect(result.warning).toContain('cambios sin guardar')
    expect(result.confirmLabel).toBe('Descartar y cerrar sesión')
    expect(result.confirmDisabled).toBe(false)
  })

  it('no se puede confirmar con un guardado en curso', () => {
    for (const dirty of [true, false]) {
      expect(getLogoutConfirmation({ dirty, saving: true }).confirmDisabled).toBe(true)
    }
  })
})

describe('navegación con cambios pendientes', () => {
  it('protege las salidas a otra ruta', () => {
    expect(shouldBlockNavigation(true, '/historial/a', '/inmuebles')).toBe(true)
  })

  it('no bloquea sin cambios ni dentro de la misma ruta', () => {
    expect(shouldBlockNavigation(false, '/historial/a', '/inmuebles')).toBe(false)
    expect(shouldBlockNavigation(true, '/historial/a', '/historial/a')).toBe(false)
  })

  it('nunca bloquea una sesión que ha terminado', () => {
    expect(shouldBlockNavigation(true, '/historial/a', '/login')).toBe(false)
  })
})
