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

import {
  buildPropertyHighlights,
} from '@/utils/propertyHighlights'

// ============================================================
// DICCIONARIOS
// ============================================================

const toneLabels: Record<string, string> = {
  professional: 'Profesional',
  luxurious: 'De lujo',
  casual: 'Casual',
  persuasive: 'Persuasivo',
}

const operationLabels: Record<string, string> = {
  sale: 'Venta',
  rent: 'Alquiler',
  transfer: 'Traspaso',
}

const propertyTypeLabels: Record<string, string> = {
  apartment: 'Apartamento',
  house: 'Casa',
  villa: 'Chalet',
  penthouse: 'Ático',
  duplex: 'Dúplex',
  studio: 'Estudio',
  commercial: 'Local comercial',
  office: 'Oficina',
  land: 'Terreno',
}

const featureLabels: Record<
  BooleanFilterField,
  string
> = {
  pool: 'Piscina',
  garden: 'Jardín',
  terrace: 'Terraza',
  balcony: 'Balcón',
  garage: 'Garaje',
  storageRoom: 'Trastero',
  elevator: 'Ascensor',
  airConditioning:
    'Aire acondicionado',
  heating: 'Calefacción',
}

// ============================================================
// TIPOS
// ============================================================

type SortOption =
  | 'newest'
  | 'oldest'
  | 'price-desc'
  | 'price-asc'

type NumericOperator =
  | 'lt'
  | 'lte'
  | 'eq'
  | 'gte'
  | 'gt'
  | 'range'

type NumberFilter = {
  operator: NumericOperator
  value: string
  min: string
  max: string
}

type BooleanFilterField =
  | 'pool'
  | 'garden'
  | 'terrace'
  | 'balcony'
  | 'garage'
  | 'storageRoom'
  | 'elevator'
  | 'airConditioning'
  | 'heating'

// ============================================================
// ETIQUETAS
// ============================================================

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

  const normalized =
    language.toLowerCase()

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
    operationLabels[
    operation.toLowerCase()
    ] || operation
  )
}

function getPropertyTypeLabel(
  type: string | undefined,
): string {
  if (!type) return 'No indicado'

  return (
    propertyTypeLabels[
    type.toLowerCase()
    ] || type
  )
}

// ============================================================
// HIGHLIGHTS
// ============================================================

function deduplicateHighlights(
  highlights: string[],
): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  highlights.forEach((highlight) => {
    const normalized =
      highlight.trim().toLowerCase()

    if (!normalized) {
      return
    }

    if (seen.has(normalized)) {
      return
    }

    seen.add(normalized)
    unique.push(highlight.trim())
  })

  return unique
}

// ============================================================
// FILTROS NUMÉRICOS
// ============================================================

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
  const numericValue =
    getNumberValue(value)

  if (numericValue === null) {
    return (
      !hasNumericFilter(filter)
    )
  }

  if (filter.operator === 'range') {
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

  if (filter.value.trim() === '') {
    return true
  }

  const filterValue =
    Number(
      filter.value.replace(',', '.'),
    )

  if (!Number.isFinite(filterValue)) {
    return true
  }

  switch (filter.operator) {
    case 'lt':
      return numericValue < filterValue

    case 'lte':
      return numericValue <= filterValue

    case 'eq':
      return numericValue === filterValue

    case 'gte':
      return numericValue >= filterValue

    case 'gt':
      return numericValue > filterValue

    default:
      return true
  }
}

function hasNumericFilter(
  filter: NumberFilter,
): boolean {
  if (filter.operator === 'range') {
    return (
      filter.min.trim() !== '' ||
      filter.max.trim() !== ''
    )
  }

  return filter.value.trim() !== ''
}

function getOperatorLabel(
  operator: NumericOperator,
): string {
  switch (operator) {
    case 'lt':
      return 'Menor que'

    case 'lte':
      return 'Menor o igual que'

    case 'eq':
      return 'Igual a'

    case 'gte':
      return 'Mayor o igual que'

    case 'gt':
      return 'Mayor que'

    case 'range':
      return 'Entre'

    default:
      return 'Menor o igual que'
  }
}

function emptyNumberFilter(): NumberFilter {
  return {
    operator: 'lte',
    value: '',
    min: '',
    max: '',
  }
}

// ============================================================
// COMPONENTE
// ============================================================

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

  const itemsPerPage = 4

  // ==========================================================
  // BÚSQUEDA / ORDENACIÓN
  // ==========================================================

  const [searchTerm, setSearchTerm] =
    useState('')

  const [sortOption, setSortOption] =
    useState<SortOption>('newest')

  const [isSortMenuOpen, setIsSortMenuOpen] =
    useState(false)

  const [isFilterOpen, setIsFilterOpen] =
    useState(false)

  // ==========================================================
  // FILTROS
  // ==========================================================

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
    useState<NumberFilter>(
      emptyNumberFilter(),
    )

  const [filterArea, setFilterArea] =
    useState<NumberFilter>(
      emptyNumberFilter(),
    )

  const [filterBedrooms, setFilterBedrooms] =
    useState<NumberFilter>(
      emptyNumberFilter(),
    )

  const [filterBathrooms, setFilterBathrooms] =
    useState<NumberFilter>(
      emptyNumberFilter(),
    )

  const [filterFeatures, setFilterFeatures] =
    useState<
      Record<
        BooleanFilterField,
        boolean
      >
    >({
      pool: false,
      garden: false,
      terrace: false,
      balcony: false,
      garage: false,
      storageRoom: false,
      elevator: false,
      airConditioning: false,
      heating: false,
    })

  // ==========================================================
  // CARGA
  // ==========================================================

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

  // ==========================================================
  // RESULTADOS
  // ==========================================================

  const processedGenerations =
    useMemo(() => {
      const normalizedSearch =
        searchTerm
          .trim()
          .toLowerCase()

      const filtered =
        generations.filter(
          (generation) => {
            // Búsqueda
            if (
              normalizedSearch &&
              !generation.title
                .toLowerCase()
                .includes(
                  normalizedSearch,
                )
            ) {
              return false
            }

            const property =
              generation.property

            // Operación
            if (
              filterOperation &&
              property?.operation
                ?.toLowerCase() !==
              filterOperation.toLowerCase()
            ) {
              return false
            }

            // Tipo
            if (
              filterPropertyType &&
              property?.type
                ?.toLowerCase() !==
              filterPropertyType.toLowerCase()
            ) {
              return false
            }

            // Ciudad
            if (
              filterCity &&
              !property?.city
                ?.toLowerCase()
                .includes(
                  filterCity
                    .trim()
                    .toLowerCase(),
                )
            ) {
              return false
            }

            // Proveedor
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

            // Tono
            if (
              filterTone &&
              generation.tone
                ?.toLowerCase() !==
              filterTone.toLowerCase()
            ) {
              return false
            }

            // Idioma
            if (
              filterLanguage &&
              generation.language
                ?.toLowerCase() !==
              filterLanguage.toLowerCase()
            ) {
              return false
            }

            // Precio
            if (
              !matchesNumberFilter(
                property?.price,
                filterPrice,
              )
            ) {
              return false
            }

            // Superficie
            if (
              !matchesNumberFilter(
                property?.area,
                filterArea,
              )
            ) {
              return false
            }

            // Habitaciones
            if (
              !matchesNumberFilter(
                property?.bedrooms,
                filterBedrooms,
              )
            ) {
              return false
            }

            // Baños
            if (
              !matchesNumberFilter(
                property?.bathrooms,
                filterBathrooms,
              )
            ) {
              return false
            }

            // Características
            const featureFields: BooleanFilterField[] =
              [
                'pool',
                'garden',
                'terrace',
                'balcony',
                'garage',
                'storageRoom',
                'elevator',
                'airConditioning',
                'heating',
              ]

            for (
              const field of featureFields
            ) {
              if (
                filterFeatures[field] &&
                !property?.[field]
              ) {
                return false
              }
            }

            return true
          },
        )

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

            return sortOption ===
              'newest'
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
      filterFeatures,
    ])

  // ==========================================================
  // PAGINACIÓN
  // ==========================================================

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
    filterFeatures,
  ])

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

  // ==========================================================
  // SELECCIÓN
  // ==========================================================

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

      if (
        next.has(generationId)
      ) {
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
        currentPageIds.forEach((id) =>
          next.delete(id),
        )
      } else {
        currentPageIds.forEach((id) =>
          next.add(id),
        )
      }

      return next
    })

    setDeleteError(null)
  }

  // ==========================================================
  // BORRADO
  // ==========================================================

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
          `¿Seguro que quieres eliminar ${count} ${count === 1
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

  // ==========================================================
  // FILTROS
  // ==========================================================

  const clearFilters = () => {
    setFilterOperation('')
    setFilterPropertyType('')
    setFilterCity('')
    setFilterProvider('')
    setFilterTone('')
    setFilterLanguage('')

    setFilterPrice(
      emptyNumberFilter(),
    )

    setFilterArea(
      emptyNumberFilter(),
    )

    setFilterBedrooms(
      emptyNumberFilter(),
    )

    setFilterBathrooms(
      emptyNumberFilter(),
    )

    setFilterFeatures({
      pool: false,
      garden: false,
      terrace: false,
      balcony: false,
      garage: false,
      storageRoom: false,
      elevator: false,
      airConditioning: false,
      heating: false,
    })
  }

  const updateNumberFilter = (
    setter: React.Dispatch<
      React.SetStateAction<NumberFilter>
    >,
    field:
      | 'operator'
      | 'value'
      | 'min'
      | 'max',
    value: string,
  ) => {
    setter((previous) => ({
      ...previous,
      [field]: value,
    }))
  }

  const toggleFeatureFilter = (
    field: BooleanFilterField,
  ) => {
    setFilterFeatures((previous) => ({
      ...previous,
      [field]: !previous[field],
    }))
  }

  const activeFilterCount =
    [
      filterOperation,
      filterPropertyType,
      filterCity,
      filterProvider,
      filterTone,
      filterLanguage,

      hasNumericFilter(filterPrice)
        ? 'price'
        : '',

      hasNumericFilter(filterArea)
        ? 'area'
        : '',

      hasNumericFilter(
        filterBedrooms,
      )
        ? 'bedrooms'
        : '',

      hasNumericFilter(
        filterBathrooms,
      )
        ? 'bathrooms'
        : '',

      ...Object.values(
        filterFeatures,
      ).map((active) =>
        active ? 'feature' : '',
      ),
    ].filter(Boolean).length

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

  // ==========================================================
  // COMPONENTE FILTRO NUMÉRICO
  // ==========================================================

  const renderNumericFilter = (
    label: string,
    filter: NumberFilter,
    setter: React.Dispatch<
      React.SetStateAction<NumberFilter>
    >,
    unit?: string,
    step = '1',
  ) => {
    const isRange =
      filter.operator === 'range'

    return (
      <div>
        <p className="mb-2 text-sm font-medium">
          {label}
        </p>

        <select
          value={filter.operator}
          onChange={(event) =>
            updateNumberFilter(
              setter,
              'operator',
              event.target.value,
            )
          }
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="lt">
            Menor que
          </option>

          <option value="lte">
            Menor o igual
          </option>

          <option value="eq">
            Igual a
          </option>

          <option value="gte">
            Mayor o igual
          </option>

          <option value="gt">
            Mayor que
          </option>

          <option value="range">
            Entre / rango
          </option>
        </select>

        {isRange ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <input
              type="number"
              min="0"
              step={step}
              value={filter.min}
              onChange={(event) =>
                updateNumberFilter(
                  setter,
                  'min',
                  event.target.value,
                )
              }
              placeholder={`Mínimo${unit ? ` (${unit})` : ''
                }`}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            />

            <input
              type="number"
              min="0"
              step={step}
              value={filter.max}
              onChange={(event) =>
                updateNumberFilter(
                  setter,
                  'max',
                  event.target.value,
                )
              }
              placeholder={`Máximo${unit ? ` (${unit})` : ''
                }`}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            />
          </div>
        ) : (
          <input
            type="number"
            min="0"
            step={step}
            value={filter.value}
            onChange={(event) =>
              updateNumberFilter(
                setter,
                'value',
                event.target.value,
              )
            }
            placeholder={`Valor${unit ? ` (${unit})` : ''
              }`}
            className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
        )}
      </div>
    )
  }

  // ==========================================================
  // ESTADOS DE CARGA / ERROR
  // ==========================================================

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

  // ==========================================================
  // RENDER
  // ==========================================================

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
          {/* CABECERA */}

          <div>
            <h1 className="text-3xl font-bold">
              Anuncios
            </h1>

            <p className="mt-2 text-muted-foreground">
              Consulta los anuncios.
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
              {/* BÚSQUEDA / ORDENAR / FILTRAR */}

              <div className="mt-8 rounded-lg border bg-card p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
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

                  <div className="flex flex-wrap items-center gap-2">
                    {/* ORDENAR */}

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setIsSortMenuOpen(
                            (current) =>
                              !current,
                          )
                        }
                        aria-expanded={
                          isSortMenuOpen
                        }
                        className="inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-medium transition hover:bg-muted"
                      >
                        Ordenar

                        <span className="text-muted-foreground">
                          ·
                        </span>

                        <span>
                          {sortOption ===
                            'newest'
                            ? 'Más nuevos'
                            : sortOption ===
                              'oldest'
                              ? 'Más antiguos'
                              : sortOption ===
                                'price-desc'
                                ? 'Más caros'
                                : 'Más baratos'}
                        </span>

                        <span className="text-xs">
                          ↓
                        </span>
                      </button>

                      {isSortMenuOpen && (
                        <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-md border bg-card p-1 shadow-lg">
                          {(
                            [
                              [
                                'newest',
                                'Más nuevos',
                              ],
                              [
                                'oldest',
                                'Más antiguos',
                              ],
                              [
                                'price-desc',
                                'Más caros',
                              ],
                              [
                                'price-asc',
                                'Más baratos',
                              ],
                            ] as [
                              SortOption,
                              string,
                            ][]
                          ).map(
                            ([
                              value,
                              label,
                            ]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => {
                                  setSortOption(
                                    value,
                                  )

                                  setIsSortMenuOpen(
                                    false,
                                  )
                                }}
                                className={`block w-full rounded px-3 py-2 text-left text-sm transition hover:bg-muted ${sortOption ===
                                  value
                                  ? 'bg-muted font-medium'
                                  : ''
                                  }`}
                              >
                                {label}
                              </button>
                            ),
                          )}
                        </div>
                      )}
                    </div>

                    {/* FILTRAR */}

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
                            {
                              activeFilterCount
                            }
                          </span>
                        )}
                    </button>
                  </div>
                </div>

                {(searchTerm ||
                  activeFilterCount >
                  0) && (
                    <div className="mt-3 border-t pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSearchTerm('')
                          clearFilters()
                        }}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Limpiar búsqueda y
                        filtros
                      </button>
                    </div>
                  )}
              </div>

              {/* RESULTADOS */}

              <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-medium text-foreground">
                    {
                      processedGenerations.length
                    }{' '}
                  </span>

                  {processedGenerations.length ===
                    1
                    ? 'anuncio encontrado'
                    : 'anuncios encontrados'}
                </span>
              </div>

              {/* SELECCIÓN */}

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
                    className={`rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 ${selectedCount > 0
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

              {/* RESULTADOS */}

              {currentGenerations.length ===
                0 ? (
                <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
                  <h2 className="font-semibold">
                    No hay anuncios que
                    coincidan
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
                <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {currentGenerations.map(
                    (generation) => {
                      const isSelected =
                        selectedIds.has(
                          generation.id,
                        )

                      const shortHighlights =
                        generation.property
                          ? deduplicateHighlights(
                            buildPropertyHighlights(
                              generation.property,
                            ).filter(
                              (
                                highlight,
                              ) => {
                                const normalized =
                                  highlight
                                    .trim()
                                    .toLowerCase()

                                if (
                                  normalized ===
                                  `${generation.property.area} m²`.toLowerCase()
                                ) {
                                  return false
                                }

                                if (
                                  normalized ===
                                  `${generation.property.bedrooms} ${generation
                                    .property
                                    .bedrooms ===
                                    1
                                    ? 'habitación'
                                    : 'habitaciones'
                                    }`.toLowerCase()
                                ) {
                                  return false
                                }

                                if (
                                  normalized ===
                                  `${generation.property.bathrooms} ${generation
                                    .property
                                    .bathrooms ===
                                    1
                                    ? 'baño'
                                    : 'baños'
                                    }`.toLowerCase()
                                ) {
                                  return false
                                }

                                return true
                              },
                            ),
                          )
                          : []

                      return (
                        <div
                          key={
                            generation.id
                          }
                          className={`relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card transition ${isSelected
                            ? 'border-primary ring-2 ring-primary/25'
                            : 'border-border'
                            }`}
                        >
                          {/* SELECTOR */}

                          <div className="relative w-full overflow-hidden border-b border-border">
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
                              className={`peer block h-11 w-full cursor-pointer appearance-none border-0 bg-muted/40 text-xs font-semibold transition-colors hover:bg-primary hover:text-primary-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${isSelected
                                ? 'cursor-default bg-primary text-primary-foreground'
                                : 'bg-muted/40 text-muted-foreground'
                                }`}
                            />

                            <div
                              className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-semibold transition-colors ${isSelected
                                ? 'text-primary-foreground'
                                : 'text-muted-foreground'
                                } peer-hover:text-primary-foreground`}
                            >
                              {isSelected
                                ? '✓ Seleccionado'
                                : 'Seleccionar'}
                            </div>
                          </div>

                          {/* CONTENIDO */}

                          <div className="flex-1 p-5">
                            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                              <div className="min-w-0 flex-1">
                                <h2 className="text-lg font-semibold">
                                  {
                                    generation.title
                                  }
                                </h2>

                                <p className="mt-2 line-clamp-4 text-sm leading-6 text-muted-foreground text-justify">
                                  {
                                    generation.description
                                  }
                                </p>
                              </div>

                              <div className="flex shrink-0 flex-wrap gap-2">
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  {generation.provider
                                    ? generation.provider
                                      .charAt(
                                        0,
                                      )
                                      .toUpperCase() +
                                    generation.provider.slice(
                                      1,
                                    )
                                    : ''}
                                </span>

                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  {getToneLabel(
                                    generation.tone,
                                  )}
                                </span>

                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  {getLanguageLabel(
                                    generation.language,
                                  )}
                                </span>
                              </div>
                            </div>

                            {/* INMUEBLE */}

                            <div className="mt-5">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Inmueble asociado
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
                                    <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
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
                                    <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
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
                                    <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
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
                                    <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
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
                                    <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
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
                                    <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
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

                                {/* CARACTERÍSTICAS */}
                                {shortHighlights.length >
                                  0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {shortHighlights
                                        .slice(
                                          0,
                                          6,
                                        )
                                        .map(
                                          (
                                            highlight,
                                          ) => (
                                            <span
                                              key={
                                                highlight
                                              }
                                              className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                                            >
                                              {
                                                highlight
                                              }
                                            </span>
                                          ),
                                        )}
                                    </div>
                                  )}
                              </div>
                            </div>

                            {/* CTA */}

                            {generation.callToAction && (
                              <div className="mt-5">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Llamada a la
                                  acción
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

                          {/* VER ANUNCIO */}

                          <Link
                            to={`/historial/${generation.id}`}
                            aria-label="Ver anuncio"
                            className="mt-auto flex h-11 w-full items-center justify-center border-t bg-card text-xs font-semibold text-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            Ver anuncio
                          </Link>
                        </div>
                      )
                    },
                  )}
                </div>
              )}

              {/* PAGINACIÓN */}

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
                            previousPage - 1,
                        )
                      }
                    }}
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
                    className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ======================================================
          PANEL DE FILTROS
          ====================================================== */}

      {isFilterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-filter-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-card shadow-2xl"
          >
            {/* CABECERA */}

            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
              <div>
                <h2
                  id="history-filter-title"
                  className="text-lg font-semibold"
                >
                  Filtrar anuncios
                </h2>

                <p className="mt-1 text-xs text-muted-foreground">
                  Puedes combinar varios
                  filtros.
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
              {/* NUMÉRICOS */}

              <div className="grid gap-5 sm:grid-cols-2">
                {renderNumericFilter(
                  'Precio (€)',
                  filterPrice,
                  setFilterPrice,
                  '€',
                )}

                {renderNumericFilter(
                  'Superficie (m²)',
                  filterArea,
                  setFilterArea,
                  'm²',
                )}

                {renderNumericFilter(
                  'Habitaciones',
                  filterBedrooms,
                  setFilterBedrooms,
                  undefined,
                  '1',
                )}

                {renderNumericFilter(
                  'Baños',
                  filterBathrooms,
                  setFilterBathrooms,
                  undefined,
                  '1',
                )}
              </div>

              {/* OPERACIÓN + TIPO */}

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
                    value={
                      filterOperation
                    }
                    onChange={(event) =>
                      setFilterOperation(
                        event.target
                          .value,
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
                        event.target
                          .value,
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

              {/* CIUDAD + PROVEEDOR */}

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
                        event.target
                          .value,
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
                    value={
                      filterProvider
                    }
                    onChange={(event) =>
                      setFilterProvider(
                        event.target
                          .value,
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

              {/* TONO + IDIOMA */}

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
                        event.target
                          .value,
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
                          {getToneLabel(
                            tone,
                          )}
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
                    value={
                      filterLanguage
                    }
                    onChange={(event) =>
                      setFilterLanguage(
                        event.target
                          .value,
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

              {/* CARACTERÍSTICAS */}

              <div className="border-t pt-6">
                <h3 className="text-sm font-semibold">
                  Características
                </h3>

                <p className="mt-1 text-xs text-muted-foreground">
                  Se mostrarán únicamente anuncios
                  cuyo inmueble tenga las
                  características seleccionadas.
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {(
                    Object.entries(
                      featureLabels,
                    ) as [
                      BooleanFilterField,
                      string,
                    ][]
                  ).map(
                    ([
                      field,
                      label,
                    ]) => (
                      <label
                        key={field}
                        className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={
                            filterFeatures[
                            field
                            ]
                          }
                          onChange={() =>
                            toggleFeatureFilter(
                              field,
                            )
                          }
                          className="h-4 w-4 cursor-pointer"
                        />

                        <span>
                          {label}
                        </span>
                      </label>
                    ),
                  )}
                </div>
              </div>

              {/* RESUMEN DE FILTROS */}

              {activeFilterCount > 0 && (
                <div className="rounded-md bg-muted/50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Filtros activos
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {hasNumericFilter(
                      filterPrice,
                    ) && (
                        <span className="rounded-md bg-background px-2 py-1 text-xs">
                          Precio{' '}
                          {filterPrice.operator ===
                            'range'
                            ? `entre ${filterPrice
                              .min ||
                            '—'
                            } y ${filterPrice
                              .max ||
                            '—'
                            } €`
                            : `${getOperatorLabel(
                              filterPrice
                                .operator,
                            )} ${filterPrice
                              .value
                            } €`}
                        </span>
                      )}

                    {hasNumericFilter(
                      filterArea,
                    ) && (
                        <span className="rounded-md bg-background px-2 py-1 text-xs">
                          Superficie{' '}
                          {filterArea.operator ===
                            'range'
                            ? `entre ${filterArea.min ||
                            '—'
                            } y ${filterArea.max ||
                            '—'
                            } m²`
                            : `${getOperatorLabel(
                              filterArea
                                .operator,
                            )} ${filterArea.value
                            } m²`}
                        </span>
                      )}

                    {hasNumericFilter(
                      filterBedrooms,
                    ) && (
                        <span className="rounded-md bg-background px-2 py-1 text-xs">
                          Habitaciones{' '}
                          {filterBedrooms.operator ===
                            'range'
                            ? `entre ${filterBedrooms
                              .min ||
                            '—'
                            } y ${filterBedrooms
                              .max ||
                            '—'
                            }`
                            : `${getOperatorLabel(
                              filterBedrooms
                                .operator,
                            )} ${filterBedrooms
                              .value
                            }`}
                        </span>
                      )}

                    {hasNumericFilter(
                      filterBathrooms,
                    ) && (
                        <span className="rounded-md bg-background px-2 py-1 text-xs">
                          Baños{' '}
                          {filterBathrooms.operator ===
                            'range'
                            ? `entre ${filterBathrooms
                              .min ||
                            '—'
                            } y ${filterBathrooms
                              .max ||
                            '—'
                            }`
                            : `${getOperatorLabel(
                              filterBathrooms
                                .operator,
                            )} ${filterBathrooms
                              .value
                            }`}
                        </span>
                      )}

                    {(
                      Object.entries(
                        filterFeatures,
                      ) as [
                        BooleanFilterField,
                        boolean,
                      ][]
                    )
                      .filter(
                        ([
                          ,
                          active,
                        ]) => active,
                      )
                      .map(
                        ([
                          field,
                        ]) => (
                          <span
                            key={field}
                            className="rounded-md bg-background px-2 py-1 text-xs"
                          >
                            {
                              featureLabels[
                              field
                              ]
                            }
                          </span>
                        ),
                      )}
                  </div>
                </div>
              )}
            </div>

            {/* PIE */}

            <div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t bg-card p-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={
                  clearFilters
                }
                disabled={
                  activeFilterCount ===
                  0
                }
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
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