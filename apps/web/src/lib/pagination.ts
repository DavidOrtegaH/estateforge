// Paginación compartida por los listados de la aplicación: validación del número de página
// que escribe el usuario para ir directamente a ella, límites y corte de una página.

export type PageInputResult =
  | { ok: true; page: number }
  | { ok: false; error: string }

/**
 * Valida el número de página escrito para el salto directo. Solo admite enteros positivos
 * escritos con dígitos (sin signo, decimales, exponentes ni otros caracteres), que sean
 * enteros seguros de JavaScript y, si se conoce el total, no mayores que la última página.
 * `maxPage` es la última página que el servidor puede consultar, si es menor que el total.
 * No hace ninguna petición: la página resultante se usa solo cuando el usuario confirma.
 */
export function parsePageInput(raw: string, totalPages: number | null, maxPage?: number): PageInputResult {
  const value = raw.trim()
  if (value === '') return { ok: false, error: 'Escribe un número de página.' }
  if (!/^\d+$/.test(value)) return { ok: false, error: 'Escribe un número entero positivo, sin decimales ni otros caracteres.' }
  const page = Number(value)
  // Muchas cifras dan un número inexacto o Infinity: no corresponde a ninguna página.
  if (!Number.isSafeInteger(page)) return { ok: false, error: 'Ese número es demasiado grande para ser una página.' }
  if (page < 1) return { ok: false, error: 'La primera página es la 1.' }
  if (totalPages !== null && page > totalPages && (maxPage === undefined || totalPages <= maxPage)) {
    return { ok: false, error: `No existe esa página: la última es la ${totalPages}.` }
  }
  if (maxPage !== undefined && page > maxPage) {
    return { ok: false, error: `Solo se puede ir directamente hasta la página ${maxPage}.` }
  }
  return { ok: true, page }
}

/** Número de páginas de un listado: al menos 1, también sin resultados. */
export function totalPagesFor(itemCount: number, perPage: number): number {
  return Math.max(1, Math.ceil(itemCount / perPage))
}

/** Última página a la que se puede ir: el total, acotado por el máximo del servidor si lo hay. */
export function reachablePages(totalPages: number, maxPage?: number): number {
  const total = Math.max(1, totalPages)
  return maxPage === undefined ? total : Math.min(total, maxPage)
}

/** Página dentro de los límites [1, totalPages]. */
export function clampPage(page: number, totalPages: number): number {
  return Math.max(1, Math.min(page, Math.max(1, totalPages)))
}

/** Elementos de la página indicada (1 = la primera), sin recorrer las anteriores. */
export function pageSlice<T>(items: readonly T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage
  return items.slice(start, start + perPage)
}

/**
 * Paginación en el servidor: si la página pedida llega vacía porque ya no existe (se han
 * borrado registros o ha cambiado el total), devuelve la última página con resultados para
 * cargarla; si no hay que corregir nada, devuelve null.
 */
export function lastPageIfBeyondEnd(itemsOnPage: number, page: number, pages: number): number | null {
  if (itemsOnPage > 0 || page <= 1) return null
  const last = Math.max(1, pages)
  return last < page ? last : null
}
