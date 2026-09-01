import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { buildPropertyHighlights } from '@/utils/propertyHighlights'

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

const propertyOperationLabels: Record<string, string> = {
  sale: 'Venta',
  rent: 'Alquiler',
}

const propertyConditionLabels: Record<string, string> = {
  new: 'Obra nueva',
  good: 'Buen estado',
  renovated: 'Reformado',
  'needs-renovation': 'Necesita reforma',
  'to-renovate': 'Necesita reforma',
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

  if (
    typeof value === 'number'
  ) {
    return value !== 0
  }

  if (
    typeof value === 'string'
  ) {
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
  if (
    typeof value === 'number'
  ) {
    return Number.isFinite(value)
      ? value
      : 0
  }

  if (
    typeof value === 'string'
  ) {
    const normalized =
      value
        .trim()
        .replace(/\./g, '')
        .replace(',', '.')

    const parsed =
      Number(normalized)

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
  const normalized =
    normalizeText(operation)

  if (!normalized) {
    return 'No indicado'
  }

  return (
    propertyOperationLabels[
      normalized
    ] || operation || ''
  )
}

function getPropertyTypeLabel(
  type: string | undefined,
): string {
  const normalized =
    normalizeText(type)

  if (!normalized) {
    return 'No indicado'
  }

  return (
    propertyTypeLabels[
      normalized
    ] || type || ''
  )
}

function getPropertyCondition(
  condition: string | undefined,
): string {
  const normalized =
    normalizeText(condition)

  if (!normalized) {
    return ''
  }

  return (
    propertyConditionLabels[
      normalized
    ] || condition || ''
  )
}

function capitalizeFirstLetter(
  text: string | undefined,
): string {
  if (!text) {
    return ''
  }

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
  )
}

// ============================================================
// HIGHLIGHTS
// ============================================================

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
    const currentGenerationHighlights: string[] =
      []

    const structured =
      buildPropertyHighlights(generation)

    if (
      structured &&
      structured.length > 0
    ) {
      currentGenerationHighlights.push(
        ...structured,
      )
    }

    let rawHighlights: string[] = []

    if (
      typeof generation.highlights ===
      'string'
    ) {
      try {
        const parsed: unknown =
          JSON.parse(
            generation.highlights,
          )

        if (Array.isArray(parsed)) {
          rawHighlights = parsed.filter(
            (
              item,
            ): item is string =>
              typeof item === 'string',
          )
        } else {
          rawHighlights = [
            generation.highlights,
          ]
        }
      } catch {
        rawHighlights = [
          generation.highlights,
        ]
      }
    } else if (
      Array.isArray(generation.highlights)
    ) {
      rawHighlights =
        generation.highlights
    }

    const extractedFromText =
      rawHighlights.flatMap((item) => {
        if (
          typeof item !== 'string'
        ) {
          return []
        }

        if (item.length < 50) {
          return [item]
        }

        const extracted: string[] = []

        const areaMatch =
          item.match(
            /(\d+(?:[.,]\d+)?)\s*m[²2]/i,
          )

        if (areaMatch) {
          extracted.push(
            `${areaMatch[1]} m²`,
          )
        }

        const roomsMatch =
          item.match(
            /(\d+)\s*(hab[a-z]*|habitaci[oó]n[a-z]*)/i,
          )

        if (roomsMatch) {
          const count =
            roomsMatch[1]

          extracted.push(
            `${count} ${
              Number(count) === 1
                ? 'habitación'
                : 'habitaciones'
            }`,
          )
        }

        const bathsMatch =
          item.match(
            /(\d+)\s*(ba[nñ]o[s]?)/i,
          )

        if (bathsMatch) {
          const count =
            bathsMatch[1]

          extracted.push(
            `${count} ${
              Number(count) === 1
                ? 'baño'
                : 'baños'
            }`,
          )
        }

        const normalized =
          item.toLocaleLowerCase(
            'es-ES',
          )

        if (
          normalized.includes(
            'piscina',
          )
        ) {
          extracted.push('Piscina')
        }

        if (
          normalized.includes(
            'jardín',
          ) ||
          normalized.includes(
            'jardin',
          )
        ) {
          extracted.push('Jardín')
        }

        if (
          normalized.includes(
            'terraza',
          )
        ) {
          extracted.push('Terraza')
        }

        if (
          normalized.includes(
            'balcón',
          ) ||
          normalized.includes(
            'balcon',
          )
        ) {
          extracted.push('Balcón')
        }

        if (
          normalized.includes(
            'garaje',
          ) ||
          normalized.includes(
            'parking',
          )
        ) {
          extracted.push('Garaje')
        }

        if (
          normalized.includes(
            'trastero',
          )
        ) {
          extracted.push('Trastero')
        }

        if (
          normalized.includes(
            'ascensor',
          )
        ) {
          extracted.push('Ascensor')
        }

        if (
          normalized.includes(
            'aire acondicionado',
          )
        ) {
          extracted.push(
            'Aire acondicionado',
          )
        }

        if (
          normalized.includes(
            'calefacción',
          ) ||
          normalized.includes(
            'calefaccion',
          )
        ) {
          extracted.push(
            'Calefacción',
          )
        }

        return extracted
      })

    currentGenerationHighlights.push(
      ...extractedFromText,
    )

    for (
      const highlight of parseHighlights(
        currentGenerationHighlights,
      )
    ) {
      const normalizedHighlight =
        normalizeText(highlight)

      const alreadyExists =
        highlights.some(
          (existing) =>
            normalizeText(existing) ===
            normalizedHighlight,
        )

      if (
        !alreadyExists
      ) {
        highlights.push(highlight)
      }
    }
  }

  return highlights
}

// ============================================================
// CARACTERÍSTICAS DEL INMUEBLE
// ============================================================

function getPropertyFeaturePills(
  property: PropertyItem,
): string[] {
  return propertyFeatureLabels
    .filter(
      ([field]) =>
        normalizeBoolean(
          property[field],
        ),
    )
    .map(
      ([, label]) => label,
    )
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

  const timestamp =
    new Date(createdAt).getTime()

  return Number.isNaN(timestamp)
    ? 0
    : timestamp
}

// ============================================================
// FILTROS NUMÉRICOS
// ============================================================

function getNumericFilterValue(
  value: string,
): number | null {
  if (
    value.trim() === ''
  ) {
    return null
  }

  const normalized =
    value
      .trim()
      .replace(',', '.')

  const parsed =
    Number(normalized)

  return Number.isFinite(parsed)
    ? parsed
    : null
}

function compareNumericValue(
  propertyValue: unknown,
  filter: NumericFilter,
): boolean {
  const numericPropertyValue =
    getNumericPropertyValue(
      propertyValue,
    )

  if (
    filter.operator === 'range'
  ) {
    const min =
      getNumericFilterValue(
        filter.min,
      )

    const max =
      getNumericFilterValue(
        filter.max,
      )

    if (
      min === null &&
      max === null
    ) {
      return true
    }

    if (
      min !== null &&
      numericPropertyValue < min
    ) {
      return false
    }

    if (
      max !== null &&
      numericPropertyValue > max
    ) {
      return false
    }

    return true
  }

  const value =
    getNumericFilterValue(
      filter.value,
    )

  if (value === null) {
    return true
  }

  switch (filter.operator) {
    case 'lt':
      return (
        numericPropertyValue <
        value
      )

    case 'lte':
      return (
        numericPropertyValue <=
        value
      )

    case 'eq':
      return (
        numericPropertyValue ===
        value
      )

    case 'gte':
      return (
        numericPropertyValue >=
        value
      )

    case 'gt':
      return (
        numericPropertyValue >
        value
      )

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
  if (
    filter.operator === 'range'
  ) {
    return (
      filter.min.trim() !== '' ||
      filter.max.trim() !== ''
    )
  }

  return (
    filter.value.trim() !== ''
  )
}

function hasActiveFilters(
  filters: PropertyFilters,
): boolean {
  return (
    hasActiveNumericFilter(
      filters.price,
    ) ||
    hasActiveNumericFilter(
      filters.area,
    ) ||
    hasActiveNumericFilter(
      filters.bedrooms,
    ) ||
    hasActiveNumericFilter(
      filters.bathrooms,
    ) ||
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

  const [selectedIds, setSelectedIds] =
    useState<Set<string>>(new Set())

  const [currentPage, setCurrentPage] =
    useState(1)

  const itemsPerPage = 6

  const [searchTerm, setSearchTerm] =
    useState('')

  const [sortOption, setSortOption] =
    useState<SortOption>('newest')

  const [isSortMenuOpen, setIsSortMenuOpen] =
    useState(false)

  const [isFilterOpen, setIsFilterOpen] =
    useState(false)

  const [filters, setFilters] =
    useState<PropertyFilters>(
      createDefaultFilters,
    )

  // ==========================================================
  // CARGA
  // ==========================================================

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

  // ==========================================================
  // MODAL DE FILTROS
  // ==========================================================

  useEffect(() => {
    if (!isFilterOpen) {
      document.body.style.overflow = ''
      return
    }

    document.body.style.overflow =
      'hidden'

    return () => {
      document.body.style.overflow = ''
    }
  }, [isFilterOpen])

  // ==========================================================
  // PAGINACIÓN
  // ==========================================================

  useEffect(() => {
    setCurrentPage(1)
  }, [
    searchTerm,
    sortOption,
    filters,
  ])

  useEffect(() => {
    window.scrollTo({
      top: document.documentElement
        .scrollHeight,
      behavior: 'instant',
    })
  }, [currentPage])

  // ==========================================================
  // FILTRADO Y ORDENACIÓN
  // ==========================================================

  const filteredAndSortedProperties =
    useMemo(() => {
      const normalizedSearch =
        searchTerm
          .trim()
          .toLocaleLowerCase('es-ES')

      const filtered =
        properties.filter(
          (property) => {
            // ------------------------------------------------
            // BÚSQUEDA
            // ------------------------------------------------

            if (
              normalizedSearch
            ) {
              const title =
                String(
                  property.title || '',
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

            // ------------------------------------------------
            // FILTROS NUMÉRICOS
            // ------------------------------------------------

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

            // ------------------------------------------------
            // OPERACIÓN
            // ------------------------------------------------

            if (
              filters.operation &&
              normalizeText(
                property.operation,
              ) !==
                normalizeText(
                  filters.operation,
                )
            ) {
              return false
            }

            // ------------------------------------------------
            // TIPO
            // ------------------------------------------------

            if (
              filters.type &&
              normalizeText(
                property.type,
              ) !==
                normalizeText(
                  filters.type,
                )
            ) {
              return false
            }

            // ------------------------------------------------
            // ESTADO
            // ------------------------------------------------

            if (
              filters.condition &&
              normalizeText(
                property.condition,
              ) !==
                normalizeText(
                  filters.condition,
                )
            ) {
              return false
            }

            // ------------------------------------------------
            // CARACTERÍSTICAS
            //
            // IMPORTANTE:
            // usamos normalizeBoolean() para soportar
            // true / false / "true" / "false" / 1 / 0 / etc.
            // ------------------------------------------------

            if (
              filters.pool &&
              !normalizeBoolean(
                property.pool,
              )
            ) {
              return false
            }

            if (
              filters.garden &&
              !normalizeBoolean(
                property.garden,
              )
            ) {
              return false
            }

            if (
              filters.terrace &&
              !normalizeBoolean(
                property.terrace,
              )
            ) {
              return false
            }

            if (
              filters.balcony &&
              !normalizeBoolean(
                property.balcony,
              )
            ) {
              return false
            }

            if (
              filters.garage &&
              !normalizeBoolean(
                property.garage,
              )
            ) {
              return false
            }

            // ------------------------------------------------
            // TRASTERO
            // ------------------------------------------------

            if (
              filters.storageRoom &&
              !normalizeBoolean(
                property.storageRoom,
              )
            ) {
              return false
            }

            if (
              filters.elevator &&
              !normalizeBoolean(
                property.elevator,
              )
            ) {
              return false
            }

            if (
              filters.airConditioning &&
              !normalizeBoolean(
                property.airConditioning,
              )
            ) {
              return false
            }

            if (
              filters.heating &&
              !normalizeBoolean(
                property.heating,
              )
            ) {
              return false
            }

            return true
          },
        )

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
              return (
                getNumericPropertyValue(
                  b.price,
                ) -
                getNumericPropertyValue(
                  a.price,
                )
              )

            case 'cheapest':
              return (
                getNumericPropertyValue(
                  a.price,
                ) -
                getNumericPropertyValue(
                  b.price,
                )
              )

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
    indexOfLastItem -
    itemsPerPage

  const currentProperties =
    filteredAndSortedProperties.slice(
      indexOfFirstItem,
      indexOfLastItem,
    )

  useEffect(() => {
    setCurrentPage(
      (previousPage) =>
        Math.min(
          previousPage,
          totalPages,
        ),
    )
  }, [totalPages])

  // ==========================================================
  // SELECCIÓN
  // ==========================================================

  const currentPageIds = useMemo(
    () =>
      currentProperties.map(
        (property) =>
          property.id,
      ),
    [currentProperties],
  )

  const selectedOnCurrentPage =
    currentPageIds.filter(
      (id) =>
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
      const next =
        new Set(previous)

      if (
        next.has(propertyId)
      ) {
        next.delete(propertyId)
      } else {
        next.add(propertyId)
      }

      return next
    })

    setDeleteError(null)
  }

  const handleToggleCurrentPage =
    () => {
      setSelectedIds((previous) => {
        const next =
          new Set(previous)

        if (
          allCurrentPageSelected
        ) {
          currentPageIds.forEach(
            (id) =>
              next.delete(id),
          )
        } else {
          currentPageIds.forEach(
            (id) =>
              next.add(id),
          )
        }

        return next
      })

      setDeleteError(null)
    }

  const handleNextPage = () => {
    if (
      currentPage < totalPages
    ) {
      setCurrentPage(
        (previous) =>
          previous + 1,
      )
    }
  }

  const handlePrevPage = () => {
    if (
      currentPage > 1
    ) {
      setCurrentPage(
        (previous) =>
          previous - 1,
      )
    }
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
      } catch (
        deleteError
      ) {
        console.error(
          'Error eliminando inmuebles:',
          deleteError,
        )

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
    setFilters(
      createDefaultFilters(),
    )
  }

  const updateNumericFilter = (
    field: NumericFilterField,
    property:
      | 'operator'
      | 'value'
      | 'min'
      | 'max',
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
          ? {
              value: '',
            }
          : {
              min: '',
              max: '',
            }),
      },
    }))
  }

  const toggleBooleanFilter = (
    field: BooleanFilterField,
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

  const numericOperators: [
    NumericOperator,
    string,
  ][] = [
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

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <>
      <div className="max-w-6xl">
        {/* CABECERA */}

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold">
              Inmuebles
            </h1>

            <p className="mt-2 text-muted-foreground">
              Consulta los inmuebles.
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
            {/* ==================================================
                BÚSQUEDA / ORDENACIÓN / FILTROS
                ================================================== */}

            <div className="mt-8 flex flex-col gap-3 rounded-lg border bg-card p-4 lg:flex-row lg:items-center">
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
                      {
                        sortLabels[
                          sortOption
                        ]
                      }
                    </span>

                    <span className="text-xs">
                      ↓
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

                {/* FILTRAR */}

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
                  Filtrar

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

            {/* RESULTADOS */}

            <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span className="font-medium text-foreground">
                  {
                    filteredAndSortedProperties.length
                  }{' '}
                </span>

                {filteredAndSortedProperties.length ===
                1
                  ? 'inmueble encontrado'
                  : 'inmuebles encontrados'}
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
                  Limpiar búsqueda y
                  filtros
                </button>
              )}
            </div>

            {/* SELECCIÓN */}

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

            {/* RESULTADOS */}

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
                  Limpiar búsqueda y
                  filtros
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

                    // ------------------------------------------------
                    // CARACTERÍSTICAS REALES DEL INMUEBLE
                    //
                    // Esto hace que Trastero, Piscina, etc. aparezcan
                    // aunque no estén dentro de "highlights".
                    // ------------------------------------------------

                    const featurePills =
                      getPropertyFeaturePills(
                        property,
                      )

                    // Evitamos duplicar una característica si también
                    // viene dentro de los highlights generados.
                    const normalizedFeatureLabels =
                      new Set(
                        featurePills.map(
                          (feature) =>
                            normalizeText(
                              feature,
                            ),
                        ),
                      )

                    const generalHighlights =
                      highlights.filter(
                        (highlight) =>
                          !normalizedFeatureLabels.has(
                            normalizeText(
                              highlight,
                            ),
                          ),
                      )

                    return (
                      <div
                        key={
                          property.id
                        }
                        className={`relative flex h-full flex-col rounded-lg border bg-card transition ${
                          isSelected
                            ? 'border-primary ring-2 ring-primary/25'
                            : 'border-border'
                        }`}
                      >
                        {/* SELECTOR */}

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

                        {/* CONTENIDO */}

                        <div className="flex flex-1 flex-col p-5">
                          <div>
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <h2 className="mt-1 text-lg font-semibold">
                                  {
                                    property.title
                                  }
                                </h2>
                              </div>

                              <p className="whitespace-nowrap text-lg font-bold">
                                {getNumericPropertyValue(
                                  property.price,
                                ).toLocaleString(
                                  'es-ES',
                                )}{' '}
                                €
                              </p>
                            </div>
                          </div>

                          <div className="mt-4">
                            <div className="flex min-h-21 flex-col justify-end pb-4">
                              <div className="flex flex-wrap items-end gap-2">
                                {/* ==================================================
                                    1. DATOS MÁS RELEVANTES
                                    ================================================== */}

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

                                {/* ==================================================
                                    2. UBICACIÓN
                                    ================================================== */}

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

                                {/* ==================================================
                                    3. CARACTERÍSTICAS REALES
                                    ==================================================
                                    
                                    Aquí está la mejora importante:
                                    Trastero se pinta directamente desde
                                    property.storageRoom.
                                    ================================================== */}

                                {featurePills.map(
                                  (feature) => (
                                    <span
                                      key={
                                        feature
                                      }
                                      className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                                    >
                                      {
                                        feature
                                      }
                                    </span>
                                  ),
                                )}

                                {/* ==================================================
                                    4. HIGHLIGHTS GENERALES
                                    ================================================== */}

                                {generalHighlights
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
                              </div>
                            </div>

                            {/* FECHA + ANUNCIOS */}

                            <div className="flex justify-between border-t pt-4">
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  Anuncios generados
                                </p>

                                <p className="mt-1 text-sm font-medium">
                                  {
                                    generationCount
                                  }{' '}
                                  {generationCount ===
                                  1
                                    ? 'anuncio'
                                    : 'anuncios'}
                                </p>
                              </div>

                              <div>
                                <p className="text-xs text-muted-foreground">
                                  Generado el:
                                </p>

                                <p className="mt-1 text-sm font-medium">
                                  {new Date(
                                    property.createdAt,
                                  ).toLocaleString(
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

            {/* PAGINACIÓN */}

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

      {/* ======================================================
          MODAL DE FILTROS
          ====================================================== */}

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
            {/* CABECERA */}

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
                  setIsFilterOpen(
                    false,
                  )
                }
                aria-label="Cerrar filtros"
                className="rounded-md px-2 py-1 text-xl text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto p-6">
              <div className="grid gap-6 md:grid-cols-2">
                {/* ==================================================
                    FILTROS NUMÉRICOS
                    ================================================== */}

                {(
                  [
                    [
                      'price',
                      'Precio',
                      'Ej. 150000',
                      false,
                    ],
                    [
                      'area',
                      'Superficie (m²)',
                      'Ej. 42',
                      false,
                    ],
                    [
                      'bedrooms',
                      'Habitaciones',
                      'Ej. 3',
                      true,
                    ],
                    [
                      'bathrooms',
                      'Baños',
                      'Ej. 2',
                      true,
                    ],
                  ] as [
                    NumericFilterField,
                    string,
                    string,
                    boolean,
                  ][]
                ).map(
                  ([
                    field,
                    label,
                    placeholder,
                    integer,
                  ]) => {
                    const filter =
                      filters[field]

                    return (
                      <div key={field}>
                        <label className="text-sm font-medium">
                          {label}
                        </label>

                        <div className="mt-2">
                          <select
                            value={
                              filter.operator
                            }
                            onChange={(
                              event,
                            ) =>
                              updateNumericOperator(
                                field,
                                event
                                  .target
                                  .value as NumericOperator,
                              )
                            }
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          >
                            {numericOperators.map(
                              ([
                                value,
                                operatorLabel,
                              ]) => (
                                <option
                                  key={
                                    value
                                  }
                                  value={
                                    value
                                  }
                                >
                                  {
                                    operatorLabel
                                  }
                                </option>
                              ),
                            )}
                          </select>

                          {filter.operator ===
                          'range' ? (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <input
                                type="number"
                                min="0"
                                step={
                                  integer
                                    ? '1'
                                    : undefined
                                }
                                value={
                                  filter.min
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateNumericFilter(
                                    field,
                                    'min',
                                    event
                                      .target
                                      .value,
                                  )
                                }
                                placeholder="Mínimo"
                                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                              />

                              <input
                                type="number"
                                min="0"
                                step={
                                  integer
                                    ? '1'
                                    : undefined
                                }
                                value={
                                  filter.max
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateNumericFilter(
                                    field,
                                    'max',
                                    event
                                      .target
                                      .value,
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
                              step={
                                integer
                                  ? '1'
                                  : undefined
                              }
                              value={
                                filter.value
                              }
                              onChange={(
                                event,
                              ) =>
                                updateNumericFilter(
                                  field,
                                  'value',
                                  event
                                    .target
                                    .value,
                                )
                              }
                              placeholder={
                                placeholder
                              }
                              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                            />
                          )}
                        </div>
                      </div>
                    )
                  },
                )}

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
                      setFilters(
                        (current) => ({
                          ...current,
                          type: event
                            .target
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

                {/* ESTADO */}

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

              {/* ==================================================
                  CARACTERÍSTICAS
                  ================================================== */}

              <div className="mt-7 border-t pt-6">
                <h3 className="text-sm font-semibold">
                  Características
                </h3>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {propertyFeatureLabels.map(
                    ([field, label]) => (
                      <label
                        key={field}
                        className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={
                            filters[field]
                          }
                          onChange={() =>
                            toggleBooleanFilter(
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

              {/* ==================================================
                  RESUMEN DE FILTROS
                  ================================================== */}

              {hasActiveFilters(
                filters,
              ) && (
                <div className="mt-6 rounded-md bg-muted/50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Filtros activos
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(
                      [
                        [
                          'Precio',
                          filters.price,
                          '€',
                        ],
                        [
                          'Superficie',
                          filters.area,
                          'm²',
                        ],
                        [
                          'Habitaciones',
                          filters.bedrooms,
                          '',
                        ],
                        [
                          'Baños',
                          filters.bathrooms,
                          '',
                        ],
                      ] as [
                        string,
                        NumericFilter,
                        string,
                      ][]
                    ).map(
                      ([
                        label,
                        filter,
                        suffix,
                      ]) => {
                        if (
                          !hasActiveNumericFilter(
                            filter,
                          )
                        ) {
                          return null
                        }

                        const text =
                          filter.operator ===
                          'range'
                            ? `${label} entre ${
                                filter.min ||
                                'sin mínimo'
                              } y ${
                                filter.max ||
                                'sin máximo'
                              }${
                                suffix
                                  ? ` ${suffix}`
                                  : ''
                              }`
                            : `${label} ${getOperatorLabel(
                                filter.operator,
                              )} ${
                                filter.value
                              }${
                                suffix
                                  ? ` ${suffix}`
                                  : ''
                              }`

                        return (
                          <span
                            key={label}
                            className="rounded-md bg-background px-2 py-1 text-xs"
                          >
                            {text}
                          </span>
                        )
                      },
                    )}

                    {/* FILTROS BOOLEANOS ACTIVOS */}

                    {propertyFeatureLabels.map(
                      ([
                        field,
                        label,
                      ]) =>
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
                        Operación:{' '}
                        {getPropertyOperation(
                          filters.operation,
                        )}
                      </span>
                    )}

                    {filters.type && (
                      <span className="rounded-md bg-background px-2 py-1 text-xs">
                        Tipo:{' '}
                        {getPropertyTypeLabel(
                          filters.type,
                        )}
                      </span>
                    )}

                    {filters.condition && (
                      <span className="rounded-md bg-background px-2 py-1 text-xs">
                        Estado:{' '}
                        {getPropertyCondition(
                          filters.condition,
                        )}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* PIE */}

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
                  setIsFilterOpen(
                    false,
                  )
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