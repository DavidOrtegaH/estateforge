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

const operationLabels: Record<string, string> = {
  sale: 'Venta',
  rent: 'Alquiler',
}

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

type SortOption =
  | 'newest'
  | 'oldest'
  | 'price-desc'
  | 'price-asc'

type NumberFilter = {
  min: string
  max: string
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

function getOperationLabel(
  operation: string | undefined,
): string {
  if (!operation) return 'No indicado'

  return (
    operationLabels[operation.toLowerCase()] ||
    operation
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

function getNumberValue(
  value: unknown,
): number | null {
  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(
      value.replace(',', '.'),
    )

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function matchesNumberFilter(
  value: unknown,
  filter: NumberFilter,
): boolean {
  const numericValue = getNumberValue(value)

  if (numericValue === null) {
    return (
      filter.min.trim() === '' &&
      filter.max.trim() === ''
    )
  }

  const min =
    filter.min.trim() === ''
      ? null
      : Number(
          filter.min.replace(',', '.'),
        )

  const max =
    filter.max.trim() === ''
      ? null
      : Number(
          filter.max.replace(',', '.'),
        )

  if (
    min !== null &&
    Number.isFinite(min) &&
    numericValue < min
  ) {
    return false
  }

  if (
    max !== null &&
    Number.isFinite(max) &&
    numericValue > max
  ) {
    return false
  }

  return true
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

  const [selectedIds, setSelectedIds] =
    useState<Set<string>>(new Set())

  const [currentPage, setCurrentPage] =
    useState(1)

  const itemsPerPage = 3

  /*
   * =====================================================
   * BÚSQUEDA, ORDENACIÓN Y FILTROS
   * =====================================================
   */

  const [searchTerm, setSearchTerm] =
    useState('')

  const [sortOption, setSortOption] =
    useState<SortOption>('newest')

  const [isFilterOpen, setIsFilterOpen] =
    useState(false)

  const [filterOperation, setFilterOperation] =
    useState('')

  const [filterPropertyType, setFilterPropertyType] =
    useState('')

  const [filterCity, setFilterCity] =
    useState('')

  const [filterProvider, setFilterProvider] =
    useState('')

  const [filterTone, setFilterTone] =
    useState('')

  const [filterLanguage, setFilterLanguage] =
    useState('')

  const [filterPrice, setFilterPrice] =
    useState<NumberFilter>({
      min: '',
      max: '',
    })

  const [filterArea, setFilterArea] =
    useState<NumberFilter>({
      min: '',
      max: '',
    })

  const [filterBedrooms, setFilterBedrooms] =
    useState<NumberFilter>({
      min: '',
      max: '',
    })

  const [filterBathrooms, setFilterBathrooms] =
    useState<NumberFilter>({
      min: '',
      max: '',
    })

  const [filterHasHighlights, setFilterHasHighlights] =
    useState(false)

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

  /*
   * =====================================================
   * RESULTADOS FILTRADOS Y ORDENADOS
   * =====================================================
   */

  const processedGenerations = useMemo(() => {
    const normalizedSearch =
      searchTerm.trim().toLowerCase()

    const filtered = generations.filter(
      (generation) => {
        /*
         * Búsqueda por título del anuncio.
         * Permite coincidencias parciales.
         */
        if (
          normalizedSearch &&
          !generation.title
            .toLowerCase()
            .includes(normalizedSearch)
        ) {
          return false
        }

        const property =
          generation.property

        /*
         * Operación.
         */
        if (
          filterOperation &&
          property?.operation?.toLowerCase() !==
            filterOperation.toLowerCase()
        ) {
          return false
        }

        /*
         * Tipo de inmueble.
         */
        if (
          filterPropertyType &&
          property?.type?.toLowerCase() !==
            filterPropertyType.toLowerCase()
        ) {
          return false
        }

        /*
         * Ciudad.
         */
        if (
          filterCity &&
          !property?.city
            ?.toLowerCase()
            .includes(
              filterCity.trim().toLowerCase(),
            )
        ) {
          return false
        }

        /*
         * Proveedor.
         */
        if (
          filterProvider &&
          generation.provider
            ?.toLowerCase()
            .includes(
              filterProvider
                .trim()
                .toLowerCase(),
            ) !== true
        ) {
          return false
        }

        /*
         * Tono.
         */
        if (
          filterTone &&
          generation.tone?.toLowerCase() !==
            filterTone.toLowerCase()
        ) {
          return false
        }

        /*
         * Idioma.
         */
        if (
          filterLanguage &&
          generation.language?.toLowerCase() !==
            filterLanguage.toLowerCase()
        ) {
          return false
        }

        /*
         * Precio.
         */
        if (
          !matchesNumberFilter(
            property?.price,
            filterPrice,
          )
        ) {
          return false
        }

        /*
         * Superficie.
         */
        if (
          !matchesNumberFilter(
            property?.area,
            filterArea,
          )
        ) {
          return false
        }

        /*
         * Habitaciones.
         */
        if (
          !matchesNumberFilter(
            property?.bedrooms,
            filterBedrooms,
          )
        ) {
          return false
        }

        /*
         * Baños.
         */
        if (
          !matchesNumberFilter(
            property?.bathrooms,
            filterBathrooms,
          )
        ) {
          return false
        }

        /*
         * Solo anuncios con características destacadas.
         */
        if (filterHasHighlights) {
          const highlights =
            parseHighlights(
              generation.highlights,
            )

          if (highlights.length === 0) {
            return false
          }
        }

        return true
      },
    )

    /*
     * Ordenación.
     */
    return [...filtered].sort(
      (a, b) => {
        if (
          sortOption === 'newest' ||
          sortOption === 'oldest'
        ) {
          const dateA =
            new Date(
              a.createdAt,
            ).getTime()

          const dateB =
            new Date(
              b.createdAt,
            ).getTime()

          return sortOption === 'newest'
            ? dateB - dateA
            : dateA - dateB
        }

        const priceA =
          getNumberValue(
            a.property?.price,
          ) ?? 0

        const priceB =
          getNumberValue(
            b.property?.price,
          ) ?? 0

        return sortOption ===
          'price-desc'
          ? priceB - priceA
          : priceA - priceB
      },
    )
  }, [
    generations,
    searchTerm,
    sortOption,
    filterOperation,
    filterPropertyType,
    filterCity,
    filterProvider,
    filterTone,
    filterLanguage,
    filterPrice,
    filterArea,
    filterBedrooms,
    filterBathrooms,
    filterHasHighlights,
  ])

  /*
   * =====================================================
   * PAGINACIÓN
   * =====================================================
   */

  const totalPages = Math.max(
    1,
    Math.ceil(
      processedGenerations.length /
        itemsPerPage,
    ),
  )

  const indexOfLastItem =
    currentPage * itemsPerPage

  const indexOfFirstItem =
    indexOfLastItem - itemsPerPage

  const currentGenerations =
    processedGenerations.slice(
      indexOfFirstItem,
      indexOfLastItem,
    )

  /*
   * Cuando cambian los resultados, volvemos
   * automáticamente a la primera página.
   */
  useEffect(() => {
    setCurrentPage(1)
  }, [
    searchTerm,
    sortOption,
    filterOperation,
    filterPropertyType,
    filterCity,
    filterProvider,
    filterTone,
    filterLanguage,
    filterPrice,
    filterArea,
    filterBedrooms,
    filterBathrooms,
    filterHasHighlights,
  ])

  /*
   * Evita quedarse en una página inexistente
   * después de borrar o filtrar.
   */
  useEffect(() => {
    setCurrentPage(
      (previousPage) =>
        Math.min(
          previousPage,
          totalPages,
        ),
    )
  }, [totalPages])

  useEffect(() => {
    window.scrollTo({
      top:
        document.documentElement
          .scrollHeight,
      behavior: 'instant',
    })
  }, [currentPage])

  /*
   * =====================================================
   * SELECCIÓN
   * =====================================================
   */

  const currentPageIds = useMemo(
    () =>
      currentGenerations.map(
        (generation) =>
          generation.id,
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

  const selectedCount =
    selectedIds.size

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

  /*
   * =====================================================
   * BORRADO
   * =====================================================
   */

  const handleDeleteSelected =
    async () => {
      if (
        selectedIds.size === 0 ||
        deleting
      ) {
        return
      }

      const count =
        selectedIds.size

      const confirmed =
        window.confirm(
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

        const newTotalPages =
          Math.max(
            1,
            Math.ceil(
              result.length /
                itemsPerPage,
            ),
          )

        setCurrentPage(
          (previousPage) =>
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

  /*
   * =====================================================
   * FILTROS
   * =====================================================
   */

  const clearFilters = () => {
    setFilterOperation('')
    setFilterPropertyType('')
    setFilterCity('')
    setFilterProvider('')
    setFilterTone('')
    setFilterLanguage('')

    setFilterPrice({
      min: '',
      max: '',
    })

    setFilterArea({
      min: '',
      max: '',
    })

    setFilterBedrooms({
      min: '',
      max: '',
    })

    setFilterBathrooms({
      min: '',
      max: '',
    })

    setFilterHasHighlights(false)
  }

  const activeFilterCount =
    [
      filterOperation,
      filterPropertyType,
      filterCity,
      filterProvider,
      filterTone,
      filterLanguage,
      filterPrice.min,
      filterPrice.max,
      filterArea.min,
      filterArea.max,
      filterBedrooms.min,
      filterBedrooms.max,
      filterBathrooms.min,
      filterBathrooms.max,
      filterHasHighlights
        ? 'highlights'
        : '',
    ].filter(Boolean).length

  /*
   * Opciones dinámicas disponibles en los datos.
   */
  const operationOptions =
    useMemo(() => {
      return Array.from(
        new Set(
          generations
            .map(
              (generation) =>
                generation.property
                  ?.operation,
            )
            .filter(Boolean),
        ),
      ) as string[]
    }, [generations])

  const propertyTypeOptions =
    useMemo(() => {
      return Array.from(
        new Set(
          generations
            .map(
              (generation) =>
                generation.property
                  ?.type,
            )
            .filter(Boolean),
        ),
      ) as string[]
    }, [generations])

  const providerOptions =
    useMemo(() => {
      return Array.from(
        new Set(
          generations
            .map(
              (generation) =>
                generation.provider,
            )
            .filter(Boolean),
        ),
      ) as string[]
    }, [generations])

  const toneOptions =
    useMemo(() => {
      return Array.from(
        new Set(
          generations
            .map(
              (generation) =>
                generation.tone,
            )
            .filter(Boolean),
        ),
      ) as string[]
    }, [generations])

  const languageOptions =
    useMemo(() => {
      return Array.from(
        new Set(
          generations
            .map(
              (generation) =>
                generation.language,
            )
            .filter(Boolean),
        ),
      ) as string[]
    }, [generations])

  /*
   * =====================================================
   * ESTADOS DE CARGA / ERROR
   * =====================================================
   */

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

  /*
   * =====================================================
   * RENDER
   * =====================================================
   */

  return (
    <>
      <div
        className={
          isFilterOpen
            ? 'pointer-events-none select-none blur-sm transition'
            : 'transition'
        }
      >
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
                Genera un anuncio desde el
                detalle de un inmueble para
                verlo aquí.
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
              {/* =================================================
                  BÚSQUEDA / ORDENAR / FILTRAR
                  ================================================= */}

              <div className="mt-8 rounded-lg border bg-card p-4">
                <div className="flex flex-col gap-3 lg:flex-row">
                  {/* Buscador */}
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor="history-search"
                      className="sr-only"
                    >
                      Buscar anuncio
                    </label>

                    <input
                      id="history-search"
                      type="search"
                      value={searchTerm}
                      onChange={(event) =>
                        setSearchTerm(
                          event.target.value,
                        )
                      }
                      placeholder="Buscar por título del anuncio..."
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  {/* Ordenar */}
                  <select
                    value={sortOption}
                    onChange={(event) =>
                      setSortOption(
                        event.target
                          .value as SortOption,
                      )
                    }
                    aria-label="Ordenar anuncios"
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="newest">
                      Más nuevos
                    </option>

                    <option value="oldest">
                      Más antiguos
                    </option>

                    <option value="price-desc">
                      Más caros
                    </option>

                    <option value="price-asc">
                      Más baratos
                    </option>
                  </select>

                  {/* Filtros */}
                  <button
                    type="button"
                    onClick={() =>
                      setIsFilterOpen(true)
                    }
                    className="relative h-10 rounded-md border px-4 text-sm font-medium transition hover:bg-muted"
                  >
                    Filtrar

                    {activeFilterCount >
                      0 && (
                      <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                </div>

                {/* Resultado */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {processedGenerations.length}{' '}
                    {processedGenerations.length ===
                    1
                      ? 'anuncio encontrado'
                      : 'anuncios encontrados'}
                  </p>

                  {(searchTerm ||
                    activeFilterCount >
                      0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm('')
                        clearFilters()
                      }}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Limpiar búsqueda y filtros
                    </button>
                  )}
                </div>
              </div>

              {/* =================================================
                  BARRA DE SELECCIÓN
                  ================================================= */}

              <div className="mt-5 flex flex-col justify-between gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
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
                    Seleccionar todos los de
                    esta página
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {selectedCount}{' '}
                    {selectedCount === 1
                      ? 'anuncio seleccionado'
                      : 'anuncios seleccionados'}
                  </span>

                  <button
                    type="button"
                    onClick={
                      handleDeleteSelected
                    }
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
                    className={`rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 ${
                      selectedCount > 0
                        ? 'visible'
                        : 'pointer-events-none invisible'
                    }`}
                  >
                    {deleting
                      ? 'Eliminando...'
                      : `Eliminar seleccionados (${selectedCount})`}
                  </button>
                </div>
              </div>

              {/* =================================================
                  LISTA DE ANUNCIOS
                  ================================================= */}

              {currentGenerations.length ===
              0 ? (
                <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
                  <h2 className="font-semibold">
                    No hay anuncios que coincidan
                  </h2>

                  <p className="mt-2 text-sm text-muted-foreground">
                    Prueba a modificar la
                    búsqueda o los filtros.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('')
                      clearFilters()
                    }}
                    className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    Limpiar filtros
                  </button>
                </div>
              ) : (
                <div className="mt-8 space-y-4">
                  {currentGenerations.map(
                    (generation) => {

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
                              checked={
                                isSelected
                              }
                              onChange={() =>
                                handleToggleGeneration(
                                  generation.id,
                                )
                              }
                              disabled={
                                deleting
                              }
                              className={`block h-8 w-full appearance-none border-0 cursor-pointer focus:outline-none transition-colors ${
                                isSelected
                                  ? 'bg-foreground cursor-default'
                                  : 'bg-accent group-hover:bg-primary'
                              }`}
                            />

                            <div
                              className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium transition-colors ${
                                isSelected
                                  ? 'text-background font-semibold'
                                  : 'text-muted-foreground group-hover:text-primary-foreground group-hover:font-semibold'
                              }`}
                            >
                              {isSelected
                                ? '✓ Seleccionado'
                                : 'Seleccionar'}
                            </div>
                          </div>

                          {/* Bloque central */}
                          <div className="p-5">
                            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                              <div className="min-w-0 flex-1">
                                <h2 className="text-lg font-semibold">
                                  {
                                    generation.title
                                  }
                                </h2>

                                <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                                  {
                                    generation.description
                                  }
                                </p>
                              </div>

                              <div className="flex shrink-0 flex-wrap gap-2">
                                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                                  {
                                    generation.provider
                                  }
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

                            {/* Inmueble */}
                            <div className="mt-5">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Inmueble
                              </p>

                              <p className="mt-1 text-sm font-medium">
                                {generation
                                  .property
                                  ?.title ||
                                  'Sin título'}

                                {generation
                                  .property
                                  ?.city
                                  ? ` · ${generation.property.city}`
                                  : ' · Sin ciudad'}

                                {generation
                                  .property
                                  ?.neighborhood
                                  ? ` · ${generation.property.neighborhood}`
                                  : ''}
                              </p>

                              <div className="mt-3 flex flex-wrap gap-2">
                                {generation
                                  .property
                                  ?.operation && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs">
                                    {getOperationLabel(
                                      generation
                                        .property
                                        .operation,
                                    )}
                                  </span>
                                )}

                                {generation
                                  .property
                                  ?.type && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs">
                                    {getPropertyTypeLabel(
                                      generation
                                        .property
                                        .type,
                                    )}
                                  </span>
                                )}

                                {generation
                                  .property
                                  ?.price !==
                                  undefined && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs">
                                    {generation.property.price.toLocaleString(
                                      'es-ES',
                                    )}{' '}
                                    €
                                  </span>
                                )}

                                {generation
                                  .property
                                  ?.area !==
                                  undefined && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs">
                                    {
                                      generation
                                        .property
                                        .area
                                    }{' '}
                                    m²
                                  </span>
                                )}

                                {generation
                                  .property
                                  ?.bedrooms !==
                                  undefined && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs">
                                    {
                                      generation
                                        .property
                                        .bedrooms
                                    }{' '}
                                    {generation
                                      .property
                                      .bedrooms ===
                                    1
                                      ? 'habitación'
                                      : 'habitaciones'}
                                  </span>
                                )}

                                {generation
                                  .property
                                  ?.bathrooms !==
                                  undefined && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs">
                                    {
                                      generation
                                        .property
                                        .bathrooms
                                    }{' '}
                                    {generation
                                      .property
                                      .bathrooms ===
                                    1
                                      ? 'baño'
                                      : 'baños'}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* CTA */}
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

                          {/* Ver anuncio */}
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
              )}

              {/* =================================================
                  PAGINACIÓN
                  ================================================= */}

              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between border-t pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        currentPage > 1
                      ) {
                        setCurrentPage(
                          (previousPage) =>
                            previousPage -
                            1,
                        )
                      }
                    }}
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
                    onClick={() => {
                      if (
                        currentPage <
                        totalPages
                      ) {
                        setCurrentPage(
                          (previousPage) =>
                            previousPage +
                            1,
                        )
                      }
                    }}
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
      </div>

      {/* =====================================================
          PANEL DE FILTROS SUPERPUESTO
          ===================================================== */}

      {isFilterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-filter-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-card shadow-2xl"
          >
            {/* Cabecera */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
              <div>
                <h2
                  id="history-filter-title"
                  className="text-lg font-semibold"
                >
                  Filtrar anuncios
                </h2>

                <p className="mt-1 text-xs text-muted-foreground">
                  Puedes combinar varios filtros.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setIsFilterOpen(false)
                }
                className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-6 p-5">
              {/* Operación + tipo */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="filter-operation"
                    className="mb-2 block text-sm font-medium"
                  >
                    Operación
                  </label>

                  <select
                    id="filter-operation"
                    value={filterOperation}
                    onChange={(event) =>
                      setFilterOperation(
                        event.target.value,
                      )
                    }
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">
                      Cualquier operación
                    </option>

                    {operationOptions.map(
                      (operation) => (
                        <option
                          key={operation}
                          value={operation}
                        >
                          {getOperationLabel(
                            operation,
                          )}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="filter-property-type"
                    className="mb-2 block text-sm font-medium"
                  >
                    Tipo de inmueble
                  </label>

                  <select
                    id="filter-property-type"
                    value={
                      filterPropertyType
                    }
                    onChange={(event) =>
                      setFilterPropertyType(
                        event.target.value,
                      )
                    }
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">
                      Cualquier tipo
                    </option>

                    {propertyTypeOptions.map(
                      (type) => (
                        <option
                          key={type}
                          value={type}
                        >
                          {getPropertyTypeLabel(
                            type,
                          )}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>

              {/* Ciudad + proveedor */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="filter-city"
                    className="mb-2 block text-sm font-medium"
                  >
                    Ciudad
                  </label>

                  <input
                    id="filter-city"
                    type="text"
                    value={filterCity}
                    onChange={(event) =>
                      setFilterCity(
                        event.target.value,
                      )
                    }
                    placeholder="Ej. Madrid"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="filter-provider"
                    className="mb-2 block text-sm font-medium"
                  >
                    Proveedor
                  </label>

                  <select
                    id="filter-provider"
                    value={filterProvider}
                    onChange={(event) =>
                      setFilterProvider(
                        event.target.value,
                      )
                    }
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">
                      Cualquier proveedor
                    </option>

                    {providerOptions.map(
                      (provider) => (
                        <option
                          key={provider}
                          value={provider}
                        >
                          {provider}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>

              {/* Tono + idioma */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="filter-tone"
                    className="mb-2 block text-sm font-medium"
                  >
                    Tono
                  </label>

                  <select
                    id="filter-tone"
                    value={filterTone}
                    onChange={(event) =>
                      setFilterTone(
                        event.target.value,
                      )
                    }
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">
                      Cualquier tono
                    </option>

                    {toneOptions.map(
                      (tone) => (
                        <option
                          key={tone}
                          value={tone}
                        >
                          {getToneLabel(tone)}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="filter-language"
                    className="mb-2 block text-sm font-medium"
                  >
                    Idioma
                  </label>

                  <select
                    id="filter-language"
                    value={filterLanguage}
                    onChange={(event) =>
                      setFilterLanguage(
                        event.target.value,
                      )
                    }
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">
                      Cualquier idioma
                    </option>

                    {languageOptions.map(
                      (language) => (
                        <option
                          key={language}
                          value={language}
                        >
                          {getLanguageLabel(
                            language,
                          )}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>

              {/* Precio */}
              <div>
                <p className="mb-2 text-sm font-medium">
                  Precio (€)
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="number"
                    min="0"
                    value={filterPrice.min}
                    onChange={(event) =>
                      setFilterPrice(
                        (previous) => ({
                          ...previous,
                          min: event.target.value,
                        }),
                      )
                    }
                    placeholder="Precio mínimo"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                  />

                  <input
                    type="number"
                    min="0"
                    value={filterPrice.max}
                    onChange={(event) =>
                      setFilterPrice(
                        (previous) => ({
                          ...previous,
                          max: event.target.value,
                        }),
                      )
                    }
                    placeholder="Precio máximo"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                  />
                </div>
              </div>

              {/* Superficie */}
              <div>
                <p className="mb-2 text-sm font-medium">
                  Superficie (m²)
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="number"
                    min="0"
                    value={filterArea.min}
                    onChange={(event) =>
                      setFilterArea(
                        (previous) => ({
                          ...previous,
                          min: event.target.value,
                        }),
                      )
                    }
                    placeholder="Mínimo de m²"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                  />

                  <input
                    type="number"
                    min="0"
                    value={filterArea.max}
                    onChange={(event) =>
                      setFilterArea(
                        (previous) => ({
                          ...previous,
                          max: event.target.value,
                        }),
                      )
                    }
                    placeholder="Máximo de m²"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                  />
                </div>
              </div>

              {/* Habitaciones */}
              <div>
                <p className="mb-2 text-sm font-medium">
                  Habitaciones
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={
                      filterBedrooms.min
                    }
                    onChange={(event) =>
                      setFilterBedrooms(
                        (previous) => ({
                          ...previous,
                          min: event.target.value,
                        }),
                      )
                    }
                    placeholder="Mínimo"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                  />

                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={
                      filterBedrooms.max
                    }
                    onChange={(event) =>
                      setFilterBedrooms(
                        (previous) => ({
                          ...previous,
                          max: event.target.value,
                        }),
                      )
                    }
                    placeholder="Máximo"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                  />
                </div>
              </div>

              {/* Baños */}
              <div>
                <p className="mb-2 text-sm font-medium">
                  Baños
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={
                      filterBathrooms.min
                    }
                    onChange={(event) =>
                      setFilterBathrooms(
                        (previous) => ({
                          ...previous,
                          min: event.target.value,
                        }),
                      )
                    }
                    placeholder="Mínimo"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                  />

                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={
                      filterBathrooms.max
                    }
                    onChange={(event) =>
                      setFilterBathrooms(
                        (previous) => ({
                          ...previous,
                          max: event.target.value,
                        }),
                      )
                    }
                    placeholder="Máximo"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Pie */}
            <div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t bg-card p-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Limpiar filtros
              </button>

              <button
                type="button"
                onClick={() =>
                  setIsFilterOpen(false)
                }
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Mostrar resultados
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default HistoryPage