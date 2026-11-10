
import { formatMoneyAmount } from '@estateforge/shared'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import {
  PROPERTY_COMMERCIAL_STATUSES,
  commercialStatusLabels,
  getCommercialStatusLabel,
} from '@estateforge/shared'

import {
  deleteProperties,
  deleteProperty,
  getProperties,
  updateProperty,
  type PropertyItem,
} from '@/services/propertyService'

import {
  deleteGeneration,
  getGenerations,
  updateGeneration,
  type GenerationItem,
} from '@/services/generationService'

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

const operationLabels: Record<string, string> = {
  sale: 'Venta',
  rent: 'Alquiler',
  transfer: 'Traspaso',
}

const toneLabels: Record<string, string> = {
  professional: 'Profesional',
  luxurious: 'De lujo',
  casual: 'Casual',
  persuasive: 'Persuasivo',
}

const languageLabels: Record<string, string> = {
  español: 'Español',
  english: 'Inglés',
}

/*
 * Traducción de los estados internos del inmueble
 * al texto que se muestra en el Dashboard.
 */
const conditionLabels: Record<string, string> = {
  new: 'Nuevo',
  good: 'Buen estado',
  renovated: 'Reformado',
  'needs-renovation': 'A reformar',
}

function capitalizeFirstLetter(value: string): string {
  if (!value) return value

  return value.charAt(0).toUpperCase() + value.slice(1)
}

function getPropertyTypeLabel(
  type: string | undefined,
): string {
  if (!type) return 'No indicado'

  return (
    propertyTypeLabels[type.toLowerCase()] ||
    capitalizeFirstLetter(type)
  )
}

function getOperationLabel(
  operation: string | undefined,
): string {
  if (!operation) return 'No indicada'

  return (
    operationLabels[operation.toLowerCase()] ||
    capitalizeFirstLetter(operation)
  )
}

function getToneLabel(
  tone: string | undefined,
): string {
  if (!tone) return 'No indicado'

  return (
    toneLabels[tone.toLowerCase()] ||
    capitalizeFirstLetter(tone)
  )
}

function getLanguageLabel(
  language: string | undefined,
): string {
  if (!language) return 'No indicado'

  return (
    languageLabels[language.toLowerCase()] ||
    capitalizeFirstLetter(language)
  )
}

/*
 * Traduce el estado del inmueble al español y,
 * si llega un valor desconocido, lo muestra con
 * la primera letra en mayúscula.
 */
function getConditionLabel(
  condition: string | undefined,
): string {
  if (!condition) return 'No indicado'

  const normalizedCondition =
    condition.trim().toLowerCase()

  return (
    conditionLabels[normalizedCondition] ||
    capitalizeFirstLetter(condition.trim())
  )
}

/*
 * Los providers se muestran siempre con la primera
 * letra en mayúscula sin modificar el valor original.
 */
function getProviderLabel(
  provider: string | undefined,
): string {
  if (!provider) return 'No indicado'

  return capitalizeFirstLetter(provider.trim())
}

function formatLocationLabel(
  value: string | undefined,
): string {
  if (!value) return 'No indicado'

  return capitalizeFirstLetter(value.trim())
}

function formatGenerationDate(
  value: string | Date | undefined,
): string {
  if (!value) return 'Fecha no disponible'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Fecha no disponible'
  }

  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
      return highlights
        .split('\n')
        .map((item) =>
          item.replace(/^[-•*]\s*/, '').trim(),
        )
        .filter(Boolean)
    }
  }

  return []
}

function DashboardPage() {
  const [properties, setProperties] = useState<
    PropertyItem[]
  >([])

  const [generations, setGenerations] = useState<
    GenerationItem[]
  >([])

  const [loading, setLoading] = useState(true)

  const [error, setError] =
    useState<string | null>(null)

  /*
   * ID del inmueble que actualmente estamos editando.
   */
  const [editingPropertyId, setEditingPropertyId] =
    useState<string | null>(null)

  /*
   * ID del anuncio que actualmente estamos editando.
   */
  const [editingGenerationId, setEditingGenerationId] =
    useState<string | null>(null)

  const [savingPropertyId, setSavingPropertyId] =
    useState<string | null>(null)

  const [savingGenerationId, setSavingGenerationId] =
    useState<string | null>(null)

  const [deletingPropertyId, setDeletingPropertyId] =
    useState<string | null>(null)

  const [deletingGenerationId, setDeletingGenerationId] =
    useState<string | null>(null)

  /*
   * Indica si se está realizando un borrado grupal
   * de inmuebles.
   */
  const [deletingProperties, setDeletingProperties] =
    useState(false)

  /*
   * Indica si se está realizando un borrado grupal
   * de anuncios.
   */
  const [deletingGenerations, setDeletingGenerations] =
    useState(false)

  /*
   * IDs de inmuebles seleccionados para borrado grupal.
   */
  const [selectedPropertyIds, setSelectedPropertyIds] =
    useState<Set<string>>(new Set())

  /*
   * IDs de anuncios seleccionados para borrado grupal.
   */
  const [selectedGenerationIds, setSelectedGenerationIds] =
    useState<Set<string>>(new Set())

  const [actionError, setActionError] =
    useState<string | null>(null)

  /*
   * Estado temporal del formulario de inmueble.
   */
  const [propertyForm, setPropertyForm] = useState({
    title: '',
    operation: '',
    type: '',
    price: '',
    address: '',
    city: '',
    neighborhood: '',
    area: '',
    bedrooms: '',
    bathrooms: '',
    floor: '',
    condition: '',
    commercialStatus: '',
    additionalInformation: '',
    elevator: false,
    terrace: false,
    balcony: false,
    garage: false,
    storageRoom: false,
    pool: false,
    garden: false,
    airConditioning: false,
    heating: false,
  })

  /*
   * Estado temporal del formulario de anuncio.
   */
  const [generationForm, setGenerationForm] =
    useState({
      title: '',
      description: '',
      highlights: '',
      callToAction: '',
    })

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [
          propertiesResult,
          generationsResult,
        ] = await Promise.all([
          getProperties(),
          getGenerations(),
        ])

        setProperties(propertiesResult)
        setGenerations(generationsResult)
      } catch (loadError) {
        console.error(
          'Error cargando Dashboard:',
          loadError,
        )

        setError(
          'No se han podido cargar los datos del Dashboard.',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadDashboard()
  }, [])

  /*
   * Los listados del Dashboard muestran únicamente
   * los 5 elementos más recientes.
   */
  const recentProperties =
    properties.slice(0, 5)

  const recentGenerations =
    generations.slice(0, 5)

  /*
   * IDs de los inmuebles que aparecen actualmente
   * en la sección de recientes.
   */
  const recentPropertyIds =
    recentProperties.map(
      (property) => property.id,
    )

  /*
   * IDs de los anuncios que aparecen actualmente
   * en la sección de recientes.
   */
  const recentGenerationIds =
    recentGenerations.map(
      (generation) => generation.id,
    )

  /*
   * Estado de selección de inmuebles.
   */
  const selectedRecentPropertyCount =
    recentPropertyIds.filter((id) =>
      selectedPropertyIds.has(id),
    ).length

  const allRecentPropertiesSelected =
    recentPropertyIds.length > 0 &&
    selectedRecentPropertyCount ===
      recentPropertyIds.length

  const someRecentPropertiesSelected =
    selectedRecentPropertyCount > 0 &&
    !allRecentPropertiesSelected

  /*
   * Estado de selección de anuncios.
   */
  const selectedRecentGenerationCount =
    recentGenerationIds.filter((id) =>
      selectedGenerationIds.has(id),
    ).length

  const allRecentGenerationsSelected =
    recentGenerationIds.length > 0 &&
    selectedRecentGenerationCount ===
      recentGenerationIds.length

  const someRecentGenerationsSelected =
    selectedRecentGenerationCount > 0 &&
    !allRecentGenerationsSelected

  /*
   * Abre el editor de un inmueble.
   */
  function handleStartEditProperty(
    property: PropertyItem,
  ) {
    setActionError(null)
    setEditingGenerationId(null)

    setPropertyForm({
      title: property.title ?? '',
      operation: property.operation ?? '',
      type: property.type ?? '',
      price:
        property.price !== undefined
          ? String(property.price)
          : '',
      address: property.address ?? '',
      city: property.city ?? '',
      neighborhood:
        property.neighborhood ?? '',
      area:
        property.area !== undefined
          ? String(property.area)
          : '',
      bedrooms:
        property.bedrooms !== undefined
          ? String(property.bedrooms)
          : '',
      bathrooms:
        property.bathrooms !== undefined
          ? String(property.bathrooms)
          : '',
      floor:
        property.floor !== undefined &&
        property.floor !== null
          ? String(property.floor)
          : '',
      condition: property.condition ?? '',
      commercialStatus:
        property.commercialStatus ?? '',
      additionalInformation:
        property.additionalInformation ?? '',

      elevator: Boolean(property.elevator),
      terrace: Boolean(property.terrace),
      balcony: Boolean(property.balcony),
      garage: Boolean(property.garage),

      storageRoom: Boolean(property.storageRoom),

      pool: Boolean(property.pool),
      garden: Boolean(property.garden),
      airConditioning: Boolean(
        property.airConditioning,
      ),
      heating: Boolean(property.heating),
    })

    setEditingPropertyId(property.id)
  }

  /*
   * Cancela la edición del inmueble.
   */
  function handleCancelEditProperty() {
    if (savingPropertyId) {
      return
    }

    setEditingPropertyId(null)
    setActionError(null)
  }

  /*
   * Guarda los cambios del inmueble.
   */
  async function handleSaveProperty(
    propertyId: string,
  ) {
    if (savingPropertyId) {
      return
    }

    setSavingPropertyId(propertyId)
    setActionError(null)

    try {
      const updatedProperty =
        await updateProperty(propertyId, {
          title: propertyForm.title.trim(),
          operation: propertyForm.operation,
          type: propertyForm.type,
          price: propertyForm.price,
          address: propertyForm.address,
          city: propertyForm.city,
          neighborhood:
            propertyForm.neighborhood,
          area: Number(propertyForm.area),
          bedrooms: Number(propertyForm.bedrooms),
          bathrooms: Number(
            propertyForm.bathrooms,
          ),
          floor:
            propertyForm.floor.trim() === ''
              ? null
              : Number(propertyForm.floor),
          condition: propertyForm.condition,
          commercialStatus:
            propertyForm.commercialStatus ||
            undefined,
          additionalInformation:
            propertyForm.additionalInformation,

          elevator: propertyForm.elevator,
          terrace: propertyForm.terrace,
          balcony: propertyForm.balcony,
          garage: propertyForm.garage,

          storageRoom: propertyForm.storageRoom,

          pool: propertyForm.pool,
          garden: propertyForm.garden,
          airConditioning:
            propertyForm.airConditioning,
          heating: propertyForm.heating,
        })

      setProperties((currentProperties) =>
        currentProperties.map((property) =>
          property.id === propertyId
            ? updatedProperty
            : property,
        ),
      )

      /*
       * También actualizamos el inmueble que aparece
       * asociado a los anuncios del Dashboard.
       */
      setGenerations((currentGenerations) =>
        currentGenerations.map((generation) =>
          generation.propertyId === propertyId
            ? {
                ...generation,
                property: {
                  ...generation.property,
                  title:
                    updatedProperty.title,
                  operation:
                    updatedProperty.operation,
                  type:
                    updatedProperty.type,
                  price:
                    updatedProperty.price,
                  address:
                    updatedProperty.address ?? '',
                  city:
                    updatedProperty.city,
                  neighborhood:
                    updatedProperty.neighborhood ??
                    '',
                  area:
                    updatedProperty.area,
                  bedrooms:
                    updatedProperty.bedrooms,
                  bathrooms:
                    updatedProperty.bathrooms,
                },
              }
            : generation,
        ),
      )

      setEditingPropertyId(null)
    } catch (saveError) {
      console.error(
        'Error actualizando inmueble:',
        saveError,
      )

      setActionError(
        'No se ha podido guardar el inmueble.',
      )
    } finally {
      setSavingPropertyId(null)
    }
  }

  /*
   * Selecciona/deselecciona un inmueble.
   */
  function handleToggleProperty(
    propertyId: string,
  ) {
    setSelectedPropertyIds((current) => {
      const next = new Set(current)

      if (next.has(propertyId)) {
        next.delete(propertyId)
      } else {
        next.add(propertyId)
      }

      return next
    })

    setActionError(null)
  }

  /*
   * Selecciona/deselecciona todos los inmuebles
   * visibles en la sección de recientes.
   */
  function handleToggleAllProperties() {
    setSelectedPropertyIds((current) => {
      const next = new Set(current)

      if (allRecentPropertiesSelected) {
        recentPropertyIds.forEach((id) => {
          next.delete(id)
        })
      } else {
        recentPropertyIds.forEach((id) => {
          next.add(id)
        })
      }

      return next
    })

    setActionError(null)
  }

  /*
   * Elimina un inmueble individualmente.
   */
  async function handleDeleteProperty(
    propertyId: string,
  ) {
    if (
      deletingPropertyId ||
      deletingProperties
    ) {
      return
    }

    const confirmed = window.confirm(
      '¿Seguro que quieres eliminar este inmueble? También se eliminarán sus anuncios generados.',
    )

    if (!confirmed) {
      return
    }

    setDeletingPropertyId(propertyId)
    setActionError(null)

    try {
      await deleteProperty(propertyId)

      setProperties((currentProperties) =>
        currentProperties.filter(
          (property) =>
            property.id !== propertyId,
        ),
      )

      setGenerations((currentGenerations) =>
        currentGenerations.filter(
          (generation) =>
            generation.propertyId !==
            propertyId,
        ),
      )

      setSelectedPropertyIds((current) => {
        const next = new Set(current)
        next.delete(propertyId)
        return next
      })

      setSelectedGenerationIds(
        (current) => {
          const next = new Set(current)

          generations
            .filter(
              (generation) =>
                generation.propertyId ===
                propertyId,
            )
            .forEach((generation) => {
              next.delete(generation.id)
            })

          return next
        },
      )

      if (
        editingPropertyId === propertyId
      ) {
        setEditingPropertyId(null)
      }
    } catch (deleteError) {
      console.error(
        'Error eliminando inmueble:',
        deleteError,
      )

      setActionError(
        'No se ha podido eliminar el inmueble.',
      )
    } finally {
      setDeletingPropertyId(null)
    }
  }

  /*
   * Borrado grupal de inmuebles.
   */
  async function handleDeleteSelectedProperties() {
    if (
      selectedPropertyIds.size === 0 ||
      deletingProperties ||
      deletingGenerations
    ) {
      return
    }

    const selectedIds =
      Array.from(selectedPropertyIds)

    const count = selectedIds.length

    const confirmed = window.confirm(
      `¿Seguro que quieres eliminar ${count} ${
        count === 1
          ? 'inmueble'
          : 'inmuebles'
      } seleccionados? También se eliminarán todos sus anuncios generados asociados.`,
    )

    if (!confirmed) {
      return
    }

    setDeletingProperties(true)
    setActionError(null)

    try {
      await deleteProperties(selectedIds)

      const deletedPropertyIdSet =
        new Set(selectedIds)

      const deletedGenerationIds =
        generations
          .filter((generation) =>
            deletedPropertyIdSet.has(
              generation.propertyId,
            ),
          )
          .map(
            (generation) =>
              generation.id,
          )

      setProperties((currentProperties) =>
        currentProperties.filter(
          (property) =>
            !deletedPropertyIdSet.has(
              property.id,
            ),
        ),
      )

      setGenerations((currentGenerations) =>
        currentGenerations.filter(
          (generation) =>
            !deletedPropertyIdSet.has(
              generation.propertyId,
            ),
        ),
      )

      setSelectedPropertyIds(new Set())

      setSelectedGenerationIds(
        (current) => {
          const next = new Set(current)

          deletedGenerationIds.forEach(
            (generationId) => {
              next.delete(generationId)
            },
          )

          return next
        },
      )

      if (
        editingPropertyId &&
        deletedPropertyIdSet.has(
          editingPropertyId,
        )
      ) {
        setEditingPropertyId(null)
      }

      if (
        editingGenerationId &&
        deletedGenerationIds.includes(
          editingGenerationId,
        )
      ) {
        setEditingGenerationId(null)
      }
    } catch (deleteError) {
      console.error(
        'Error eliminando inmuebles seleccionados:',
        deleteError,
      )

      setActionError(
        'No se han podido eliminar los inmuebles seleccionados.',
      )
    } finally {
      setDeletingProperties(false)
    }
  }

  /*
   * Abre el editor de un anuncio.
   */
  function handleStartEditGeneration(
    generation: GenerationItem,
  ) {
    setActionError(null)
    setEditingPropertyId(null)

    const highlights =
      parseHighlights(generation.highlights)

    setGenerationForm({
      title: generation.title ?? '',
      description:
        generation.description ?? '',
      highlights: highlights.join('\n'),
      callToAction:
        generation.callToAction ?? '',
    })

    setEditingGenerationId(
      generation.id,
    )
  }

  /*
   * Cancela la edición del anuncio.
   */
  function handleCancelEditGeneration() {
    if (savingGenerationId) {
      return
    }

    setEditingGenerationId(null)
    setActionError(null)
  }

  /*
   * Guarda los cambios del anuncio.
   */
  async function handleSaveGeneration(
    generationId: string,
  ) {
    if (savingGenerationId) {
      return
    }

    setSavingGenerationId(generationId)
    setActionError(null)

    try {
      const highlights =
        generationForm.highlights
          .split('\n')
          .map((item) =>
            item
              .replace(
                /^[-•*]\s*/,
                '',
              )
              .trim(),
          )
          .filter(Boolean)

      const updatedGeneration =
        await updateGeneration(
          generationId,
          {
            title:
              generationForm.title.trim(),
            description:
              generationForm.description,
            highlights,
            callToAction:
              generationForm.callToAction,
          },
        )

      setGenerations(
        (currentGenerations) =>
          currentGenerations.map(
            (generation) =>
              generation.id ===
                generationId
                ? updatedGeneration
                : generation,
          ),
      )

      setEditingGenerationId(null)
    } catch (saveError) {
      console.error(
        'Error actualizando anuncio:',
        saveError,
      )

      setActionError(
        'No se ha podido guardar el anuncio.',
      )
    } finally {
      setSavingGenerationId(null)
    }
  }

  /*
   * Selecciona/deselecciona un anuncio.
   */
  function handleToggleGeneration(
    generationId: string,
  ) {
    setSelectedGenerationIds((current) => {
      const next = new Set(current)

      if (next.has(generationId)) {
        next.delete(generationId)
      } else {
        next.add(generationId)
      }

      return next
    })

    setActionError(null)
  }

  /*
   * Selecciona/deselecciona todos los anuncios
   * visibles en la sección de recientes.
   */
  function handleToggleAllGenerations() {
    setSelectedGenerationIds((current) => {
      const next = new Set(current)

      if (allRecentGenerationsSelected) {
        recentGenerationIds.forEach((id) => {
          next.delete(id)
        })
      } else {
        recentGenerationIds.forEach((id) => {
          next.add(id)
        })
      }

      return next
    })

    setActionError(null)
  }

  /*
   * Elimina un anuncio individualmente.
   */
  async function handleDeleteGeneration(
    generationId: string,
  ) {
    if (
      deletingGenerationId ||
      deletingGenerations
    ) {
      return
    }

    const confirmed = window.confirm(
      '¿Seguro que quieres eliminar este anuncio generado?',
    )

    if (!confirmed) {
      return
    }

    setDeletingGenerationId(generationId)
    setActionError(null)

    try {
      await deleteGeneration(
        generationId,
      )

      setGenerations(
        (currentGenerations) =>
          currentGenerations.filter(
            (generation) =>
              generation.id !==
              generationId,
          ),
      )

      setSelectedGenerationIds(
        (current) => {
          const next = new Set(current)
          next.delete(generationId)
          return next
        },
      )

      if (
        editingGenerationId ===
        generationId
      ) {
        setEditingGenerationId(null)
      }

      /*
       * Actualizamos también el contador de anuncios
       * del inmueble correspondiente.
       */
      setProperties(
        (currentProperties) =>
          currentProperties.map(
            (property) =>
              property.generations?.some(
                (generation) =>
                  generation.id ===
                  generationId,
              )
                ? {
                    ...property,
                    generations:
                      property.generations.filter(
                        (generation) =>
                          generation.id !==
                          generationId,
                      ),
                  }
                : property,
          ),
      )
    } catch (deleteError) {
      console.error(
        'Error eliminando anuncio:',
        deleteError,
      )

      setActionError(
        'No se ha podido eliminar el anuncio.',
      )
    } finally {
      setDeletingGenerationId(null)
    }
  }

  /*
   * Borrado grupal de anuncios.
   */
  async function handleDeleteSelectedGenerations() {
    if (
      selectedGenerationIds.size === 0 ||
      deletingGenerations ||
      deletingProperties
    ) {
      return
    }

    const selectedIds =
      Array.from(selectedGenerationIds)

    const count = selectedIds.length

    const confirmed = window.confirm(
      `¿Seguro que quieres eliminar ${count} ${
        count === 1
          ? 'anuncio'
          : 'anuncios'
      } seleccionados? Los inmuebles asociados no se eliminarán.`,
    )

    if (!confirmed) {
      return
    }

    setDeletingGenerations(true)
    setActionError(null)

    try {
      await Promise.all(
        selectedIds.map((generationId) =>
          deleteGeneration(generationId),
        ),
      )

      const deletedGenerationIdSet =
        new Set(selectedIds)

      setGenerations(
        (currentGenerations) =>
          currentGenerations.filter(
            (generation) =>
              !deletedGenerationIdSet.has(
                generation.id,
              ),
          ),
      )

      setSelectedGenerationIds(new Set())

      setProperties(
        (currentProperties) =>
          currentProperties.map(
            (property) => {
              if (
                !property.generations?.some(
                  (generation) =>
                    deletedGenerationIdSet.has(
                      generation.id,
                    ),
                )
              ) {
                return property
              }

              return {
                ...property,
                generations:
                  property.generations.filter(
                    (generation) =>
                      !deletedGenerationIdSet.has(
                        generation.id,
                      ),
                  ),
              }
            },
          ),
      )

      if (
        editingGenerationId &&
        deletedGenerationIdSet.has(
          editingGenerationId,
        )
      ) {
        setEditingGenerationId(null)
      }
    } catch (deleteError) {
      console.error(
        'Error eliminando anuncios seleccionados:',
        deleteError,
      )

      setActionError(
        'No se han podido eliminar los anuncios seleccionados.',
      )
    } finally {
      setDeletingGenerations(false)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Dashboard
        </h1>

        <p className="mt-4 text-muted-foreground">
          Cargando dashboard...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Dashboard
        </h1>

        <p className="mt-4 text-destructive">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            Dashboard
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Consulta información general y gestiona tus inmuebles y anuncios generados más recientes desde 
            un único lugar.
          </p>
        </div>

        <Link
          to="/inmuebles/nuevo"
          className="inline-flex min-h-11 w-fit items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Crear inmueble
        </Link>
      </div>

      {actionError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* =====================================================
          RESUMEN
          ===================================================== */}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-card p-5 shadow-sm transition hover:shadow-md">
          <p className="text-sm font-medium text-muted-foreground">
            Inmuebles
          </p>

          <p className="mt-2 text-3xl font-bold tracking-tight">
            {properties.length}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm transition hover:shadow-md">
          <p className="text-sm text-muted-foreground">
            Anuncios generados
          </p>

          <p className="mt-2 text-3xl font-bold tracking-tight">
            {generations.length}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm transition hover:shadow-md">
          <p className="text-sm text-muted-foreground">
            Ventas
          </p>

          <p className="mt-2 text-3xl font-bold tracking-tight">
            {
              properties.filter(
                (property) =>
                  property.operation
                    .toLowerCase() ===
                  'sale',
              ).length
            }
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm transition hover:shadow-md">
          <p className="text-sm text-muted-foreground">
            Alquileres
          </p>

          <p className="mt-2 text-3xl font-bold tracking-tight">
            {
              properties.filter(
                (property) =>
                  property.operation
                    .toLowerCase() ===
                  'rent',
              ).length
            }
          </p>
        </div>
      </div>

      {/* =====================================================
          INMUEBLES RECIENTES
          ===================================================== */}

      <section className="mt-12">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Inmuebles recientes
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Últimos inmuebles registrados.
            </p>
          </div>

          <Link
            to="/inmuebles"
            className="rounded-md px-2 py-1 text-sm font-semibold text-primary transition hover:bg-primary/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Ver todos los inmuebles
          </Link>
        </div>

        {recentProperties.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed bg-card/50 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Todavía no hay inmuebles.
            </p>
          </div>
        ) : (
          <>
            {/* Barra de selección de inmuebles */}
            <div className="mt-5 flex flex-col justify-between gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="dashboard-select-properties"
                  checked={
                    allRecentPropertiesSelected
                  }
                  ref={(element) => {
                    if (element) {
                      element.indeterminate =
                        someRecentPropertiesSelected
                    }
                  }}
                  onChange={
                    handleToggleAllProperties
                  }
                  disabled={
                    deletingProperties ||
                    deletingGenerations ||
                    Boolean(deletingPropertyId)
                  }
                  className="h-4 w-4 cursor-pointer"
                />

                <label
                  htmlFor="dashboard-select-properties"
                  className="cursor-pointer text-sm font-medium"
                >
                  Seleccionar todos los inmuebles
                  visibles
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {selectedPropertyIds.size}{' '}
                  {selectedPropertyIds.size === 1
                    ? 'inmueble seleccionado'
                    : 'inmuebles seleccionados'}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    void handleDeleteSelectedProperties()
                  }
                  disabled={
                    deletingProperties ||
                    deletingGenerations ||
                    Boolean(deletingPropertyId) ||
                    selectedPropertyIds.size === 0
                  }
                  aria-hidden={
                    selectedPropertyIds.size === 0
                  }
                  tabIndex={
                    selectedPropertyIds.size === 0
                      ? -1
                      : 0
                  }
                  className={`rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 ${
                    selectedPropertyIds.size > 0
                      ? 'visible'
                      : 'invisible pointer-events-none'
                  }`}
                >
                  {deletingProperties
                    ? 'Eliminando...'
                    : `Eliminar inmuebles seleccionados (${selectedPropertyIds.size})`}
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {recentProperties.map(
                (property) => {
                  const isEditing =
                    editingPropertyId ===
                    property.id

                  const isSaving =
                    savingPropertyId ===
                    property.id

                  const isDeleting =
                    deletingPropertyId ===
                    property.id

                  const isSelected =
                    selectedPropertyIds.has(
                      property.id,
                    )

                  return (
                    <div
                      key={property.id}
                      className={`overflow-hidden rounded-xl border bg-card shadow-sm transition ${
                        isSelected
                          ? 'border-primary ring-2 ring-primary/20'
                          : ''
                      }`}
                    >
                      {!isEditing ? (
                        <>
                          {/* Selector superior */}
                          <div className="group relative w-full overflow-hidden rounded-t-lg">
                            <button
                              type="button"
                              onClick={() =>
                                handleToggleProperty(
                                  property.id,
                                )
                              }
                              disabled={
                                deletingProperties ||
                                deletingGenerations ||
                                isDeleting
                              }
                              aria-pressed={
                                isSelected
                              }
                              className={`block h-11 w-full cursor-pointer border-0 border-b p-0 text-xs font-semibold transition-colors hover:bg-primary hover:text-primary-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                                isSelected
                                  ? 'bg-foreground font-semibold text-background'
                                  : 'bg-accent text-muted-foreground'
                              }`}
                            >
                              {isSelected
                                ? '✓ Seleccionado'
                                : 'Seleccionar'}
                            </button>
                          </div>

                          {/* Contenido del inmueble */}
                          <div className="p-5">
                            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                              <div className="min-w-0">
                                <h3 className="text-lg font-semibold">
                                  {property.title ||
                                    'Inmueble sin título'}
                                </h3>
                              </div>

                              <p className="whitespace-nowrap text-lg font-bold">
                                {formatMoneyAmount(property.price)}{' '}
                                €
                              </p>
                            </div>

                            {/* =================================================
                                PÍLDORAS DEL INMUEBLE
                                ================================================= */}
                            <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {getOperationLabel(
                                  property.operation,
                                )}
                              </span>

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {getPropertyTypeLabel(
                                  property.type,
                                )}
                              </span>

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {getCommercialStatusLabel(
                                  property.commercialStatus,
                                )}
                              </span>

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {getConditionLabel(
                                  property.condition,
                                )}
                              </span>

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {formatLocationLabel(
                                  property.city,
                                )}
                              </span>

                              {property.neighborhood && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  {formatLocationLabel(
                                    property.neighborhood,
                                  )}
                                </span>
                              )}

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {property.area} m²
                              </span>

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {property.address}
                              </span>

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {property.bedrooms}{' '}
                                habitaciones
                              </span>

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {property.bathrooms}{' '}
                                baños
                              </span>

                              {property.elevator && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  Ascensor
                                </span>
                              )}

                              {property.terrace && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  Terraza
                                </span>
                              )}

                              {property.balcony && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  Balcón
                                </span>
                              )}

                              {property.garage && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  Garaje
                                </span>
                              )}

                              {property.storageRoom && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  Trastero
                                </span>
                              )}

                              {property.pool && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  Piscina
                                </span>
                              )}

                              {property.garden && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  Jardín
                                </span>
                              )}

                              {property.airConditioning && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  Aire acondicionado
                                </span>
                              )}

                              {property.heating && (
                                <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  Calefacción
                                </span>
                              )}

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                Generado el{' '}
                                {formatGenerationDate(
                                  property.createdAt,
                                )}
                              </span>

                              <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {property.generations
                                  ?.length ??
                                  0}{' '}
                                anuncios
                              </span>
                            </div>
                          </div>

                          {/* Acciones inferiores */}
                          <div className="grid grid-cols-3 border-t">
                            <Link
                              to={`/inmuebles/${property.id}`}
                              className="flex min-h-11 items-center justify-center border-r border-border text-sm font-medium transition-colors hover:bg-primary hover:text-primary-foreground"
                            >
                              Ver
                            </Link>

                            <button
                              type="button"
                              onClick={() =>
                                handleStartEditProperty(
                                  property,
                                )
                              }
                              disabled={
                                isDeleting ||
                                deletingProperties ||
                                deletingGenerations
                              }
                              className="flex min-h-11 items-center justify-center border-r text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Editar
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void handleDeleteProperty(
                                  property.id,
                                )
                              }
                              disabled={
                                isDeleting ||
                                deletingProperties ||
                                deletingGenerations
                              }
                              className="flex min-h-11 items-center justify-center text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isDeleting
                                ? 'Eliminando...'
                                : 'Eliminar'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="p-6">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <h3 className="text-lg font-semibold">
                                Editar inmueble
                              </h3>

                              <p className="mt-1 text-sm text-muted-foreground">
                                Modifica los datos
                                directamente desde
                                el Dashboard.
                              </p>
                            </div>
                          </div>

                          <div className="mt-6 grid gap-4 md:grid-cols-2">
                            <div>
                              <label
                                htmlFor={`property-title-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Título
                              </label>

                              <input
                                id={`property-title-${property.id}`}
                                value={
                                  propertyForm.title
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      title:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`property-price-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Precio (€)
                              </label>

                              <input
                                id={`property-price-${property.id}`}
                                type="number"
                                value={
                                  propertyForm.price
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      price:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`property-operation-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Operación
                              </label>

                              <select
                                id={`property-operation-${property.id}`}
                                value={
                                  propertyForm.operation
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      operation:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              >
                                <option value="sale">
                                  Venta
                                </option>

                                <option value="rent">
                                  Alquiler
                                </option>

                                <option value="transfer">
                                  Traspaso
                                </option>
                              </select>
                            </div>

                            <div>
                              <label
                                htmlFor={`property-type-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Tipo
                              </label>

                              <select
                                id={`property-type-${property.id}`}
                                value={
                                  propertyForm.type
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      type:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              >
                                <option value="apartment">
                                  Apartamento
                                </option>

                                <option value="house">
                                  Casa
                                </option>

                                <option value="villa">
                                  Chalet
                                </option>

                                <option value="penthouse">
                                  Ático
                                </option>

                                <option value="duplex">
                                  Dúplex
                                </option>

                                <option value="studio">
                                  Estudio
                                </option>

                                <option value="commercial">
                                  Local comercial
                                </option>

                                <option value="office">
                                  Oficina
                                </option>

                                <option value="land">
                                  Terreno
                                </option>
                              </select>
                            </div>

                            <div>
                              <label
                                htmlFor={`property-area-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Superficie
                                (m²)
                              </label>

                              <input
                                id={`property-area-${property.id}`}
                                type="number"
                                value={
                                  propertyForm.area
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      area:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`property-bedrooms-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Habitaciones
                              </label>

                              <input
                                id={`property-bedrooms-${property.id}`}
                                type="number"
                                value={
                                  propertyForm.bedrooms
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      bedrooms:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`property-bathrooms-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Baños
                              </label>

                              <input
                                id={`property-bathrooms-${property.id}`}
                                type="number"
                                value={
                                  propertyForm.bathrooms
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      bathrooms:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`property-floor-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Planta
                              </label>

                              <input
                                id={`property-floor-${property.id}`}
                                type="number"
                                value={
                                  propertyForm.floor
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      floor:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`property-commercial-status-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Estado
                              </label>

                              <select
                                id={`property-commercial-status-${property.id}`}
                                value={
                                  propertyForm.commercialStatus
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      commercialStatus:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              >
                                <option
                                  value=""
                                  disabled={Boolean(
                                    property.commercialStatus,
                                  )}
                                >
                                  Sin indicar
                                </option>

                                {PROPERTY_COMMERCIAL_STATUSES.map(
                                  (status) => (
                                    <option
                                      key={status}
                                      value={status}
                                    >
                                      {commercialStatusLabels[status]}
                                    </option>
                                  ),
                                )}
                              </select>
                            </div>

                            <div>
                              <label
                                htmlFor={`property-condition-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Conservación
                              </label>

                              <select
                                id={`property-condition-${property.id}`}
                                value={
                                  propertyForm.condition
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      condition:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              >
                                <option value="new">
                                  Nuevo
                                </option>

                                <option value="good">
                                  Buen estado
                                </option>

                                <option value="renovated">
                                  Reformado
                                </option>

                                <option value="needs-renovation">
                                  A reformar
                                </option>
                              </select>
                            </div>

                            <div>
                              <label
                                htmlFor={`property-address-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Dirección
                              </label>

                              <input
                                id={`property-address-${property.id}`}
                                value={
                                  propertyForm.address
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      address:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`property-city-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Ciudad
                              </label>

                              <input
                                id={`property-city-${property.id}`}
                                value={
                                  propertyForm.city
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      city:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`property-neighborhood-${property.id}`}
                                className="text-sm font-medium"
                              >
                                Zona
                              </label>

                              <input
                                id={`property-neighborhood-${property.id}`}
                                value={
                                  propertyForm.neighborhood
                                }
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      neighborhood:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>
                          </div>

                          <div className="mt-5">
                            <label
                              htmlFor={`property-additional-${property.id}`}
                              className="text-sm font-medium"
                            >
                              Información
                              adicional
                            </label>

                            <textarea
                              id={`property-additional-${property.id}`}
                              rows={5}
                              value={
                                propertyForm.additionalInformation
                              }
                              onChange={(event) =>
                                setPropertyForm(
                                  (current) => ({
                                    ...current,
                                    additionalInformation:
                                      event
                                        .target
                                        .value,
                                  }),
                                )
                              }
                              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                            />
                          </div>

                          <section className="mt-7 border-t pt-6">
                            <h2 className="text-lg font-semibold">
                              Características
                            </h2>

                            <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                              {[
                                ['elevator', 'Ascensor'],
                                ['terrace', 'Terraza'],
                                ['balcony', 'Balcón'],
                                ['garage', 'Garaje'],
                                ['storageRoom', 'Trastero'],
                                ['pool', 'Piscina'],
                                ['garden', 'Jardín'],
                                [
                                  'airConditioning',
                                  'Aire acondicionado',
                                ],
                                ['heating', 'Calefacción'],
                              ].map(
                                ([field, label]) => (
                                  <label
                                    key={field}
                                    className="flex items-center gap-3 rounded-md border p-3"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={
                                        propertyForm[
                                          field as keyof typeof propertyForm
                                        ] as boolean
                                      }
                                      onChange={(
                                        event,
                                      ) =>
                                        setPropertyForm(
                                          (
                                            current,
                                          ) => ({
                                            ...current,
                                            [field]:
                                              event
                                                .target
                                                .checked,
                                          }),
                                        )
                                      }
                                    />

                                    <span className="text-sm">
                                      {label}
                                    </span>
                                  </label>
                                ),
                              )}
                            </div>
                          </section>

                          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t pt-4">
                            <button
                              type="button"
                              onClick={
                                handleCancelEditProperty
                              }
                              disabled={
                                isSaving
                              }
                              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancelar
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void handleSaveProperty(
                                  property.id,
                                )
                              }
                              disabled={
                                isSaving
                              }
                              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isSaving
                                ? 'Guardando...'
                                : 'Guardar cambios'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                },
              )}
            </div>
          </>
        )}
      </section>

      {/* =====================================================
          ANUNCIOS RECIENTES
          ===================================================== */}

      <section className="mt-12">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Anuncios recientes
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Últimos anuncios generados.
            </p>
          </div>

          <Link
            to="/historial"
            className="rounded-md px-2 py-1 text-sm font-semibold text-primary transition hover:bg-primary/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Ver todos los anuncios
          </Link>
        </div>

        {recentGenerations.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed bg-card/50 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Todavía no hay anuncios
              generados.
            </p>
          </div>
        ) : (
          <>
            {/* Barra de selección de anuncios */}
            <div className="mt-5 flex flex-col justify-between gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="dashboard-select-generations"
                  checked={
                    allRecentGenerationsSelected
                  }
                  ref={(element) => {
                    if (element) {
                      element.indeterminate =
                        someRecentGenerationsSelected
                    }
                  }}
                  onChange={
                    handleToggleAllGenerations
                  }
                  disabled={
                    deletingGenerations ||
                    deletingProperties ||
                    Boolean(deletingGenerationId)
                  }
                  className="h-4 w-4 cursor-pointer"
                />

                <label
                  htmlFor="dashboard-select-generations"
                  className="cursor-pointer text-sm font-medium"
                >
                  Seleccionar todos los anuncios
                  visibles
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {selectedGenerationIds.size}{' '}
                  {selectedGenerationIds.size ===
                    1
                    ? 'anuncio seleccionado'
                    : 'anuncios seleccionados'}
                </span>

                {selectedGenerationIds.size >
                  0 && (
                    <button
                      type="button"
                      onClick={() =>
                        void handleDeleteSelectedGenerations()
                      }
                      disabled={
                        deletingGenerations ||
                        deletingProperties ||
                        Boolean(
                          deletingGenerationId,
                        )
                      }
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingGenerations
                        ? 'Eliminando...'
                        : `Eliminar anuncios seleccionados (${selectedGenerationIds.size})`}
                    </button>
                  )}
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {recentGenerations.map(
                (generation) => {
                  const isEditing =
                    editingGenerationId ===
                    generation.id

                  const isSaving =
                    savingGenerationId ===
                    generation.id

                  const isDeleting =
                    deletingGenerationId ===
                    generation.id

                  const isSelected =
                    selectedGenerationIds.has(
                      generation.id,
                    )

                  const highlights =
                    parseHighlights(
                      generation.highlights,
                    )

                  return (
                    <div
                      key={generation.id}
                      className={`overflow-hidden rounded-xl border bg-card shadow-sm transition ${
                        isSelected
                          ? 'border-primary ring-2 ring-primary/20'
                          : ''
                      }`}
                    >
                      {!isEditing ? (
                        <>
                          {/* Selector superior */}
                          <div className="group relative w-full overflow-hidden rounded-t-lg">
                            <button
                              type="button"
                              onClick={() =>
                                handleToggleGeneration(
                                  generation.id,
                                )
                              }
                              disabled={
                                deletingGenerations ||
                                deletingProperties ||
                                isDeleting
                              }
                              aria-pressed={
                                isSelected
                              }
                              className={`block h-11 w-full cursor-pointer border-0 border-b p-0 text-xs font-semibold transition-colors hover:bg-primary hover:text-primary-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                                isSelected
                                  ? 'bg-foreground font-semibold text-background'
                                  : 'bg-accent text-muted-foreground'
                              }`}
                            >
                              {isSelected
                                ? '✓ Seleccionado'
                                : 'Seleccionar'}
                            </button>
                          </div>

                          {/* Contenido del anuncio */}
                          <div className="p-5">
                            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                    {getProviderLabel(
                                      generation.provider,
                                    )}
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

                                <h3 className="mt-3 text-lg font-semibold">
                                  {
                                    generation.title
                                  }
                                </h3>

                                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                  {
                                    generation.description
                                  }
                                </p>

                                <p className="mt-3 text-xs text-muted-foreground">
                                  Inmueble:{' '}
                                  <span className="font-medium">
                                    {generation
                                      .property
                                      .title ||
                                      'Sin título'}
                                  </span>
                                </p>
                              </div>
                            </div>

                            {highlights.length >
                              0 && (
                                <div className="mt-4 pl-5">
                                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Características
                                    destacadas
                                  </p>

                                  <ul className="mt-2 space-y-1 text-sm">
                                    {highlights
                                      .slice(0, 5)
                                      .map(
                                        (
                                          highlight,
                                        ) => (
                                          <li
                                            key={
                                              highlight
                                            }
                                            className="text-muted-foreground"
                                          >
                                            •{' '}
                                            {
                                              highlight
                                            }
                                          </li>
                                        ),
                                      )}
                                  </ul>
                                </div>
                              )}
                          </div>

                          {/* Acciones inferiores */}
                          <div className="grid grid-cols-3 border-t">
                            <Link
                              to={`/historial/${generation.id}`}
                              className="flex min-h-11 items-center justify-center border-r border-border text-sm font-medium transition-colors hover:bg-primary hover:text-primary-foreground"
                            >
                              Ver
                            </Link>

                            <button
                              type="button"
                              onClick={() =>
                                handleStartEditGeneration(
                                  generation,
                                )
                              }
                              disabled={
                                isDeleting ||
                                deletingGenerations ||
                                deletingProperties
                              }
                              className="flex min-h-11 items-center justify-center border-r text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Editar
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void handleDeleteGeneration(
                                  generation.id,
                                )
                              }
                              disabled={
                                isDeleting ||
                                deletingGenerations ||
                                deletingProperties
                              }
                              className="flex min-h-11 items-center justify-center text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isDeleting
                                ? 'Eliminando...'
                                : 'Eliminar'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="p-6">
                          <div>
                            <h3 className="text-lg font-semibold">
                              Editar anuncio
                            </h3>

                            <p className="mt-1 text-sm text-muted-foreground">
                              Modifica el contenido
                              del anuncio directamente
                              desde el Dashboard.
                            </p>
                          </div>

                          <div className="mt-6 space-y-5">
                            <div>
                              <label
                                htmlFor={`generation-title-${generation.id}`}
                                className="text-sm font-medium"
                              >
                                Título
                              </label>

                              <input
                                id={`generation-title-${generation.id}`}
                                value={
                                  generationForm.title
                                }
                                onChange={(event) =>
                                  setGenerationForm(
                                    (current) => ({
                                      ...current,
                                      title:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`generation-description-${generation.id}`}
                                className="text-sm font-medium"
                              >
                                Descripción
                              </label>

                              <textarea
                                id={`generation-description-${generation.id}`}
                                rows={8}
                                value={
                                  generationForm.description
                                }
                                onChange={(event) =>
                                  setGenerationForm(
                                    (current) => ({
                                      ...current,
                                      description:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`generation-highlights-${generation.id}`}
                                className="text-sm font-medium"
                              >
                                Características
                                destacadas
                              </label>

                              <textarea
                                id={`generation-highlights-${generation.id}`}
                                rows={6}
                                value={
                                  generationForm.highlights
                                }
                                onChange={(event) =>
                                  setGenerationForm(
                                    (current) => ({
                                      ...current,
                                      highlights:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                placeholder="Una característica por línea"
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
                              />

                              <p className="mt-1 text-xs text-muted-foreground">
                                Escribe una
                                característica por
                                línea.
                              </p>
                            </div>

                            <div>
                              <label
                                htmlFor={`generation-cta-${generation.id}`}
                                className="text-sm font-medium"
                              >
                                Llamada a la
                                acción
                              </label>

                              <textarea
                                id={`generation-cta-${generation.id}`}
                                rows={3}
                                value={
                                  generationForm.callToAction
                                }
                                onChange={(event) =>
                                  setGenerationForm(
                                    (current) => ({
                                      ...current,
                                      callToAction:
                                        event
                                          .target
                                          .value,
                                    }),
                                  )
                                }
                                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
                              />
                            </div>
                          </div>

                          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t pt-4">
                            <button
                              type="button"
                              onClick={
                                handleCancelEditGeneration
                              }
                              disabled={
                                isSaving
                              }
                              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancelar
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void handleSaveGeneration(
                                  generation.id,
                                )
                              }
                              disabled={
                                isSaving
                              }
                              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isSaving
                                ? 'Guardando...'
                                : 'Guardar cambios'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                },
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default DashboardPage