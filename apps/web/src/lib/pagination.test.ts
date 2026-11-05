import { describe, expect, it } from 'vitest'

import { clampPage, lastPageIfBeyondEnd, pageSlice, parsePageInput, reachablePages, totalPagesFor } from './pagination'

describe('parsePageInput', () => {
  it.each([
    ['1250', 2000, 1250],
    ['1', 2000, 1],
    ['2000', 2000, 2000],
    ['  7  ', 10, 7],
    ['007', 10, 7],
  ])('acepta «%s» con %i páginas como la página %i', (raw, total, page) => {
    expect(parsePageInput(raw, total)).toEqual({ ok: true, page })
  })

  it('va de la página 2 a la 1250 sin pasar por las intermedias', () => {
    // Solo se valida el número: la página resultante se pide directamente.
    expect(parsePageInput('1250', 1250)).toEqual({ ok: true, page: 1250 })
  })

  it('rechaza un campo vacío o con solo espacios', () => {
    expect(parsePageInput('', 10)).toEqual({ ok: false, error: 'Escribe un número de página.' })
    expect(parsePageInput('   ', 10)).toEqual({ ok: false, error: 'Escribe un número de página.' })
  })

  it.each(['-3', '+3', '2.5', '2,5', '1e3', 'abc', '3a', '0x10', '½', '٣'])('rechaza «%s» por no ser un entero positivo', raw => {
    expect(parsePageInput(raw, 2000)).toEqual({
      ok: false,
      error: 'Escribe un número entero positivo, sin decimales ni otros caracteres.',
    })
  })

  it.each(['0', '000'])('rechaza «%s»: la primera página es la 1', raw => {
    expect(parsePageInput(raw, 10)).toEqual({ ok: false, error: 'La primera página es la 1.' })
  })

  it('rechaza una página mayor que la última e indica cuál es', () => {
    expect(parsePageInput('11', 10)).toEqual({ ok: false, error: 'No existe esa página: la última es la 10.' })
    expect(parsePageInput('99999999999999999999', 10).ok).toBe(false)
  })

  it('con una sola página solo admite la 1', () => {
    expect(parsePageInput('1', 1)).toEqual({ ok: true, page: 1 })
    expect(parsePageInput('2', 1).ok).toBe(false)
  })

  it('sin total conocido no limita por arriba', () => {
    expect(parsePageInput('1250', null)).toEqual({ ok: true, page: 1250 })
  })

  const TOO_BIG = { ok: false, error: 'Ese número es demasiado grande para ser una página.' }

  it('acepta el mayor entero seguro de JavaScript', () => {
    expect(parsePageInput(String(Number.MAX_SAFE_INTEGER), null)).toEqual({ ok: true, page: Number.MAX_SAFE_INTEGER })
  })

  it('rechaza el primer entero no seguro', () => {
    expect(parsePageInput('9007199254740992', null)).toEqual(TOO_BIG)
  })

  it('rechaza números extremadamente grandes, también los que darían Infinity', () => {
    expect(Number('9'.repeat(400))).toBe(Infinity)
    expect(parsePageInput('9'.repeat(400), null)).toEqual(TOO_BIG)
    expect(parsePageInput('99999999999999999999', null)).toEqual(TOO_BIG)
    expect(parsePageInput('99999999999999999999', 10)).toEqual(TOO_BIG)
  })

  it('admite ceros iniciales aunque el texto sea largo', () => {
    expect(parsePageInput(`${'0'.repeat(50)}7`, 10)).toEqual({ ok: true, page: 7 })
  })

  describe('con un máximo del servidor', () => {
    it('acepta hasta el máximo aunque el total sea mayor', () => {
      expect(parsePageInput('10000', 20000, 10000)).toEqual({ ok: true, page: 10000 })
    })

    it('rechaza una página que existe pero el servidor no puede consultar', () => {
      const error = { ok: false, error: 'Solo se puede ir directamente hasta la página 10000.' }
      expect(parsePageInput('10001', 20000, 10000)).toEqual(error)
      expect(parsePageInput('20001', 20000, 10000)).toEqual(error)
    })

    it('si el total es menor que el máximo, el límite es la última página', () => {
      expect(parsePageInput('6', 5, 10000)).toEqual({ ok: false, error: 'No existe esa página: la última es la 5.' })
    })
  })
})

describe('reachablePages', () => {
  it.each([
    [0, undefined, 1],
    [1250, undefined, 1250],
    [1250, 10000, 1250],
    [20000, 10000, 10000],
    [0, 10000, 1],
  ])('con %i páginas y máximo %s se puede llegar a la %i', (total, max, expected) => {
    expect(reachablePages(total, max)).toBe(expected)
  })
})

describe('totalPagesFor', () => {
  it.each([
    [0, 6, 1],
    [1, 6, 1],
    [6, 6, 1],
    [7, 6, 2],
    [7500, 6, 1250],
  ])('%i elementos de %i en %i son %i páginas', (count, perPage, pages) => {
    expect(totalPagesFor(count, perPage)).toBe(pages)
  })
})

describe('clampPage', () => {
  it.each([
    [5, 10, 5],
    [0, 10, 1],
    [-2, 10, 1],
    [11, 10, 10],
    [3, 0, 1],
    [1250, 1250, 1250],
  ])('la página %i con %i páginas queda en la %i', (page, total, expected) => {
    expect(clampPage(page, total)).toBe(expected)
  })
})

describe('pageSlice', () => {
  const items = Array.from({ length: 7500 }, (_, index) => index + 1)

  it('devuelve la primera página', () => {
    expect(pageSlice(items, 1, 6)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('devuelve directamente la página 1250', () => {
    expect(pageSlice(items, 1250, 6)).toEqual([7495, 7496, 7497, 7498, 7499, 7500])
  })

  it('devuelve una última página incompleta', () => {
    expect(pageSlice([1, 2, 3, 4, 5, 6, 7], 2, 6)).toEqual([7])
  })

  it('sin elementos o fuera de rango devuelve una lista vacía', () => {
    expect(pageSlice([], 1, 6)).toEqual([])
    expect(pageSlice(items, 1251, 6)).toEqual([])
  })
})

describe('lastPageIfBeyondEnd', () => {
  it('no corrige una página con resultados', () => {
    expect(lastPageIfBeyondEnd(20, 1250, 1250)).toBeNull()
  })

  it('no corrige la primera página vacía (no hay resultados)', () => {
    expect(lastPageIfBeyondEnd(0, 1, 0)).toBeNull()
  })

  it('lleva a la última página si la pedida ya no existe', () => {
    expect(lastPageIfBeyondEnd(0, 1250, 1249)).toBe(1249)
  })

  it('lleva a la primera página si ya no queda ningún resultado', () => {
    expect(lastPageIfBeyondEnd(0, 5, 0)).toBe(1)
  })

  it('no corrige si la página vacía sigue dentro del total', () => {
    expect(lastPageIfBeyondEnd(0, 3, 3)).toBeNull()
  })
})
