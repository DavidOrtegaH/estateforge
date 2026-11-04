import { describe, expect, it } from 'vitest'

import {
  buildTabStops,
  canReceiveFocus,
  dialogKeyAction,
  entryMember,
  tabBoundaryAction,
  type TabStopCandidate,
} from './dialogFocus'

// Lógica pura: no comprueba el foco real ni el orden de tabulación de un navegador
// (eso se prueba a mano).

describe('tabBoundaryAction', () => {
  it('Tab en el último punto vuelve al primero', () => {
    expect(tabBoundaryAction(3, 2, false)).toEqual({ type: 'focus-stop', stop: 0 })
  })

  it('Shift+Tab en el primer punto va al último', () => {
    expect(tabBoundaryAction(3, 0, true)).toEqual({ type: 'focus-stop', stop: 2 })
  })

  it('Tab en un punto intermedio o en el primero se deja al navegador', () => {
    expect(tabBoundaryAction(3, 0, false)).toEqual({ type: 'native' })
    expect(tabBoundaryAction(3, 1, false)).toEqual({ type: 'native' })
  })

  it('Shift+Tab en un punto intermedio o en el último se deja al navegador', () => {
    expect(tabBoundaryAction(3, 1, true)).toEqual({ type: 'native' })
    expect(tabBoundaryAction(3, 2, true)).toEqual({ type: 'native' })
  })

  it('con dos puntos, cada extremo lleva al otro y no hay intermedios', () => {
    expect(tabBoundaryAction(2, 1, false)).toEqual({ type: 'focus-stop', stop: 0 })
    expect(tabBoundaryAction(2, 0, true)).toEqual({ type: 'focus-stop', stop: 1 })
    expect(tabBoundaryAction(2, 0, false)).toEqual({ type: 'native' })
    expect(tabBoundaryAction(2, 1, true)).toEqual({ type: 'native' })
  })

  it('con un único punto, Tab y Shift+Tab dejan el foco donde está', () => {
    expect(tabBoundaryAction(1, 0, false)).toEqual({ type: 'stay' })
    expect(tabBoundaryAction(1, 0, true)).toEqual({ type: 'stay' })
  })

  it('sin puntos de tabulación, el foco va al propio diálogo', () => {
    expect(tabBoundaryAction(0, -1, false)).toEqual({ type: 'focus-dialog' })
    expect(tabBoundaryAction(0, -1, true)).toEqual({ type: 'focus-dialog' })
  })

  it('con el foco fuera de los puntos, Tab va al primero y Shift+Tab al último', () => {
    expect(tabBoundaryAction(3, -1, false)).toEqual({ type: 'focus-stop', stop: 0 })
    expect(tabBoundaryAction(3, -1, true)).toEqual({ type: 'focus-stop', stop: 2 })
    expect(tabBoundaryAction(1, -1, false)).toEqual({ type: 'focus-stop', stop: 0 })
    expect(tabBoundaryAction(1, -1, true)).toEqual({ type: 'focus-stop', stop: 0 })
  })

  it('un índice fuera de rango se trata como foco fuera de los puntos', () => {
    expect(tabBoundaryAction(3, 7, false)).toEqual({ type: 'focus-stop', stop: 0 })
    expect(tabBoundaryAction(3, 3, true)).toEqual({ type: 'focus-stop', stop: 2 })
  })
})

describe('buildTabStops', () => {
  const plain = (tabIndex = 0): TabStopCandidate => ({ tabIndex, radioGroup: null, checked: false })
  const radio = (group: string, checked = false, tabIndex = 0): TabStopCandidate => ({ tabIndex, radioGroup: group, checked })

  it('sin tabindex positivo ni radios, cada elemento es un punto en orden del documento', () => {
    expect(buildTabStops([plain(), plain(), plain()])).toEqual([[0], [1], [2]])
  })

  it('sin candidatos no hay puntos', () => {
    expect(buildTabStops([])).toEqual([])
  })

  it('los radios con el mismo nombre forman un único punto', () => {
    expect(buildTabStops([plain(), radio('0:plan'), radio('0:plan', true), radio('0:plan'), plain()]))
      .toEqual([[0], [1, 2, 3], [4]])
  })

  it('grupos distintos y radios sin nombre son puntos separados', () => {
    expect(buildTabStops([radio('0:a'), radio('0:b'), plain(), radio('0:a')]))
      .toEqual([[0, 3], [1], [2]])
  })

  it('el mismo nombre en otro formulario es otro grupo', () => {
    expect(buildTabStops([radio('0:plan'), radio('1:plan')])).toEqual([[0], [1]])
  })

  it('los de tabindex positivo van antes, de menor a mayor, y los de 0 después', () => {
    expect(buildTabStops([plain(), plain(2), plain(), plain(1), plain(2)]))
      .toEqual([[3], [1], [4], [0], [2]])
  })

  it('con tabindex positivo, el primer y el último punto no son los del orden del documento', () => {
    const stops = buildTabStops([plain(), plain(), plain(1)])
    expect(stops[0]).toEqual([2])
    expect(stops[stops.length - 1]).toEqual([1])
  })
})

describe('entryMember', () => {
  it('entra por el radio marcado en ambas direcciones', () => {
    expect(entryMember([false, true, false], false)).toBe(1)
    expect(entryMember([false, true, false], true)).toBe(1)
  })

  it('sin radio marcado, entra por el primero hacia delante y por el último hacia atrás', () => {
    expect(entryMember([false, false, false], false)).toBe(0)
    expect(entryMember([false, false, false], true)).toBe(2)
  })

  it('un punto de un solo elemento entra por él', () => {
    expect(entryMember([false], false)).toBe(0)
    expect(entryMember([false], true)).toBe(0)
  })
})

describe('dialogKeyAction', () => {
  it('Escape cierra cuando se permite cerrar', () => {
    expect(dialogKeyAction('Escape', false, true)).toBe('close')
    expect(dialogKeyAction('Esc', false, true)).toBe('close')
  })

  it('Escape no hace nada cuando no se permite cerrar (por ejemplo, mientras se envía)', () => {
    expect(dialogKeyAction('Escape', false, false)).toBeNull()
    expect(dialogKeyAction('Esc', false, false)).toBeNull()
  })

  it('Tab y Shift+Tab se evalúan, aunque no se permita cerrar', () => {
    expect(dialogKeyAction('Tab', false, true)).toBe('focus-next')
    expect(dialogKeyAction('Tab', true, true)).toBe('focus-previous')
    expect(dialogKeyAction('Tab', false, false)).toBe('focus-next')
  })

  it.each(['Enter', ' ', 'a', 'ArrowDown', 'Shift', 'escape', ''])('la tecla %j no le afecta', key => {
    expect(dialogKeyAction(key, false, true)).toBeNull()
    expect(dialogKeyAction(key, true, true)).toBeNull()
  })
})

describe('canReceiveFocus', () => {
  const usable = { disabled: false, tabIndex: 0, hidden: false, rendered: true }

  it('acepta un control activo, visible y en el orden de tabulación', () => {
    expect(canReceiveFocus(usable)).toBe(true)
    expect(canReceiveFocus({ ...usable, tabIndex: 2 })).toBe(true)
  })

  it.each([
    ['deshabilitado', { disabled: true }],
    ['fuera del orden de tabulación (tabindex -1)', { tabIndex: -1 }],
    ['oculto (hidden, inert o visibility: hidden)', { hidden: true }],
    ['sin renderizar (display: none)', { rendered: false }],
  ])('descarta un control %s', (_label, change) => {
    expect(canReceiveFocus({ ...usable, ...change })).toBe(false)
  })
})
