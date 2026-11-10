import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { getCommercialStatusLabel } from '@estateforge/shared'
import { useModalDialog } from '@/hooks/useModalDialog'
import { PageJump } from '@/components/ui/PageJump'
import { clampPage, pageSlice, totalPagesFor } from '@/lib/pagination'

import {
  deleteProperties,
  getProperties,
  type PropertyItem,
} from '@/services/propertyService'

// ============================================================
// DICCIONARIOS
// ============================================================

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

const propertyOperationLabels: Record<string, string> = {
  sale: 'Venta',
  rent: 'Alquiler',
  transfer: 'Traspaso',
}

const propertyConditionLabels: Record<string, string> = {
  new: 'Obra nueva',
  good: 'Buen estado',
  renovated: 'Reformado',
  'needs-renovation': 'A reformar',
}

// ============================================================
// TIPOS
// ============================================================

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
  | 'range'

type NumericFilter = {
  operator: NumericOperator
  value: string
  min: string
  max: string
}

type NumericFilterField =
  | 'price'
  | 'area'
  | 'bedrooms'
  | 'bathrooms'

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
  storageRoom: boolean
  elevator: boolean
  airConditioning: boolean
  heating: boolean
}

// ============================================================
// CONFIGURACIÓN DE CARACTERÍSTICAS
// ============================================================

const propertyFeatureLabels: Array<
  [BooleanFilterField, string]
> = [
    ['pool', 'Piscina'],
    ['garden', 'Jardín'],
    ['terrace', 'Terraza'],
    ['balcony', 'Balcón'],
    ['garage', 'Garaje'],
    ['storageRoom', 'Trastero'],
    ['elevator', 'Ascensor'],
    ['airConditioning', 'Aire acondicionado'],
    ['heating', 'Calefacción'],
  ]

// ============================================================
// FILTROS NUMÉRICOS
// ============================================================

const emptyNumericFilter = (): NumericFilter => ({
  operator: 'lte',
  value: '',
  min: '',
  max: '',
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
  storageRoom: false,
  elevator: false,
  airConditioning: false,
  heating: false,
})

// ============================================================
// NORMALIZACIÓN
// ============================================================

function normalizeText(
  value: unknown,
): string {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value)
    .trim()
    .toLocaleLowerCase('es-ES')
    .replace(/_/g, '-')
}

function normalizeBoolean(
  value: unknown,
): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value !== 0
  }

  if (typeof value === 'string') {
    const normalized =
      value.trim().toLocaleLowerCase('es-ES')

    if (
      [
        'true',
        '1',
        'yes',
        'si',
        'sí',
        'on',
        'enabled',
        'activo',
        'activa',
      ].includes(normalized)
    ) {
      return true
    }

    if (
      [
        'false',
        '0',
        'no',
        'off',
        'disabled',
        'inactivo',
        'inactiva',
        '',
      ].includes(normalized)
    ) {
      return false
    }
  }

  return Boolean(value)
}

function getNumericPropertyValue(
  value: unknown,
): number {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : 0
  }

  if (typeof value === 'string') {
    const normalized =
      value
        .trim()
        .replace(/\./g, '')
        .replace(',', '.')

    const parsed = Number(normalized)

    return Number.isFinite(parsed)
      ? parsed
      : 0
  }

  return 0
}

// ============================================================
// ETIQUETAS
// ============================================================

function getPropertyOperation(
  operation: string | undefined,
): string {
  const normalized = normalizeText(operation)

  if (!normalized) {
    return 'No indicado'
  }

  return (
    propertyOperationLabels[normalized] || operation || ''
  )
}

function getPropertyTypeLabel(
  type: string | undefined,
): string {
  const normalized = normalizeText(type)

  if (!normalized) {
    return 'No indicado'
  }

  return (
    propertyTypeLabels[normalized] || type || ''
  )
}

function getPropertyCondition(
  condition: string | undefined,
): string {
  const normalized = normalizeText(condition)

  if (!normalized) {
    return ''
  }

  return (
    propertyConditionLabels[normalized] || condition || ''
  )
}

function capitalizeFirstLetter(
  text: string | undefined,
): string {
  if (!text) {
    return ''
  }

  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ============================================================
// PÍLDORAS ESTRUCTURADAS
// ============================================================

function getPropertyStructuredPills(
  property: PropertyItem,
): string[] {
  const pills: string[] = []

  // PRECIO
  const price = getNumericPropertyValue(property.price)
  if (price > 0) {
    pills.push(`${price.toLocaleString('es-ES')} €`)
  }

  // SUPERFICIE
  const area = getNumericPropertyValue(property.area)
  if (area > 0) {
    pills.push(`${area.toLocaleString('es-ES')} m²`)
  }

  // HABITACIONES
  const bedrooms = getNumericPropertyValue(property.bedrooms)
  if (bedrooms > 0) {
    pills.push(
      `${bedrooms.toLocaleString('es-ES')} ${bedrooms === 1 ? 'habitación' : 'habitaciones'
      }`,
    )
  }

  // BAÑOS
  const bathrooms = getNumericPropertyValue(property.bathrooms)
  if (bathrooms > 0) {
    pills.push(
      `${bathrooms.toLocaleString('es-ES')} ${bathrooms === 1 ? 'baño' : 'baños'
      }`,
    )
  }

  // ESTADO COMERCIAL
  pills.push(getCommercialStatusLabel(property.commercialStatus))

  // CONSERVACIÓN
  if (property.condition) {
    const condition = getPropertyCondition(property.condition)
    if (condition) {
      pills.push(condition)
    }
  }

  // OPERACIÓN
  if (property.operation) {
    const operation = getPropertyOperation(property.operation)
    if (operation) {
      pills.push(operation)
    }
  }

  // TIPO
  if (property.type) {
    const type = getPropertyTypeLabel(property.type)
    if (type) {
      pills.push(type)
    }
  }

  // UBICACIÓN
  if (property.city) {
    const city = capitalizeFirstLetter(property.city)
    if (city) {
      pills.push(city)
    }
  }

  if (property.neighborhood) {
    const neighborhood = capitalizeFirstLetter(property.neighborhood)
    if (neighborhood) {
      pills.push(neighborhood)
    }
  }

  if (property.address) {
    const address = capitalizeFirstLetter(property.address)
    if (address) {
      pills.push(address)
    }
  }

  // CARACTERÍSTICAS BOOLEANAS
  for (const [field, label] of propertyFeatureLabels) {
    if (normalizeBoolean(property[field])) {
      pills.push(label)
    }
  }

  return pills
}

// ============================================================
// FECHAS
// ============================================================

function getCreatedAtTimestamp(
  createdAt: string | undefined,
): number {
  if (!createdAt) {
    return 0
  }

  const timestamp = new Date(createdAt).getTime()

  return Number.isNaN(timestamp) ? 0 : timestamp
}

// ============================================================
// FILTROS NUMÉRICOS
// ============================================================

function getNumericFilterValue(
  value: string,
): number | null {
  if (value.trim() === '') {
    return null
  }

  const normalized = value.trim().replace(',', '.')
  const parsed = Number(normalized)

  return Number.isFinite(parsed) ? parsed : null
}

function compareNumericValue(
  propertyValue: unknown,
  filter: NumericFilter,
): boolean {
  const numericPropertyValue = getNumericPropertyValue(propertyValue)

  if (filter.operator === 'range') {
    const min = getNumericFilterValue(filter.min)
    const max = getNumericFilterValue(filter.max)

    if (min === null && max === null) {
      return true
    }

    if (min !== null && numericPropertyValue < min) {
      return false
    }

    if (max !== null && numericPropertyValue > max) {
      return false
    }

    return true
  }

  const value = getNumericFilterValue(filter.value)

  if (value === null) {
    return true
  }

  switch (filter.operator) {
    case 'lt':
      return numericPropertyValue < value

    case 'lte':
      return numericPropertyValue <= value

    case 'eq':
      return numericPropertyValue === value

    case 'gte':
      return numericPropertyValue >= value

    case 'gt':
      return numericPropertyValue > value

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

    case 'range':
      return 'Entre'

    default:
      return 'Menor o igual que'
  }
}

function hasActiveNumericFilter(
  filter: NumericFilter,
): boolean {
  if (filter.operator === 'range') {
    return filter.min.trim() !== '' || filter.max.trim() !== ''
  }

  return filter.value.trim() !== ''
}

function hasActiveFilters(
  filters: PropertyFilters,
): boolean {
  return (
    hasActiveNumericFilter(filters.price) ||
    hasActiveNumericFilter(filters.area) ||
    hasActiveNumericFilter(filters.bedrooms) ||
    hasActiveNumericFilter(filters.bathrooms) ||
    filters.operation !== '' ||
    filters.type !== '' ||
    filters.condition !== '' ||
    filters.pool ||
    filters.garden ||
    filters.terrace ||
    filters.balcony ||
    filters.garage ||
    filters.storageRoom ||
    filters.elevator ||
    filters.airConditioning ||
    filters.heating
  )
}

// ============================================================
// COMPONENTE
// ============================================================

function PropertiesPage() {
  const [properties, setProperties] = useState<PropertyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)

  const itemsPerPage = 6

  const [searchTerm, setSearchTerm] = useState('')
  const [sortOption, setSortOption] = useState<SortOption>('newest')
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [filters, setFilters] = useState<PropertyFilters>(
    createDefaultFilters,
  )

  // ==========================================================
  // CARGA
  // ==========================================================

  useEffect(() => {
    async function loadProperties() {
      try {
        const result = await getProperties()
        setProperties(result)
      } catch {
        setError('No se han podido cargar los inmuebles.')
      } finally {
        setLoading(false)
      }
    }

    void loadProperties()
  }, [])

  // ==========================================================
  // MODAL DE FILTROS
  // ==========================================================

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

  // Foco y teclado del modal: Escape lo cierra (los filtros ya se aplican al
  // cambiarlos). Sin foco inicial indicado, lo recibe «Cerrar filtros».
  const filterDialogRef = useModalDialog<HTMLDivElement>({
    open: isFilterOpen,
    onClose: () => setIsFilterOpen(false),
  })

  // ==========================================================
  // PAGINACIÓN
  // ==========================================================

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, sortOption, filters])

  useEffect(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    })
  }, [currentPage])

  // ==========================================================
  // FILTRADO Y ORDENACIÓN
  // ==========================================================

  const filteredAndSortedProperties = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase('es-ES')

    const filtered = properties.filter((property) => {
      // BÚSQUEDA
      if (normalizedSearch) {
        const title = String(property.title || '').toLocaleLowerCase('es-ES')
        if (!title.includes(normalizedSearch)) {
          return false
        }
      }

      // FILTROS NUMÉRICOS
      if (!compareNumericValue(property.price, filters.price)) {
        return false
      }

      if (!compareNumericValue(property.area, filters.area)) {
        return false
      }

      if (!compareNumericValue(property.bedrooms, filters.bedrooms)) {
        return false
      }

      if (!compareNumericValue(property.bathrooms, filters.bathrooms)) {
        return false
      }

      // OPERACIÓN
      if (
        filters.operation &&
        normalizeText(property.operation) !== normalizeText(filters.operation)
      ) {
        return false
      }

      // TIPO
      if (
        filters.type &&
        normalizeText(property.type) !== normalizeText(filters.type)
      ) {
        return false
      }

      // ESTADO
      if (
        filters.condition &&
        normalizeText(property.condition) !== normalizeText(filters.condition)
      ) {
        return false
      }

      // CARACTERÍSTICAS
      if (filters.pool && !normalizeBoolean(property.pool)) {
        return false
      }

      if (filters.garden && !normalizeBoolean(property.garden)) {
        return false
      }

      if (filters.terrace && !normalizeBoolean(property.terrace)) {
        return false
      }

      if (filters.balcony && !normalizeBoolean(property.balcony)) {
        return false
      }

      if (filters.garage && !normalizeBoolean(property.garage)) {
        return false
      }

      if (filters.storageRoom && !normalizeBoolean(property.storageRoom)) {
        return false
      }

      if (filters.elevator && !normalizeBoolean(property.elevator)) {
        return false
      }

      if (
        filters.airConditioning &&
        !normalizeBoolean(property.airConditioning)
      ) {
        return false
      }

      if (filters.heating && !normalizeBoolean(property.heating)) {
        return false
      }

      return true
    })

    return [...filtered].sort((a, b) => {
      switch (sortOption) {
        case 'newest':
          return (
            getCreatedAtTimestamp(b.createdAt) -
            getCreatedAtTimestamp(a.createdAt)
          )

        case 'oldest':
          return (
            getCreatedAtTimestamp(a.createdAt) -
            getCreatedAtTimestamp(b.createdAt)
          )

        case 'most-expensive':
          return (
            getNumericPropertyValue(b.price) - getNumericPropertyValue(a.price)
          )

        case 'cheapest':
          return (
            getNumericPropertyValue(a.price) - getNumericPropertyValue(b.price)
          )

        default:
          return 0
      }
    })
  }, [properties, searchTerm, sortOption, filters])

  const totalPages = totalPagesFor(filteredAndSortedProperties.length, itemsPerPage)

  const currentProperties = pageSlice(filteredAndSortedProperties, currentPage, itemsPerPage)

  useEffect(() => {
    setCurrentPage((previousPage) => Math.min(previousPage, totalPages))
  }, [totalPages])

  // ==========================================================
  // SELECCIÓN
  // ==========================================================

  const currentPageIds = useMemo(
    () => currentProperties.map((property) => property.id),
    [currentProperties],
  )

  const selectedOnCurrentPage = currentPageIds.filter((id) =>
    selectedIds.has(id),
  ).length

  const allCurrentPageSelected =
    currentPageIds.length > 0 &&
    selectedOnCurrentPage === currentPageIds.length

  const someCurrentPageSelected =
    selectedOnCurrentPage > 0 && !allCurrentPageSelected

  const selectedCount = selectedIds.size

  const handleToggleProperty = (propertyId: string) => {
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
        currentPageIds.forEach((id) => next.delete(id))
      } else {
        currentPageIds.forEach((id) => next.add(id))
      }

      return next
    })

    setDeleteError(null)
  }

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((previous) => previous + 1)
    }
  }

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((previous) => previous - 1)
    }
  }

  // Salto directo: PageJump solo entrega páginas válidas; se acota por si el total cambió.
  const handleJumpToPage = (page: number) => {
    setCurrentPage(clampPage(page, totalPages))
  }

  // ==========================================================
  // BORRADO
  // ==========================================================

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0 || deleting) {
      return
    }

    const count = selectedIds.size

    const confirmed = window.confirm(
      `¿Seguro que quieres eliminar ${count} ${count === 1 ? 'inmueble' : 'inmuebles'
      } seleccionados? También se eliminarán todos los anuncios generados asociados.`,
    )

    if (!confirmed) {
      return
    }

    setDeleting(true)
    setDeleteError(null)

    try {
      await deleteProperties(Array.from(selectedIds))

      const result = await getProperties()

      setProperties(result)
      setSelectedIds(new Set())

      const newTotalPages = Math.max(
        1,
        Math.ceil(result.length / itemsPerPage),
      )

      setCurrentPage((previousPage) =>
        Math.min(previousPage, newTotalPages),
      )
    } catch (deleteError) {
      console.error('Error eliminando inmuebles:', deleteError)

      setDeleteError(
        'No se han podido eliminar los inmuebles seleccionados.',
      )
    } finally {
      setDeleting(false)
    }
  }

  // ==========================================================
  // FILTROS
  // ==========================================================

  const handleResetFilters = () => {
    setFilters(createDefaultFilters())
  }

  const updateNumericFilter = (
    field: NumericFilterField,
    property: 'operator' | 'value' | 'min' | 'max',
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

  const updateNumericOperator = (
    field: NumericFilterField,
    operator: NumericOperator,
  ) => {
    setFilters((current) => ({
      ...current,
      [field]: {
        ...current[field],
        operator,
        ...(operator === 'range'
          ? { value: '' }
          : { min: '', max: '' }),
      },
    }))
  }

  const toggleBooleanFilter = (field: BooleanFilterField) => {
    setFilters((current) => ({
      ...current,
      [field]: !current[field],
    }))
  }

  const sortLabels: Record<SortOption, string> = {
    newest: 'Más nuevos',
    oldest: 'Más antiguos',
    'most-expensive': 'Más caros',
    cheapest: 'Más baratos',
  }

  const numericOperators: [NumericOperator, string][] = [
    ['lt', 'Menor que'],
    ['lte', 'Menor o igual que'],
    ['eq', 'Igual a'],
    ['gte', 'Mayor o igual que'],
    ['gt', 'Mayor que'],
    ['range', 'Entre'],
  ]

  // ==========================================================
  // ESTADOS
  // ==========================================================

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Inmuebles</h1>
        <p className="mt-4 text-muted-foreground">Cargando inmuebles...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Inmuebles</h1>
        <p className="mt-4 text-destructive">{error}</p>
      </div>
    )
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <>
      <div className="mx-auto w-full max-w-7xl">
        {/* CABECERA */}

        <div className="flex flex-col justify-between gap-5 px-1 py-1 sm:px-1 sm:py-2 lg:flex-row lg:items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Inmuebles</h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Consulta los inmuebles.
            </p>
          </div>

          <Link
            to="/inmuebles/nuevo"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-auto"
          >
            Crear inmueble
          </Link>
        </div>

        {deleteError && (
          <div className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3.5">
            <p className="text-sm text-destructive">{deleteError}</p>
          </div>
        )}

        {properties.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed bg-card px-6 py-14 text-center shadow-sm">
            <h2 className="font-semibold">No hay inmuebles todavía</h2>

            <p className="mt-2 text-sm text-muted-foreground">
              Crea tu primer inmueble para empezar a generar anuncios.
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
            {/* BÚSQUEDA / ORDENACIÓN / FILTROS */}

            <div className="mt-6 flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-sm sm:p-4 xl:flex-row xl:items-center">
              <div className="relative flex-1">
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por título del inmueble..."
                  aria-label="Buscar inmuebles por título"
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {/* ORDENAR */}

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsSortMenuOpen((current) => !current)}
                    aria-expanded={isSortMenuOpen}
                    className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-muted"
                  >
                    Ordenar
                    <span className="text-muted-foreground">·</span>
                    <span>{sortLabels[sortOption]}</span>
                    <span className="text-xs">↓</span>
                  </button>

                  {isSortMenuOpen && (
                    <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border bg-card p-1.5 shadow-xl">
                      {(
                        Object.entries(sortLabels) as [SortOption, string][]
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setSortOption(value)
                            setIsSortMenuOpen(false)
                          }}
                          className={`block w-full rounded px-3 py-2 text-left text-sm transition hover:bg-muted ${sortOption === value ? 'bg-muted font-medium' : ''
                            }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* FILTRAR */}

                <button
                  type="button"
                  onClick={() => setIsFilterOpen(true)}
                  className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-muted ${hasActiveFilters(filters)
                    ? 'border-primary bg-primary/5 text-primary'
                    : ''
                    }`}
                >
                  Filtrar
                  {hasActiveFilters(filters) && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                      Activos
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* RESULTADOS */}

            <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span className="font-medium text-foreground">
                  {filteredAndSortedProperties.length}{' '}
                </span>
                {filteredAndSortedProperties.length === 1
                  ? 'inmueble encontrado'
                  : 'inmuebles encontrados'}
              </span>

              {(searchTerm || hasActiveFilters(filters)) && (
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

            {/* SELECCIÓN */}

            <div className={`mt-5 flex flex-col justify-between gap-3 rounded-2xl border px-4 py-3.5 shadow-sm transition sm:flex-row sm:items-center bg-card`}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="select-current-page"
                  checked={allCurrentPageSelected}
                  ref={(element) => {
                    if (element) {
                      element.indeterminate = someCurrentPageSelected
                    }
                  }}
                  onChange={handleToggleCurrentPage}
                  disabled={deleting || currentProperties.length === 0}
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

                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={deleting || selectedCount === 0}
                  aria-hidden={selectedCount === 0}
                  tabIndex={selectedCount === 0 ? -1 : 0}
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

            {/* LISTA / GRID DE RESULTADOS */}

            {currentProperties.length === 0 ? (
              <div className="mt-8 rounded-3xl border border-dashed bg-card px-6 py-14 text-center shadow-sm">
                <h2 className="font-semibold">
                  No hay inmuebles que coincidan
                </h2>

                <p className="mt-2 text-sm text-muted-foreground">
                  Prueba a cambiar la búsqueda o alguno de los filtros.
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
                {currentProperties.map((property) => {
                  const generationCount = property.generations.length
                  const isSelected = selectedIds.has(property.id)
                  const propertyPills = getPropertyStructuredPills(property)

                  return (
                    <div
                      key={property.id}
                      className={`group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition duration-200 ${isSelected
                        ? 'border-primary ring-2 ring-primary/25'
                        : 'border-border'
                        }`}
                    >
                      {/* SELECTOR */}

                      <div className="relative w-full overflow-hidden border-b border-border">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${getPropertyTypeLabel(
                            property.type,
                          )} en ${property.city || 'Sin ciudad'}`}
                          checked={isSelected}
                          onChange={() => handleToggleProperty(property.id)}
                          disabled={deleting}
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
                          {isSelected ? '✓ Seleccionado' : 'Seleccionar'}
                        </div>
                      </div>

                      {/* CONTENIDO */}

                      <div className="flex flex-1 flex-col p-5">
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h2 className="mt-2 line-clamp-2 text-lg font-semibold leading-6 tracking-tight">
                                {property.title}
                              </h2>
                            </div>

                            <p className="whitespace-nowrap text-lg font-bold">
                              {getNumericPropertyValue(
                                property.price,
                              ).toLocaleString('es-ES')}{' '}
                              €
                            </p>
                          </div>
                        </div>

                        <div className="mt-5">
                          <div className="flex min-h-21 flex-col justify-end pb-4">
                            <div className="flex flex-wrap items-end gap-2">
                              {propertyPills.map((pill, index) => (
                                <span
                                  key={`${normalizeText(pill)}-${index}`}
                                  className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                                >
                                  {pill}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* FECHA + ANUNCIOS */}

                          <div className="flex justify-between border-t pt-4">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                Anuncios generados
                              </p>

                              <p className="mt-1 text-sm font-medium">
                                {generationCount}{' '}
                                {generationCount === 1
                                  ? 'anuncio'
                                  : 'anuncios'}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs text-muted-foreground">
                                Generado el:
                              </p>

                              <p className="mt-1 text-sm font-medium">
                                {new Date(property.createdAt).toLocaleString(
                                  'es-ES',
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* CTA */}

                      <Link
                        to={`/inmuebles/${property.id}`}
                        aria-label="Ver inmueble"
                        className="mt-auto flex h-11 w-full items-center justify-center border-t bg-card text-xs font-semibold text-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        Ver inmueble
                      </Link>
                    </div>
                  )
                })}
              </div>
            )}

            {/* PAGINACIÓN */}

            {totalPages > 1 && currentProperties.length > 0 && (
              <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-5">
                <button
                  type="button"
                  onClick={handlePrevPage}
                  disabled={currentPage === 1 || deleting}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Anterior
                </button>

                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                  <span className="text-sm text-muted-foreground">
                    Página <span className="font-semibold">{currentPage}</span> de{' '}
                    <span className="font-semibold">{totalPages}</span>
                  </span>
                  <PageJump currentPage={currentPage} totalPages={totalPages} onJump={handleJumpToPage} disabled={deleting} label="Ir a la página de inmuebles" />
                </div>

                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages || deleting}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Siguiente
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ======================================================
        MODAL DE FILTROS
        ====================================================== */}

      {isFilterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsFilterOpen(false)
            }
          }}
        >
          <div
            ref={filterDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="filter-dialog-title"
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
          >
            {/* CABECERA */}

            <div className="flex items-start justify-between gap-4 border-b px-5 py-5 sm:px-6">
              <div>
                <h2
                  id="filter-dialog-title"
                  className="text-lg font-semibold"
                >
                  Filtrar inmuebles
                </h2>

                <p className="mt-1 text-sm text-muted-foreground">
                  Combina varios filtros para encontrar exactamente los inmuebles que buscas.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsFilterOpen(false)}
                aria-label="Cerrar filtros"
                className="rounded-md px-2 py-1 text-xl text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto p-5 sm:p-6">
              <div className="grid gap-6 md:grid-cols-2">
                {/* FILTROS NUMÉRICOS */}

                {(
                  [
                    ['price', 'Precio', 'Ej. 150000', false],
                    ['area', 'Superficie (m²)', 'Ej. 42', false],
                    ['bedrooms', 'Habitaciones', 'Ej. 3', true],
                    ['bathrooms', 'Baños', 'Ej. 2', true],
                  ] as [NumericFilterField, string, string, boolean][]
                ).map(([field, label, placeholder, integer]) => {
                  const filter = filters[field]

                  return (
                    <div key={field}>
                      <label className="text-sm font-medium">{label}</label>

                      <div className="mt-2">
                        <select
                          value={filter.operator}
                          onChange={(event) =>
                            updateNumericOperator(
                              field,
                              event.target.value as NumericOperator,
                            )
                          }
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          {numericOperators.map(([value, operatorLabel]) => (
                            <option key={value} value={value}>
                              {operatorLabel}
                            </option>
                          ))}
                        </select>

                        {filter.operator === 'range' ? (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              min="0"
                              step={integer ? '1' : undefined}
                              value={filter.min}
                              onChange={(event) =>
                                updateNumericFilter(
                                  field,
                                  'min',
                                  event.target.value,
                                )
                              }
                              placeholder="Mínimo"
                              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            />

                            <input
                              type="number"
                              min="0"
                              step={integer ? '1' : undefined}
                              value={filter.max}
                              onChange={(event) =>
                                updateNumericFilter(
                                  field,
                                  'max',
                                  event.target.value,
                                )
                              }
                              placeholder="Máximo"
                              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            />
                          </div>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step={integer ? '1' : undefined}
                            value={filter.value}
                            onChange={(event) =>
                              updateNumericFilter(
                                field,
                                'value',
                                event.target.value,
                              )
                            }
                            placeholder={placeholder}
                            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                          />
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* OPERACIÓN */}

                <div>
                  <label
                    htmlFor="filter-operation"
                    className="text-sm font-medium"
                  >
                    Operación
                  </label>

                  <select
                    id="filter-operation"
                    value={filters.operation}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        operation: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Cualquier operación</option>
                    <option value="sale">Venta</option>
                    <option value="rent">Alquiler</option>
                    <option value="transfer">Traspaso</option>
                  </select>
                </div>

                {/* TIPO */}

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
                      setFilters((current) => ({
                        ...current,
                        type: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Cualquier tipo</option>
                    {Object.entries(propertyTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* ESTADO */}

                <div>
                  <label
                    htmlFor="filter-condition"
                    className="text-sm font-medium"
                  >
                    Conservación
                  </label>

                  <select
                    id="filter-condition"
                    value={filters.condition}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        condition: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Cualquier estado</option>
                    <option value="new">Nuevo</option>
                    <option value="good">Buen estado</option>
                    <option value="renovated">Reformado</option>
                    <option value="needs-renovation">A reformar</option>
                  </select>
                </div>
              </div>

              {/* CARACTERÍSTICAS */}

              <div className="mt-6 rounded-2xl border bg-muted/15 p-4 sm:p-5">
                <h3 className="text-sm font-semibold">Características</h3>

                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {propertyFeatureLabels.map(([field, label]) => (
                    <label
                      key={field}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border bg-background px-3.5 py-3 text-sm transition hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={filters[field]}
                        onChange={() => toggleBooleanFilter(field)}
                        className="h-4 w-4 cursor-pointer"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* RESUMEN DE FILTROS */}

              {hasActiveFilters(filters) && (
                <div className="mt-6 rounded-md bg-muted/50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Filtros activos
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(
                      [
                        ['Precio', filters.price, '€'],
                        ['Superficie', filters.area, 'm²'],
                        ['Habitaciones', filters.bedrooms, ''],
                        ['Baños', filters.bathrooms, ''],
                      ] as [string, NumericFilter, string][]
                    ).map(([label, filter, suffix]) => {
                      if (!hasActiveNumericFilter(filter)) {
                        return null
                      }

                      const text =
                        filter.operator === 'range'
                          ? `${label} entre ${filter.min || 'sin mínimo'
                          } y ${filter.max || 'sin máximo'}${suffix ? ` ${suffix}` : ''
                          }`
                          : `${label} ${getOperatorLabel(
                            filter.operator,
                          )} ${filter.value}${suffix ? ` ${suffix}` : ''}`

                      return (
                        <span
                          key={label}
                          className="rounded-md bg-background px-2 py-1 text-xs"
                        >
                          {text}
                        </span>
                      )
                    })}

                    {/* FILTROS BOOLEANOS ACTIVOS */}

                    {propertyFeatureLabels.map(([field, label]) =>
                      filters[field] ? (
                        <span
                          key={field}
                          className="rounded-md bg-background px-2 py-1 text-xs"
                        >
                          {label}
                        </span>
                      ) : null,
                    )}

                    {/* OTROS FILTROS */}

                    {filters.operation && (
                      <span className="rounded-md bg-background px-2 py-1 text-xs">
                        Operación: {getPropertyOperation(filters.operation)}
                      </span>
                    )}

                    {filters.type && (
                      <span className="rounded-md bg-background px-2 py-1 text-xs">
                        Tipo: {getPropertyTypeLabel(filters.type)}
                      </span>
                    )}

                    {filters.condition && (
                      <span className="rounded-md bg-background px-2 py-1 text-xs">
                        Conservación: {getPropertyCondition(filters.condition)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* PIE */}

            <div className="flex flex-col-reverse gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <button
                type="button"
                onClick={handleResetFilters}
                disabled={!hasActiveFilters(filters)}
                className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Limpiar filtros
              </button>

              <button
                type="button"
                onClick={() => setIsFilterOpen(false)}
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