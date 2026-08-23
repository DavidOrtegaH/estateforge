import {
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Link } from 'react-router'

import {
  deleteGenerations,
  getGenerations,
  type GenerationItem,
} from '@/services/generationService'

const toneLabels: Record<string, string> = {
  professional: 'Profesional',
  friendly: 'Amigable',
  commercial: 'Comercial',
  luxurious: 'De lujo',
  casual: 'Casual',
  persuasive: 'Persuasivo',
  direct: 'Directo',
  premium: 'Premium',
}

function getToneLabel(
  tone: string | undefined,
): string {
  if (!tone) return 'No indicado'

  return (
    toneLabels[tone.toLowerCase()] ||
    tone
  )
}

function getLanguageLabel(
  language: string | undefined,
): string {
  if (!language) return 'No indicado'

  const normalized = language.toLowerCase()

  if (
    normalized === 'es' ||
    normalized === 'español' ||
    normalized === 'spanish'
  ) {
    return 'Español'
  }

  if (
    normalized === 'en' ||
    normalized === 'english' ||
    normalized === 'inglés'
  ) {
    return 'Inglés'
  }

  return language
}

function parseHighlights(
  highlights: unknown,
): string[] {
  if (Array.isArray(highlights)) {
    return highlights.filter(
      (item): item is string =>
        typeof item === 'string',
    )
  }

  if (typeof highlights === 'string') {
    try {
      const parsed: unknown =
        JSON.parse(highlights)

      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string =>
            typeof item === 'string',
        )
      }
    } catch {
      if (highlights.trim().length > 0) {
        return highlights
          .split('\n')
          .map((item) =>
            item
              .replace(/^[-•*]\s*/, '')
              .trim(),
          )
          .filter(Boolean)
      }
    }
  }

  return []
}

function HistoryPage() {
  const [generations, setGenerations] =
    useState<GenerationItem[]>([])

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const [deleting, setDeleting] =
    useState(false)

  const [deleteError, setDeleteError] =
    useState<string | null>(null)

  // IDs seleccionados.
  // Se mantienen aunque cambiemos de página.
  const [selectedIds, setSelectedIds] =
    useState<Set<string>>(new Set())

  // Estados para la paginación
  const [currentPage, setCurrentPage] =
    useState(1)

  const itemsPerPage = 3

  useEffect(() => {
    async function loadGenerations() {
      try {
        const result =
          await getGenerations()

        setGenerations(result)
      } catch {
        setError(
          'No se han podido cargar los anuncios.',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadGenerations()
  }, [])

  // Scroll instantáneo al cambiar de página
  useEffect(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    })
  }, [currentPage])

  // Cálculos de paginación
  const totalPages = Math.ceil(
    generations.length / itemsPerPage,
  )

  const indexOfLastItem =
    currentPage * itemsPerPage

  const indexOfFirstItem =
    indexOfLastItem - itemsPerPage

  const currentGenerations =
    generations.slice(
      indexOfFirstItem,
      indexOfLastItem,
    )

  // IDs de los anuncios de la página actual
  const currentPageIds = useMemo(
    () =>
      currentGenerations.map(
        (generation) => generation.id,
      ),
    [currentGenerations],
  )

  const selectedOnCurrentPage =
    currentPageIds.filter((id) =>
      selectedIds.has(id),
    ).length

  const allCurrentPageSelected =
    currentPageIds.length > 0 &&
    selectedOnCurrentPage ===
      currentPageIds.length

  const someCurrentPageSelected =
    selectedOnCurrentPage > 0 &&
    !allCurrentPageSelected

  const selectedCount = selectedIds.size

  const handleToggleGeneration = (
    generationId: string,
  ) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)

      if (next.has(generationId)) {
        next.delete(generationId)
      } else {
        next.add(generationId)
      }

      return next
    })

    setDeleteError(null)
  }

  const handleToggleCurrentPage = () => {
    setSelectedIds((previous) => {
      const next = new Set(previous)

      if (allCurrentPageSelected) {
        currentPageIds.forEach((id) => {
          next.delete(id)
        })
      } else {
        currentPageIds.forEach((id) => {
          next.add(id)
        })
      }

      return next
    })

    setDeleteError(null)
  }

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((previousPage) =>
        previousPage + 1,
      )
    }
  }

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((previousPage) =>
        previousPage - 1,
      )
    }
  }

  const handleDeleteSelected = async () => {
    if (
      selectedIds.size === 0 ||
      deleting
    ) {
      return
    }

    const count = selectedIds.size

    const confirmed = window.confirm(
      `¿Seguro que quieres eliminar ${count} ${
        count === 1
          ? 'anuncio'
          : 'anuncios'
      } seleccionados? Esta acción no se puede deshacer.`,
    )

    if (!confirmed) {
      return
    }

    setDeleting(true)
    setDeleteError(null)

    try {
      await deleteGenerations(
        Array.from(selectedIds),
      )

      const result =
        await getGenerations()

      setGenerations(result)
      setSelectedIds(new Set())

      const newTotalPages = Math.max(
        1,
        Math.ceil(
          result.length / itemsPerPage,
        ),
      )

      setCurrentPage((previousPage) =>
        Math.min(
          previousPage,
          newTotalPages,
        ),
      )
    } catch (deleteError) {
      console.error(
        'Error eliminando anuncios:',
        deleteError,
      )

      setDeleteError(
        'No se han podido eliminar los anuncios seleccionados.',
      )
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Historial
        </h1>

        <p className="mt-4 text-muted-foreground">
          Cargando anuncios...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Historial
        </h1>

        <p className="mt-4 text-destructive">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold">
          Historial
        </h1>

        <p className="mt-2 text-muted-foreground">
          Consulta los anuncios generados
          anteriormente.
        </p>
      </div>

      {deleteError && (
        <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">
            {deleteError}
          </p>
        </div>
      )}

      {generations.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <h2 className="font-semibold">
            Todavía no hay anuncios
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            Genera un anuncio desde el detalle
            de un inmueble para verlo aquí.
          </p>

          <Link
            to="/inmuebles"
            className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Ver inmuebles
          </Link>
        </div>
      ) : (
        <div>
          {/* Barra de selección */}
          <div className="mt-8 flex flex-col justify-between gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="select-current-page-generations"
                checked={
                  allCurrentPageSelected
                }
                ref={(element) => {
                  if (element) {
                    element.indeterminate =
                      someCurrentPageSelected
                  }
                }}
                onChange={
                  handleToggleCurrentPage
                }
                disabled={deleting}
                className="h-4 w-4 cursor-pointer"
              />

              <label
                htmlFor="select-current-page-generations"
                className="cursor-pointer text-sm font-medium"
              >
                Seleccionar todos los de esta página
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {selectedCount}{' '}
                {selectedCount === 1
                  ? 'anuncio seleccionado'
                  : 'anuncios seleccionados'}
              </span>

              {/* Botón de eliminar con espacio reservado mediante visibility */}
              <button
                type="button"
                onClick={
                  handleDeleteSelected
                }
                disabled={deleting || selectedCount === 0}
                aria-hidden={selectedCount === 0}
                tabIndex={selectedCount === 0 ? -1 : 0}
                className={`rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 ${
                  selectedCount > 0 ? 'visible' : 'invisible pointer-events-none'
                }`}
              >
                {deleting
                  ? 'Eliminando...'
                  : `Eliminar seleccionados (${selectedCount})`}
              </button>
            </div>
          </div>

          {/* Lista de anuncios */}
          <div className="mt-8 space-y-4">
            {currentGenerations.map(
              (generation) => {
                const highlights =
                  parseHighlights(
                    generation.highlights,
                  )

                const isSelected =
                  selectedIds.has(
                    generation.id,
                  )

                return (
                  <div
                    key={generation.id}
                    className={`relative rounded-lg border bg-card transition ${
                      isSelected
                        ? 'border-primary ring-2 ring-primary/25'
                        : 'border-border'
                    }`}
                  >
                    {/* Botón superior de selección */}
                    <div className="relative w-full overflow-hidden rounded-t-lg group">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar anuncio ${generation.title}`}
                        checked={isSelected}
                        onChange={() =>
                          handleToggleGeneration(
                            generation.id,
                          )
                        }
                        disabled={deleting}
                        className={`block h-8 w-full appearance-none border-0 cursor-pointer focus:outline-none transition-colors ${
                          isSelected
                            ? 'bg-foreground cursor-default'
                            : 'bg-accent group-hover:bg-primary'
                        }`}
                      />
                      <div className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium transition-colors ${
                        isSelected
                          ? 'text-background font-semibold'
                          : 'text-muted-foreground group-hover:text-primary-foreground group-hover:font-semibold'
                      }`}>
                        {isSelected ? '✓ Seleccionado' : 'Seleccionar'}
                      </div>
                    </div>

                    {/* Bloque central */}
                    <div className="p-5">
                      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-lg font-semibold">
                            {generation.title}
                          </h2>

                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                            {
                              generation.description
                            }
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2">
                          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                            {generation.provider}
                          </span>

                          <span className="rounded-md bg-muted px-2 py-1 text-xs">
                            {getToneLabel(
                              generation.tone,
                            )}
                          </span>

                          <span className="rounded-md bg-muted px-2 py-1 text-xs">
                            {getLanguageLabel(
                              generation.language,
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="mt-5 rounded-md bg-muted/50 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Inmueble
                        </p>

                        <Link
                          to={`/inmuebles/${generation.propertyId}`}
                          className="mt-1 block text-sm font-medium hover:text-primary hover:underline"
                        >
                          {generation.property
                            ?.city ||
                            'Sin ciudad'}

                          {generation.property
                            ?.neighborhood
                            ? ` · ${generation.property.neighborhood}`
                            : ''}
                        </Link>
                      </div>

                      {highlights.length > 0 && (
                        <div className="mt-5">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Características destacadas
                          </p>

                          <ul className="mt-2 space-y-1 text-sm">
                            {highlights.map(
                              (highlight) => (
                                <li
                                  key={highlight}
                                  className="text-muted-foreground"
                                >
                                  • {highlight}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}

                      {generation.callToAction && (
                        <div className="mt-5">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Llamada a la acción
                          </p>

                          <p className="mt-1 text-sm">
                            {
                              generation.callToAction
                            }
                          </p>
                        </div>
                      )}

                      <div className="mt-5 border-t pt-4">
                        <p className="text-xs text-muted-foreground">
                          Generado el{' '}
                          {new Date(
                            generation.createdAt,
                          ).toLocaleString(
                            'es-ES',
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Contenido navegable (Ver anuncio) */}
                    <Link
                      to={`/historial/${generation.id}`}
                      className="block group"
                    >
                      <div className="relative h-8 w-full overflow-hidden rounded-b-lg">
                        <button
                          type="button"
                          aria-label="Ver anuncio"
                          className="block h-full w-full border-0 bg-accent group-hover:bg-primary group-hover:text-primary-foreground cursor-pointer focus:outline-none transition-colors"
                        />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground group-hover:text-primary-foreground group-hover:font-semibold transition-colors">
                          Ver anuncio
                        </div>
                      </div>
                    </Link>
                  </div>
                )
              },
            )}
          </div>

          {/* Controles de paginación */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between border-t pt-4">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={
                  currentPage === 1 ||
                  deleting
                }
                className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-muted"
              >
                Anterior
              </button>

              <span className="text-sm text-muted-foreground">
                Página{' '}
                <span className="font-semibold">
                  {currentPage}
                </span>{' '}
                de{' '}
                <span className="font-semibold">
                  {totalPages}
                </span>
              </span>

              <button
                type="button"
                onClick={handleNextPage}
                disabled={
                  currentPage ===
                    totalPages ||
                  deleting
                }
                className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-muted"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default HistoryPage