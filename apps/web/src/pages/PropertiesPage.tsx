import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { buildPropertyHighlights } from "@/utils/propertyHighlights";

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

// Diccionario de traducción para el estado
const propertyConditionLabels: Record<string, string> = {
  new: 'Obra nueva',
  good: 'Buen estado',
  renovated: 'Reformado',
  'needs-renovation': 'Necesita reforma',
  'to-renovate': 'Necesita reforma',
}

type SortOption =
  | 'newest'
  | 'oldest'
  | 'most-expensive'
  | 'cheapest'

type NumericOperator =
  | 'lt'
  | 'lte'
  | 'eq'
  | 'gte'
  | 'gt'

type NumericFilter = {
  operator: NumericOperator
  value: string
}

type PropertyFilters = {
  price: NumericFilter
  area: NumericFilter
  bedrooms: NumericFilter
  bathrooms: NumericFilter
  operation: string
  type: string
  condition: string
  pool: boolean
  garden: boolean
  terrace: boolean
  balcony: boolean
  garage: boolean
  elevator: boolean
  airConditioning: boolean
  heating: boolean
}

const emptyNumericFilter = (): NumericFilter => ({
  operator: 'lte',
  value: '',
})

const createDefaultFilters = (): PropertyFilters => ({
  price: emptyNumericFilter(),
  area: emptyNumericFilter(),
  bedrooms: emptyNumericFilter(),
  bathrooms: emptyNumericFilter(),
  operation: '',
  type: '',
  condition: '',
  pool: false,
  garden: false,
  terrace: false,
  balcony: false,
  garage: false,
  elevator: false,
  airConditioning: false,
  heating: false,
})

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

  const normalizedCondition = condition
    .toLowerCase()
    .replace(/_/g, '-')

  return (
    propertyConditionLabels[normalizedCondition] ||
    condition
  )
}

function capitalizeFirstLetter(
  text: string | undefined,
): string {
  if (!text) return ''

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
  )
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

function getPropertyHighlights(property: PropertyItem): string[] {
  const highlights: string[] = []

  for (const generation of property.generations) {
    const currentGenerationHighlights: string[] = []

    // 1. Obtenemos los highlights estructurados (si existen)
    const structured = buildPropertyHighlights(generation)
    if (structured && structured.length > 0) {
      currentGenerationHighlights.push(...structured)
    }

    // 2. Obtenemos también los highlights del texto plano o JSON de la generación
    let rawHighlights: string[] = []
    if (typeof generation.highlights === "string") {
      try {
        rawHighlights = JSON.parse(generation.highlights)
      } catch (e) {
        rawHighlights = [generation.highlights]
      }
    } else if (Array.isArray(generation.highlights)) {
      rawHighlights = generation.highlights
    }

    // 3. Extraemos datos clave del texto por si faltaban en los estructurados
    const extractedFromText = rawHighlights.flatMap(item => {
      if (typeof item !== "string") return []

      if (item.length < 50) {
        return [item]
      }

      const extracted: string[] = []
      
      const areaMatch = item.match(/(\d+)\s*m[²2]/i)
      if (areaMatch) extracted.push(`${areaMatch[1]} m²`)

      const roomsMatch = item.match(/(\d+)\s*(hab[a-z]*|habitaci[oó]n[a-z]*)/i)
      if (roomsMatch) {
        const count = roomsMatch[1]
        extracted.push(`${count} ${Number(count) === 1 ? 'habitación' : 'habitaciones'}`)
      }

      const bathsMatch = item.match(/(\d+)\s*(ba[nñ]o[s]?)/i)
      if (bathsMatch) {
        const count = bathsMatch[1]
        extracted.push(`${count} ${Number(count) === 1 ? 'baño' : 'baños'}`)
      }

      if (item.toLowerCase().includes('piscina')) extracted.push('Piscina')
      if (item.toLowerCase().includes('terraza')) extracted.push('Terraza')
      if (item.toLowerCase().includes('garaje') || item.toLowerCase().includes('parking')) extracted.push('Garaje')
      if (item.toLowerCase().includes('ascensor')) extracted.push('Ascensor')
      if (item.toLowerCase().includes('aire acondicionado')) extracted.push('Aire acondicionado')
      if (item.toLowerCase().includes('trastero')) extracted.push('Trastero')

      return extracted
    })

    // Añadimos lo extraído del texto a la lista de esta generación
    currentGenerationHighlights.push(...extractedFromText)

    // 4. Parseamos y añadimos al array final evitando duplicados globales
    for (const highlight of parseHighlights(currentGenerationHighlights)) {
      if (!highlights.includes(highlight)) {
        highlights.push(highlight)
      }
    }
  }

  return highlights
}

/**
 * Convierte la fecha de creación a timestamp.
 *
 * PropertyItem.createdAt es string, por lo que no utilizamos
 * "instanceof Date", evitando el error de TypeScript:
 * "The left-hand side of an 'instanceof' expression..."
 */
function getCreatedAtTimestamp(
  createdAt: string | undefined,
): number {
  if (!createdAt) {
    return 0
  }

  const timestamp = new Date(
    createdAt,
  ).getTime()

  return Number.isNaN(timestamp)
    ? 0
    : timestamp
}

function compareNumericValue(
  propertyValue: number,
  filter: NumericFilter,
): boolean {
  if (filter.value.trim() === '') {
    return true
  }

  const value = Number(filter.value)

  if (!Number.isFinite(value)) {
    return true
  }

  switch (filter.operator) {
    case 'lt':
      return propertyValue < value

    case 'lte':
      return propertyValue <= value

    case 'eq':
      return propertyValue === value

    case 'gte':
      return propertyValue >= value

    case 'gt':
      return propertyValue > value

    default:
      return true
  }
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

    default:
      return 'Menor o igual que'
  }
}

function hasActiveFilters(
  filters: PropertyFilters,
): boolean {
  return (
    filters.price.value.trim() !== '' ||
    filters.area.value.trim() !== '' ||
    filters.bedrooms.value.trim() !== '' ||
    filters.bathrooms.value.trim() !== '' ||
    filters.operation !== '' ||
    filters.type !== '' ||
    filters.condition !== '' ||
    filters.pool ||
    filters.garden ||
    filters.terrace ||
    filters.balcony ||
    filters.garage ||
    filters.elevator ||
    filters.airConditioning ||
    filters.heating
  )
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

  // Búsqueda por título
  const [searchTerm, setSearchTerm] =
    useState('')

  // Ordenación
  const [sortOption, setSortOption] =
    useState<SortOption>('newest')

  const [isSortMenuOpen, setIsSortMenuOpen] =
    useState(false)

  // Filtros
  const [isFilterOpen, setIsFilterOpen] =
    useState(false)

  const [filters, setFilters] =
    useState<PropertyFilters>(
      createDefaultFilters,
    )

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

  // Evitamos que la página del fondo se desplace
  // mientras el menú de filtros está abierto.
  useEffect(() => {
    if (!isFilterOpen) {
      document.body.style.overflow = ''
      return
    }

    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = ''
    }
  }, [isFilterOpen])

  // Al cambiar la búsqueda, el orden o los filtros,
  // volvemos a la primera página.
  useEffect(() => {
    setCurrentPage(1)
  }, [
    searchTerm,
    sortOption,
    filters,
  ])

  // Scroll instantáneo al cambiar de página
  useEffect(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    })
  }, [currentPage])

  /**
   * Propiedades filtradas y ordenadas.
   */
  const filteredAndSortedProperties =
    useMemo(() => {
      const normalizedSearch =
        searchTerm
          .trim()
          .toLocaleLowerCase('es-ES')

      const filtered =
        properties.filter((property) => {
          // -----------------------------
          // Búsqueda por título
          // -----------------------------
          if (normalizedSearch) {
            const title =
              (
                property.title || ''
              ).toLocaleLowerCase(
                'es-ES',
              )

            if (
              !title.includes(
                normalizedSearch,
              )
            ) {
              return false
            }
          }

          // -----------------------------
          // Filtros numéricos
          // -----------------------------
          if (
            !compareNumericValue(
              property.price,
              filters.price,
            )
          ) {
            return false
          }

          if (
            !compareNumericValue(
              property.area,
              filters.area,
            )
          ) {
            return false
          }

          if (
            !compareNumericValue(
              property.bedrooms,
              filters.bedrooms,
            )
          ) {
            return false
          }

          if (
            !compareNumericValue(
              property.bathrooms,
              filters.bathrooms,
            )
          ) {
            return false
          }

          // -----------------------------
          // Operación
          // -----------------------------
          if (
            filters.operation &&
            property.operation
              ?.toLowerCase() !==
              filters.operation.toLowerCase()
          ) {
            return false
          }

          // -----------------------------
          // Tipo de inmueble
          // -----------------------------
          if (
            filters.type &&
            property.type
              ?.toLowerCase() !==
              filters.type.toLowerCase()
          ) {
            return false
          }

          // -----------------------------
          // Estado
          // -----------------------------
          if (
            filters.condition &&
            property.condition
              ?.toLowerCase()
              .replace(/_/g, '-') !==
              filters.condition
                .toLowerCase()
                .replace(/_/g, '-')
          ) {
            return false
          }

          // -----------------------------
          // Características
          // -----------------------------
          if (
            filters.pool &&
            !property.pool
          ) {
            return false
          }

          if (
            filters.garden &&
            !property.garden
          ) {
            return false
          }

          if (
            filters.terrace &&
            !property.terrace
          ) {
            return false
          }

          if (
            filters.balcony &&
            !property.balcony
          ) {
            return false
          }

          if (
            filters.garage &&
            !property.garage
          ) {
            return false
          }

          if (
            filters.elevator &&
            !property.elevator
          ) {
            return false
          }

          if (
            filters.airConditioning &&
            !property.airConditioning
          ) {
            return false
          }

          if (
            filters.heating &&
            !property.heating
          ) {
            return false
          }

          return true
        })

      return [...filtered].sort(
        (a, b) => {
          switch (sortOption) {
            case 'newest':
              return (
                getCreatedAtTimestamp(
                  b.createdAt,
                ) -
                getCreatedAtTimestamp(
                  a.createdAt,
                )
              )

            case 'oldest':
              return (
                getCreatedAtTimestamp(
                  a.createdAt,
                ) -
                getCreatedAtTimestamp(
                  b.createdAt,
                )
              )

            case 'most-expensive':
              return b.price - a.price

            case 'cheapest':
              return a.price - b.price

            default:
              return 0
          }
        },
      )
    }, [
      properties,
      searchTerm,
      sortOption,
      filters,
    ])

  // Cálculos de paginación sobre el resultado
  // ya filtrado y ordenado.
  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredAndSortedProperties.length /
        itemsPerPage,
    ),
  )

  const indexOfLastItem =
    currentPage * itemsPerPage

  const indexOfFirstItem =
    indexOfLastItem - itemsPerPage

  const currentProperties =
    filteredAndSortedProperties.slice(
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

  const selectedCount =
    selectedIds.size

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
      `¿Seguro que quieres eliminar ${count} ${
        count === 1
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

  const handleResetFilters = () => {
    setFilters(createDefaultFilters())
  }

  const updateNumericFilter = (
    field:
      | 'price'
      | 'area'
      | 'bedrooms'
      | 'bathrooms',
    property:
      | 'operator'
      | 'value',
    value: string,
  ) => {
    setFilters((current) => ({
      ...current,
      [field]: {
        ...current[field],
        [property]: value,
      },
    }))
  }

  const toggleBooleanFilter = (
    field:
      | 'pool'
      | 'garden'
      | 'terrace'
      | 'balcony'
      | 'garage'
      | 'elevator'
      | 'airConditioning'
      | 'heating',
  ) => {
    setFilters((current) => ({
      ...current,
      [field]: !current[field],
    }))
  }

  const sortLabels: Record<
    SortOption,
    string
  > = {
    newest: 'Más nuevos',
    oldest: 'Más antiguos',
    'most-expensive': 'Más caros',
    cheapest: 'Más baratos',
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
    <>
      <div className="max-w-6xl">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold">
              Inmuebles
            </h1>

            <p className="mt-2 text-muted-foreground">
              Gestiona los inmuebles y sus
              anuncios generados.
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
              Crea tu primer inmueble para
              empezar a generar anuncios.
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
            {/* Barra de búsqueda, ordenación y filtros */}
            <div className="mt-8 flex flex-col gap-3 rounded-lg border bg-card p-4 lg:flex-row lg:items-center">
              {/* Buscador */}
              <div className="relative flex-1">
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) =>
                    setSearchTerm(
                      event.target.value,
                    )
                  }
                  placeholder="Buscar por título del inmueble..."
                  aria-label="Buscar inmuebles por título"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {/* Ordenar */}
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
                      {sortLabels[
                        sortOption
                      ]}
                    </span>
                    <span className="text-xs">
                      ▾
                    </span>
                  </button>

                  {isSortMenuOpen && (
                    <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-md border bg-card p-1 shadow-lg">
                      {(
                        Object.entries(
                          sortLabels,
                        ) as [
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
                            className={`block w-full rounded px-3 py-2 text-left text-sm transition hover:bg-muted ${
                              sortOption ===
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

                {/* Filtros */}
                <button
                  type="button"
                  onClick={() =>
                    setIsFilterOpen(true)
                  }
                  className={`inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-medium transition hover:bg-muted ${
                    hasActiveFilters(
                      filters,
                    )
                      ? 'border-primary bg-primary/5 text-primary'
                      : ''
                  }`}
                >
                  Filtros
                  {hasActiveFilters(
                    filters,
                  ) && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                      Activos
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Información de resultados */}
            <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                Mostrando{' '}
                <span className="font-medium text-foreground">
                  {
                    filteredAndSortedProperties.length
                  }
                </span>{' '}
                de{' '}
                <span className="font-medium text-foreground">
                  {properties.length}
                </span>{' '}
                inmuebles
              </span>

              {(searchTerm ||
                hasActiveFilters(
                  filters,
                )) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('')
                    handleResetFilters()
                  }}
                  className="w-fit text-sm font-medium text-primary hover:underline"
                >
                  Limpiar búsqueda y filtros
                </button>
              )}
            </div>

            {/* Barra de selección */}
            <div className="mt-5 flex flex-col justify-between gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="select-current-page"
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
                  disabled={
                    deleting ||
                    currentProperties.length ===
                      0
                  }
                  className="h-4 w-4 cursor-pointer"
                />

                <label
                  htmlFor="select-current-page"
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
                    ? 'inmueble seleccionado'
                    : 'inmuebles seleccionados'}
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

            {currentProperties.length ===
            0 ? (
              <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
                <h2 className="font-semibold">
                  No hay inmuebles que coincidan
                </h2>

                <p className="mt-2 text-sm text-muted-foreground">
                  Prueba a cambiar la búsqueda
                  o alguno de los filtros.
                </p>

                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('')
                    handleResetFilters()
                  }}
                  className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Limpiar búsqueda y filtros
                </button>
              </div>
            ) : (
              <div className="mt-8 grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
                {currentProperties.map(
                  (property) => {
                    const generationCount =
                      property.generations
                        .length

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
                        className={`relative flex h-full flex-col rounded-lg border bg-card transition ${
                          isSelected
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
                            )} en ${
                              property.city ||
                              'Sin ciudad'
                            }`}
                            checked={
                              isSelected
                            }
                            onChange={() =>
                              handleToggleProperty(
                                property.id,
                              )
                            }
                            disabled={
                              deleting
                            }
                            className={`block h-8 w-full cursor-pointer appearance-none border-0 transition-colors focus:outline-none ${
                              isSelected
                                ? 'cursor-default bg-foreground'
                                : 'bg-accent group-hover:bg-primary'
                            }`}
                          />

                          <div
                            className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium transition-colors ${
                              isSelected
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
                          <div>
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <h2 className="mt-1 pb-12 text-lg font-semibold">
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

                          {/* Zona de highlights */}
                          <div className="mt-auto">
                            <div className="flex min-h-21 flex-col justify-end pb-4">
                              <div className="flex flex-wrap items-end gap-2">
                                {highlights
                                  .slice(
                                    0,
                                    5,
                                  )
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
                                    {getPropertyCondition(
                                      property.condition,
                                    )}
                                  </span>
                                )}

                                {property.operation && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                    {getPropertyOperation(
                                      property.operation,
                                    )}
                                  </span>
                                )}

                                {property.type && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                    {getPropertyTypeLabel(
                                      property.type,
                                    )}
                                  </span>
                                )}

                                {property.city && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                    {capitalizeFirstLetter(
                                      property.city,
                                    )}
                                  </span>
                                )}

                                {property.neighborhood && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                    {capitalizeFirstLetter(
                                      property.neighborhood,
                                    )}
                                  </span>
                                )}

                                {property.address && (
                                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                    {capitalizeFirstLetter(
                                      property.address,
                                    )}
                                  </span>
                                )}
                              </div>
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
            )}

            {/* Controles de paginación */}
            {totalPages > 1 &&
              currentProperties.length >
                0 && (
                <div className="mt-6 flex items-center justify-between border-t pt-4">
                  <button
                    type="button"
                    onClick={
                      handlePrevPage
                    }
                    disabled={
                      currentPage ===
                        1 ||
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
                    onClick={
                      handleNextPage
                    }
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

      {/* =========================================================
          MODAL DE FILTROS
          ========================================================= */}
      {isFilterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="filter-dialog-title"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setIsFilterOpen(false)
            }
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
            {/* Cabecera */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2
                  id="filter-dialog-title"
                  className="text-lg font-semibold"
                >
                  Filtrar inmuebles
                </h2>

                <p className="mt-1 text-sm text-muted-foreground">
                  Combina varios filtros para
                  encontrar exactamente los
                  inmuebles que buscas.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setIsFilterOpen(false)
                }
                aria-label="Cerrar filtros"
                className="rounded-md px-2 py-1 text-xl text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                ×
              </button>
            </div>

            {/* Contenido */}
            <div className="overflow-y-auto p-6">
              <div className="grid gap-6 md:grid-cols-2">
                {/* Precio */}
                <div>
                  <label
                    htmlFor="filter-price"
                    className="text-sm font-medium"
                  >
                    Precio
                  </label>

                  <div className="mt-2 flex gap-2">
                    <select
                      value={
                        filters.price.operator
                      }
                      onChange={(event) =>
                        updateNumericFilter(
                          'price',
                          'operator',
                          event.target
                            .value as NumericOperator,
                        )
                      }
                      className="w-40 rounded-md border bg-background px-3 py-2 text-sm"
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
                    </select>

                    <input
                      id="filter-price"
                      type="number"
                      min="0"
                      value={
                        filters.price.value
                      }
                      onChange={(event) =>
                        updateNumericFilter(
                          'price',
                          'value',
                          event.target.value,
                        )
                      }
                      placeholder="Ej. 150000"
                      className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {/* Superficie */}
                <div>
                  <label
                    htmlFor="filter-area"
                    className="text-sm font-medium"
                  >
                    Superficie (m²)
                  </label>

                  <div className="mt-2 flex gap-2">
                    <select
                      value={
                        filters.area.operator
                      }
                      onChange={(event) =>
                        updateNumericFilter(
                          'area',
                          'operator',
                          event.target
                            .value as NumericOperator,
                        )
                      }
                      className="w-40 rounded-md border bg-background px-3 py-2 text-sm"
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
                    </select>

                    <input
                      id="filter-area"
                      type="number"
                      min="0"
                      value={
                        filters.area.value
                      }
                      onChange={(event) =>
                        updateNumericFilter(
                          'area',
                          'value',
                          event.target.value,
                        )
                      }
                      placeholder="Ej. 42"
                      className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {/* Habitaciones */}
                <div>
                  <label
                    htmlFor="filter-bedrooms"
                    className="text-sm font-medium"
                  >
                    Habitaciones
                  </label>

                  <div className="mt-2 flex gap-2">
                    <select
                      value={
                        filters.bedrooms
                          .operator
                      }
                      onChange={(event) =>
                        updateNumericFilter(
                          'bedrooms',
                          'operator',
                          event.target
                            .value as NumericOperator,
                        )
                      }
                      className="w-40 rounded-md border bg-background px-3 py-2 text-sm"
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
                    </select>

                    <input
                      id="filter-bedrooms"
                      type="number"
                      min="0"
                      step="1"
                      value={
                        filters.bedrooms
                          .value
                      }
                      onChange={(event) =>
                        updateNumericFilter(
                          'bedrooms',
                          'value',
                          event.target.value,
                        )
                      }
                      placeholder="Ej. 3"
                      className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {/* Baños */}
                <div>
                  <label
                    htmlFor="filter-bathrooms"
                    className="text-sm font-medium"
                  >
                    Baños
                  </label>

                  <div className="mt-2 flex gap-2">
                    <select
                      value={
                        filters.bathrooms
                          .operator
                      }
                      onChange={(event) =>
                        updateNumericFilter(
                          'bathrooms',
                          'operator',
                          event.target
                            .value as NumericOperator,
                        )
                      }
                      className="w-40 rounded-md border bg-background px-3 py-2 text-sm"
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
                    </select>

                    <input
                      id="filter-bathrooms"
                      type="number"
                      min="0"
                      step="1"
                      value={
                        filters.bathrooms
                          .value
                      }
                      onChange={(event) =>
                        updateNumericFilter(
                          'bathrooms',
                          'value',
                          event.target.value,
                        )
                      }
                      placeholder="Ej. 2"
                      className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {/* Operación */}
                <div>
                  <label
                    htmlFor="filter-operation"
                    className="text-sm font-medium"
                  >
                    Operación
                  </label>

                  <select
                    id="filter-operation"
                    value={
                      filters.operation
                    }
                    onChange={(event) =>
                      setFilters(
                        (current) => ({
                          ...current,
                          operation:
                            event.target
                              .value,
                        }),
                      )
                    }
                    className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">
                      Cualquier operación
                    </option>
                    <option value="sale">
                      Venta
                    </option>
                    <option value="rent">
                      Alquiler
                    </option>
                  </select>
                </div>

                {/* Tipo */}
                <div>
                  <label
                    htmlFor="filter-type"
                    className="text-sm font-medium"
                  >
                    Tipo de inmueble
                  </label>

                  <select
                    id="filter-type"
                    value={filters.type}
                    onChange={(event) =>
                      setFilters(
                        (current) => ({
                          ...current,
                          type: event.target
                            .value,
                        }),
                      )
                    }
                    className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">
                      Cualquier tipo
                    </option>

                    {Object.entries(
                      propertyTypeLabels,
                    ).map(
                      ([
                        value,
                        label,
                      ]) => (
                        <option
                          key={value}
                          value={value}
                        >
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                {/* Estado */}
                <div>
                  <label
                    htmlFor="filter-condition"
                    className="text-sm font-medium"
                  >
                    Estado
                  </label>

                  <select
                    id="filter-condition"
                    value={
                      filters.condition
                    }
                    onChange={(event) =>
                      setFilters(
                        (current) => ({
                          ...current,
                          condition:
                            event.target
                              .value,
                        }),
                      )
                    }
                    className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">
                      Cualquier estado
                    </option>

                    <option value="new">
                      Obra nueva
                    </option>

                    <option value="good">
                      Buen estado
                    </option>

                    <option value="renovated">
                      Reformado
                    </option>

                    <option value="needs-renovation">
                      Necesita reforma
                    </option>
                  </select>
                </div>
              </div>

              {/* Características */}
              <div className="mt-7 border-t pt-6">
                <h3 className="text-sm font-semibold">
                  Características
                </h3>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {[
                    [
                      'pool',
                      'Piscina',
                    ],
                    [
                      'garden',
                      'Jardín',
                    ],
                    [
                      'terrace',
                      'Terraza',
                    ],
                    [
                      'balcony',
                      'Balcón',
                    ],
                    [
                      'garage',
                      'Garaje',
                    ],
                    [
                      'elevator',
                      'Ascensor',
                    ],
                    [
                      'airConditioning',
                      'Aire acondicionado',
                    ],
                    [
                      'heating',
                      'Calefacción',
                    ],
                  ].map(
                    ([field, label]) => {
                      const filterField =
                        field as
                          | 'pool'
                          | 'garden'
                          | 'terrace'
                          | 'balcony'
                          | 'garage'
                          | 'elevator'
                          | 'airConditioning'
                          | 'heating'

                      return (
                        <label
                          key={field}
                          className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={
                              filters[
                                filterField
                              ]
                            }
                            onChange={() =>
                              toggleBooleanFilter(
                                filterField,
                              )
                            }
                            className="h-4 w-4 cursor-pointer"
                          />

                          <span>
                            {label}
                          </span>
                        </label>
                      )
                    },
                  )}
                </div>
              </div>

              {/* Resumen de filtros numéricos */}
              {hasActiveFilters(
                filters,
              ) && (
                <div className="mt-6 rounded-md bg-muted/50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Filtros activos
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {filters.price.value && (
                      <span className="rounded-md bg-background px-2 py-1 text-xs">
                        Precio{' '}
                        {getOperatorLabel(
                          filters.price
                            .operator,
                        )}{' '}
                        {
                          filters.price
                            .value
                        } €
                      </span>
                    )}

                    {filters.area.value && (
                      <span className="rounded-md bg-background px-2 py-1 text-xs">
                        Superficie{' '}
                        {getOperatorLabel(
                          filters.area
                            .operator,
                        )}{' '}
                        {
                          filters.area
                            .value
                        } m²
                      </span>
                    )}

                    {filters.bedrooms
                      .value && (
                      <span className="rounded-md bg-background px-2 py-1 text-xs">
                        Habitaciones{' '}
                        {getOperatorLabel(
                          filters.bedrooms
                            .operator,
                        )}{' '}
                        {
                          filters.bedrooms
                            .value
                        }
                      </span>
                    )}

                    {filters.bathrooms
                      .value && (
                      <span className="rounded-md bg-background px-2 py-1 text-xs">
                        Baños{' '}
                        {getOperatorLabel(
                          filters.bathrooms
                            .operator,
                        )}{' '}
                        {
                          filters.bathrooms
                            .value
                        }
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Pie del modal */}
            <div className="flex flex-col-reverse gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={
                  handleResetFilters
                }
                disabled={
                  !hasActiveFilters(
                    filters,
                  )
                }
                className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Limpiar filtros
              </button>

              <button
                type="button"
                onClick={() =>
                  setIsFilterOpen(false)
                }
                className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Aplicar filtros
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default PropertiesPage