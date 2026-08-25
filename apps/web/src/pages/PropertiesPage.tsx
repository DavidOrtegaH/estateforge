import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import {
  deleteProperties,
  getProperties,
  type PropertyItem,
} from '@/services/propertyService'

// Diccionario de traducción para los tipos de inmueble
const propertyTypeLabels: Record<string, string> = {
  apartment: 'Apartamento',
  flat: 'Piso',
  house: 'Casa',
  chalet: 'Chalet',
  penthouse: 'Ático',
  duplex: 'Dúplex',
  studio: 'Estudio',
  commercial: 'Local comercial',
  office: 'Oficina',
  land: 'Terreno',
}

// Diccionario de traducción para las operaciones
const propertyOperationLabels: Record<string, string> = {
  sale: 'Venta',
  rent: 'Alquiler',
}

// Diccionario de traducción para el estado del inmueble basado en las opciones
const propertyConditionLabels: Record<string, string> = {
  new: 'Obra nueva',
  good: 'Buen estado',
  renovated: 'Reformado',
  'needs-renovation': 'Necesita reforma',
  'to-renovate': 'Necesita reforma', // Mapeo adicional para 'to_renovate' normalizado
}

function getPropertyOperation(
  type: string | undefined,
): string {
  if (!type) return 'No indicado'

  return (
    propertyOperationLabels[type.toLowerCase()] ||
    type
  )
}

function getPropertyTypeLabel(
  type: string | undefined,
): string {
  if (!type) return 'No indicado'

  return (
    propertyTypeLabels[type.toLowerCase()] ||
    type
  )
}

function getPropertyCondition(
  condition: string | undefined,
): string {
  if (!condition) return ''

  // Normalizamos reemplazando guiones bajos por guiones y pasando a minúsculas
  const normalizedCondition = condition
    .toLowerCase()
    .replace(/_/g, '-')

  return (
    propertyConditionLabels[normalizedCondition] ||
    condition
  )
}

// Función auxiliar para poner la primera letra en mayúscula
function capitalizeFirstLetter(text: string | undefined): string {
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function parseHighlights(
  highlights: unknown,
): string[] {
  if (Array.isArray(highlights)) {
    return highlights.filter(
      (item): item is string =>
        typeof item === 'string' &&
        item.trim().length > 0,
    )
  }

  if (typeof highlights === 'string') {
    try {
      const parsed: unknown =
        JSON.parse(highlights)

      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string =>
            typeof item === 'string' &&
            item.trim().length > 0,
        )
      }
    } catch {
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

  return []
}

function getPropertyHighlights(
  property: PropertyItem,
): string[] {
  const highlights: string[] = []

  for (const generation of property.generations) {
    const generationHighlights =
      parseHighlights(
        generation.highlights,
      )

    for (const highlight of generationHighlights) {
      if (!highlights.includes(highlight)) {
        highlights.push(highlight)
      }
    }
  }

  return highlights
}

function PropertiesPage() {
  const [properties, setProperties] =
    useState<PropertyItem[]>([])

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

  const itemsPerPage = 6

  useEffect(() => {
    async function loadProperties() {
      try {
        const result =
          await getProperties()

        setProperties(result)
      } catch {
        setError(
          'No se han podido cargar los inmuebles.',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadProperties()
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
    properties.length / itemsPerPage,
  )

  const indexOfLastItem =
    currentPage * itemsPerPage

  const indexOfFirstItem =
    indexOfLastItem - itemsPerPage

  const currentProperties =
    properties.slice(
      indexOfFirstItem,
      indexOfLastItem,
    )

  // IDs seleccionados que pertenecen a la página actual
  const currentPageIds = useMemo(
    () =>
      currentProperties.map(
        (property) => property.id,
      ),
    [currentProperties],
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

  const handleToggleProperty = (
    propertyId: string,
  ) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)

      if (next.has(propertyId)) {
        next.delete(propertyId)
      } else {
        next.add(propertyId)
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
      setCurrentPage((prev) => prev + 1)
    }
  }

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1)
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
      `¿Seguro que quieres eliminar ${count} ${count === 1
        ? 'inmueble'
        : 'inmuebles'
      } seleccionados? También se eliminarán todos los anuncios generados asociados.`,
    )

    if (!confirmed) {
      return
    }

    setDeleting(true)
    setDeleteError(null)

    try {
      await deleteProperties(
        Array.from(selectedIds),
      )

      const result =
        await getProperties()

      setProperties(result)
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
    } catch (error) {
      console.error(
        'Error eliminando inmuebles:',
        error,
      )

      setDeleteError(
        'No se han podido eliminar los inmuebles seleccionados.',
      )
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Inmuebles
        </h1>

        <p className="mt-4 text-muted-foreground">
          Cargando inmuebles...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Inmuebles
        </h1>

        <p className="mt-4 text-destructive">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold">
            Inmuebles
          </h1>

          <p className="mt-2 text-muted-foreground">
            Gestiona los inmuebles y sus anuncios
            generados.
          </p>
        </div>

        <Link
          to="/inmuebles/nuevo"
          className="inline-flex w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Crear inmueble
        </Link>
      </div>

      {deleteError && (
        <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">
            {deleteError}
          </p>
        </div>
      )}

      {properties.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <h2 className="font-semibold">
            No hay inmuebles todavía
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            Crea tu primer inmueble para empezar
            a generar anuncios.
          </p>

          <Link
            to="/inmuebles/nuevo"
            className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Crear inmueble
          </Link>
        </div>
      ) : (
        <div>
          {/* Barra de selección */}
          <div className="mt-8 flex flex-col justify-between gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="select-current-page"
                checked={allCurrentPageSelected}
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
                htmlFor="select-current-page"
                className="cursor-pointer text-sm font-medium"
              >
                Seleccionar todos los de esta página
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {selectedCount}{' '}
                {selectedCount === 1
                  ? 'inmueble seleccionado'
                  : 'inmuebles seleccionados'}
              </span>

              {/* Botón de eliminar con espacio reservado */}
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={
                  deleting ||
                  selectedCount === 0
                }
                aria-hidden={
                  selectedCount === 0
                }
                tabIndex={
                  selectedCount === 0
                    ? -1
                    : 0
                }
                className={`rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 ${selectedCount > 0
                    ? 'visible'
                    : 'invisible pointer-events-none'
                  }`}
              >
                {deleting
                  ? 'Eliminando...'
                  : `Eliminar seleccionados (${selectedCount})`}
              </button>
            </div>
          </div>

          <div className="mt-8 grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
            {currentProperties.map(
              (property) => {
                const generationCount =
                  property.generations.length

                const isSelected =
                  selectedIds.has(
                    property.id,
                  )

                const highlights =
                  getPropertyHighlights(
                    property,
                  )

                return (
                  <div
                    key={property.id}
                    className={`relative flex h-full flex-col rounded-lg border bg-card transition ${isSelected
                        ? 'border-primary ring-2 ring-primary/25'
                        : 'border-border'
                      }`}
                  >
                    {/* Selector superior */}
                    <div className="group relative w-full overflow-hidden rounded-t-lg">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${getPropertyTypeLabel(
                          property.type,
                        )} en ${property.city ||
                          'Sin ciudad'
                          }`}
                        checked={isSelected}
                        onChange={() =>
                          handleToggleProperty(
                            property.id,
                          )
                        }
                        disabled={deleting}
                        className={`block h-8 w-full cursor-pointer appearance-none border-0 transition-colors focus:outline-none ${isSelected
                            ? 'cursor-default bg-foreground'
                            : 'bg-accent group-hover:bg-primary'
                          }`}
                      />

                      <div
                        className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium transition-colors ${isSelected
                            ? 'font-semibold text-background'
                            : 'text-muted-foreground group-hover:font-semibold group-hover:text-primary-foreground'
                          }`}
                      >
                        {isSelected
                          ? '✓ Seleccionado'
                          : 'Seleccionar'}
                      </div>
                    </div>

                    {/* Contenido central */}
                    <div className="flex flex-1 flex-col p-5">
                      {/* Parte superior */}
                      <div>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h2 className="mt-1 text-lg font-semibold pb-12">
                              {property.title}
                            </h2>
                          </div>

                          <p className="whitespace-nowrap text-lg font-bold">
                            {property.price.toLocaleString(
                              'es-ES',
                            )}{' '}
                            €
                          </p>
                        </div>
                      </div>

                      {/* Zona de highlights + contador */}
                      <div className="mt-auto">
                        <div className="flex min-h-21 flex-col justify-end pb-4">
                          {highlights.length > 0 && (
                            <div className="flex flex-wrap items-end gap-2">
                              {highlights
                                .slice(0, 5)
                                .map(
                                  (
                                    highlight,
                                  ) => (
                                    <span
                                      key={
                                        highlight
                                      }
                                      className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                                    >
                                      {
                                        highlight
                                      }
                                    </span>
                                  ),
                                )}
                              {property.condition && (
                                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                  {getPropertyCondition(property.condition)}
                                </span>
                              )}

                              {property.operation && (
                                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                  {getPropertyOperation(property.operation)}
                                </span>
                              )}

                              {property.type && (
                                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                  {getPropertyTypeLabel(property.type)}
                                </span>
                              )}

                              {property.city && (
                                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                  {capitalizeFirstLetter(property.city)}
                                </span>
                              )}

                              {property.neighborhood && (
                                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                  {capitalizeFirstLetter(property.neighborhood)}
                                </span>
                              )}

                              {property.address && (
                                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                  {capitalizeFirstLetter(property.address)}
                                </span>
                              )}

                            </div>
                          )}
                        </div>

                        {/* Línea divisoria + anuncios */}
                        <div className="border-t pt-4">
                          <p className="text-xs text-muted-foreground">
                            Anuncios generados
                          </p>

                          <p className="mt-1 text-sm font-medium">
                            {generationCount}{' '}
                            {generationCount ===
                              1
                              ? 'anuncio'
                              : 'anuncios'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Ver detalles */}
                    <Link
                      to={`/inmuebles/${property.id}`}
                      className="group mt-auto block"
                    >
                      <div className="relative h-8 w-full overflow-hidden rounded-b-lg">
                        <button
                          type="button"
                          aria-label="Ver detalles"
                          className="block h-full w-full cursor-pointer border-0 bg-accent transition-colors group-hover:bg-primary group-hover:text-primary-foreground focus:outline-none"
                        />

                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground transition-colors group-hover:font-semibold group-hover:text-primary-foreground">
                          Ver detalles
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
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
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
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
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

export default PropertiesPage