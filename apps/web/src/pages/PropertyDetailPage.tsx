
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { PageJump } from '@/components/ui/PageJump'
import { clampPage, pageSlice, totalPagesFor } from '@/lib/pagination'

import type {
  AIProviderType,
  ListingLanguage,
  ListingTone,
} from '@estateforge/shared'

import {
  deleteProperty,
  getProperty,
  updateProperty,
  type PropertyItem,
} from '@/services/propertyService'

import {
  deleteGeneration,
  generatePropertyListing,
  updateGeneration,
  GenerationApiError,
} from '@/services/propertyGenerationService'

// ============================================================
// DICCIONARIOS
// ============================================================


import { PasswordInput } from '@/components/ui/PasswordInput'

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

const conditionLabels: Record<string, string> = {
  new: 'Nuevo',
  good: 'Buen estado',
  renovated: 'Reformado',
  'needs-renovation': 'A reformar',
}

const providerLabels: Record<string, string> = {
  mock: 'Mock',
  gemini: 'Gemini',
  openai: 'OpenAI',
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

// ============================================================
// AUXILIARES
// ============================================================

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

function getConditionLabel(
  condition: string | undefined,
): string {
  if (!condition) return 'No indicado'

  return (
    conditionLabels[condition.toLowerCase()] ||
    capitalizeFirstLetter(condition)
  )
}

function getProviderLabel(
  provider: string | undefined,
): string {
  if (!provider) return 'No indicado'

  return (
    providerLabels[provider.toLowerCase()] ||
    capitalizeFirstLetter(provider)
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

function capitalizeFirstLetter(
  value: string,
): string {
  if (!value) return value

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
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

// ============================================================
// COMPONENTE
// ============================================================

function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [property, setProperty] =
    useState<PropertyItem | null>(null)

  const [loading, setLoading] = useState(true)

  const [error, setError] =
    useState<string | null>(null)

  // ==========================================================
  // EDICIÓN DEL INMUEBLE
  // ==========================================================

  const [isEditing, setIsEditing] =
    useState(false)

  const [editForm, setEditForm] =
    useState<Partial<PropertyItem>>({})

  const [savingEdit, setSavingEdit] =
    useState(false)

  const [editError, setEditError] =
    useState<string | null>(null)

  // ==========================================================
  // GENERACIÓN
  // ==========================================================

  const [generating, setGenerating] =
    useState(false)

  const [generationError, setGenerationError] =
    useState<string | null>(null)

  const [provider, setProvider] =
    useState<AIProviderType>('gemini')

  const [tone, setTone] =
    useState<ListingTone>('professional')

  const [language, setLanguage] =
    useState<ListingLanguage>('español')

  const [apiKey, setApiKey] =
    useState('')

  const [showCustomApiKey, setShowCustomApiKey] =
    useState(false)

  // ==========================================================
  // ELIMINACIÓN DEL INMUEBLE
  // ==========================================================

  const [deleting, setDeleting] =
    useState(false)

  const [deleteError, setDeleteError] =
    useState<string | null>(null)

  // ==========================================================
  // COPIAR ANUNCIO
  // ==========================================================

  const [copyingGenerationId, setCopyingGenerationId] =
    useState<string | null>(null)

  const [copySuccess, setCopySuccess] =
    useState<string | null>(null)

  // ==========================================================
  // EDICIÓN DE ANUNCIO
  // ==========================================================

  const [editingGenerationId, setEditingGenerationId] =
    useState<string | null>(null)

  const [generationEditForm, setGenerationEditForm] =
    useState<{
      title: string
      description: string
      highlights: string
      callToAction: string
    }>({
      title: '',
      description: '',
      highlights: '',
      callToAction: '',
    })

  const [savingGeneration, setSavingGeneration] =
    useState(false)

  const [generationEditError, setGenerationEditError] =
    useState<string | null>(null)

  // ==========================================================
  // ELIMINACIÓN DE ANUNCIO
  // ==========================================================

  const [deletingGenerationId, setDeletingGenerationId] =
    useState<string | null>(null)

  const [generationDeleteError, setGenerationDeleteError] =
    useState<string | null>(null)

  // ==========================================================
  // PAGINACIÓN
  // ==========================================================

  const [currentPage, setCurrentPage] = useState(1)

  const itemsPerPage = 3

  // ==========================================================
  // CARGAR INMUEBLE (con FIX para storageRoom)
  // ==========================================================

  useEffect(() => {
    async function loadProperty() {
      if (!id) {
        setError(
          'No se ha indicado el inmueble.',
        )

        setLoading(false)

        return
      }

      try {
        const result = await getProperty(id)

        // 🔧 Aseguramos que storageRoom tenga un valor booleano
        const propertyWithStorage = {
          ...result,
          storageRoom: result.storageRoom ?? false,
        }

        setProperty(propertyWithStorage)
        setEditForm(propertyWithStorage)
      } catch {
        setError(
          'No se ha podido cargar el inmueble.',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadProperty()
  }, [id])

  // ==========================================================
  // TITULO DE LA PESTANA
  // ==========================================================

  useEffect(() => {
    const title = property?.title?.trim()

    document.title = title
      ? `${title} - Inmueble - EstateForge`
      : 'Detalles del inmueble - EstateForge'
  }, [property?.title])

  // ==========================================================
  // SCROLL PAGINACIÓN
  // ==========================================================

  useEffect(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    })
  }, [currentPage])

  // ==========================================================
  // INICIAR EDICIÓN
  // ==========================================================

  function handleStartEdit() {
    if (!property) {
      return
    }

    setEditForm({
      ...property,
    })

    setEditError(null)

    setIsEditing(true)
  }

  // ==========================================================
  // CANCELAR EDICIÓN
  // ==========================================================

  function handleCancelEdit() {
    if (savingEdit) {
      return
    }

    if (property) {
      setEditForm({
        ...property,
      })
    }

    setEditError(null)

    setIsEditing(false)
  }

  // ==========================================================
  // GUARDAR EDICIÓN DEL INMUEBLE (con FIX para storageRoom)
  // ==========================================================

  async function handleSaveEdit(
    event: React.FormEvent,
  ) {
    event.preventDefault()

    if (
      !id ||
      savingEdit ||
      !property
    ) {
      return
    }

    setSavingEdit(true)
    setEditError(null)

    try {
      const payload: Partial<PropertyItem> = {
        title: editForm.title,
        operation: editForm.operation,
        type: editForm.type,
        condition: editForm.condition,

        price: editForm.price,
        area: editForm.area,

        bedrooms: editForm.bedrooms,
        bathrooms: editForm.bathrooms,

        floor: editForm.floor,

        address: editForm.address,
        city: editForm.city,
        neighborhood:
          editForm.neighborhood,

        elevator: editForm.elevator,
        terrace: editForm.terrace,
        balcony: editForm.balcony,
        garage: editForm.garage,
        storageRoom: editForm.storageRoom,
        pool: editForm.pool,
        garden: editForm.garden,
        airConditioning:
          editForm.airConditioning,
        heating: editForm.heating,

        additionalInformation:
          editForm.additionalInformation,
      }

      const updated =
        await updateProperty(
          id,
          payload,
        )

      // 🔧 Forzamos que storageRoom se mantenga con el valor del formulario
      const updatedWithStorage = {
        ...updated,
        storageRoom: editForm.storageRoom ?? false,
      }

      setProperty({
        ...property,
        ...updatedWithStorage,
      })

      setEditForm({
        ...property,
        ...updatedWithStorage,
      })

      setIsEditing(false)
    } catch (error) {
      console.error(
        'Error actualizando inmueble:',
        error,
      )

      setEditError(
        error instanceof Error
          ? error.message
          : 'No se han podido guardar los cambios del inmueble.',
      )
    } finally {
      setSavingEdit(false)
    }
  }

  // ==========================================================
  // GENERAR ANUNCIO (con FIX para storageRoom)
  // ==========================================================

  async function handleGenerateListing() {
    if (!id || generating) {
      return
    }

    setGenerating(true)
    setGenerationError(null)
    setCopySuccess(null)

    try {
      await generatePropertyListing({
        propertyId: id,
        provider,
        tone,
        language,
        apiKey: apiKey.trim() || undefined,
      })

      const updatedProperty =
        await getProperty(id)

      // 🔧 Aseguramos storageRoom al recargar
      const propertyWithStorage = {
        ...updatedProperty,
        storageRoom: updatedProperty.storageRoom ?? false,
      }

      setProperty(propertyWithStorage)
      setEditForm(propertyWithStorage)

      setApiKey('')
      setShowCustomApiKey(false)
      setCurrentPage(1)
    } catch (error) {
      if (error instanceof GenerationApiError) {
        if (error.code === 'AI_QUOTA_EXCEEDED') {
          setGenerationError(
            'La cuota disponible del proveedor de IA se ha agotado.',
          )
          setShowCustomApiKey(true)
          return
        }

        if (error.code === 'AI_INVALID_API_KEY') {
          setGenerationError(
            'La API key proporcionada no es válida. Comprueba la clave e inténtalo de nuevo.',
          )
          setShowCustomApiKey(true)
          return
        }

        if (error.code === 'AI_TIMEOUT') {
          setGenerationError(
            'La generación ha superado el tiempo límite de 15 segundos.',
          )
          return
        }

        setGenerationError(
          'El proveedor de IA no está disponible en este momento. Inténtalo de nuevo más tarde.',
        )
        return
      }

      setGenerationError(
        'No se ha podido generar el anuncio. Comprueba que la API esté disponible y que el proveedor seleccionado esté correctamente configurado.',
      )
    } finally {
      setGenerating(false)
    }
  }

  // ==========================================================
  // ELIMINAR INMUEBLE
  // ==========================================================

  async function handleDeleteProperty() {
    if (!id || deleting) {
      return
    }

    const confirmed = window.confirm(
      '¿Seguro que quieres eliminar este inmueble? También se eliminarán todos los anuncios generados asociados.',
    )

    if (!confirmed) {
      return
    }

    setDeleting(true)
    setDeleteError(null)

    try {
      await deleteProperty(id)

      navigate('/inmuebles')
    } catch {
      setDeleteError(
        'No se ha podido eliminar el inmueble.',
      )

      setDeleting(false)
    }
  }

  // ==========================================================
  // INICIAR EDICIÓN DE ANUNCIO
  // ==========================================================

  function handleStartEditGeneration(
    generation: PropertyItem['generations'][number],
  ) {
    const highlights =
      parseHighlights(
        generation.highlights,
      )

    setEditingGenerationId(
      generation.id,
    )

    setGenerationEditForm({
      title: generation.title,
      description:
        generation.description,
      highlights:
        highlights.join('\n'),
      callToAction:
        generation.callToAction,
    })

    setGenerationEditError(null)
    setGenerationDeleteError(null)
  }

  // ==========================================================
  // CANCELAR EDICIÓN DE ANUNCIO
  // ==========================================================

  function handleCancelEditGeneration() {
    if (savingGeneration) {
      return
    }

    setEditingGenerationId(null)

    setGenerationEditForm({
      title: '',
      description: '',
      highlights: '',
      callToAction: '',
    })

    setGenerationEditError(null)
  }

  // ==========================================================
  // GUARDAR ANUNCIO
  // ==========================================================

  async function handleSaveGeneration() {
    if (
      !editingGenerationId ||
      savingGeneration
    ) {
      return
    }

    if (
      !generationEditForm.title.trim()
    ) {
      setGenerationEditError(
        'El título del anuncio es obligatorio.',
      )

      return
    }

    if (
      !generationEditForm.description.trim()
    ) {
      setGenerationEditError(
        'La descripción del anuncio es obligatoria.',
      )

      return
    }

    setSavingGeneration(true)
    setGenerationEditError(null)

    try {
      const highlights =
        generationEditForm.highlights
          .split('\n')
          .map((item) =>
            item.trim(),
          )
          .filter(Boolean)

      await updateGeneration(
        editingGenerationId,
        {
          title:
            generationEditForm.title.trim(),

          description:
            generationEditForm.description.trim(),

          highlights,

          callToAction:
            generationEditForm.callToAction.trim(),
        },
      )

      if (!id) {
        return
      }

      const updatedProperty =
        await getProperty(id)

      // 🔧 Aseguramos storageRoom al recargar
      const propertyWithStorage = {
        ...updatedProperty,
        storageRoom: updatedProperty.storageRoom ?? false,
      }

      setProperty(propertyWithStorage)
      setEditForm(propertyWithStorage)

      setEditingGenerationId(null)

      setGenerationEditForm({
        title: '',
        description: '',
        highlights: '',
        callToAction: '',
      })
    } catch (error) {
      console.error(
        'Error editando anuncio:',
        error,
      )

      setGenerationEditError(
        error instanceof Error
          ? error.message
          : 'No se ha podido guardar el anuncio.',
      )
    } finally {
      setSavingGeneration(false)
    }
  }

  // ==========================================================
  // ELIMINAR ANUNCIO
  // ==========================================================

  async function handleDeleteGeneration(
    generationId: string,
  ) {
    if (
      deletingGenerationId ||
      savingGeneration
    ) {
      return
    }

    const confirmed =
      window.confirm(
        '¿Seguro que quieres eliminar este anuncio? Esta acción no se puede deshacer.',
      )

    if (!confirmed) {
      return
    }

    setDeletingGenerationId(
      generationId,
    )

    setGenerationDeleteError(null)

    try {
      await deleteGeneration(
        generationId,
      )

      if (!id) {
        return
      }

      const updatedProperty =
        await getProperty(id)

      // 🔧 Aseguramos storageRoom al recargar
      const propertyWithStorage = {
        ...updatedProperty,
        storageRoom: updatedProperty.storageRoom ?? false,
      }

      setProperty(propertyWithStorage)
      setEditForm(propertyWithStorage)

      const remainingGenerations =
        updatedProperty.generations.length

      const newTotalPages =
        Math.max(
          1,
          Math.ceil(
            remainingGenerations /
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

      if (
        editingGenerationId ===
        generationId
      ) {
        handleCancelEditGeneration()
      }
    } catch (error) {
      console.error(
        'Error eliminando anuncio:',
        error,
      )

      setGenerationDeleteError(
        error instanceof Error
          ? error.message
          : 'No se ha podido eliminar el anuncio.',
      )
    } finally {
      setDeletingGenerationId(null)
    }
  }

  // ==========================================================
  // COPIAR ANUNCIO
  // ==========================================================

  async function handleCopyGeneration(
    generationId: string,
    title: string,
    description: string,
    highlights: unknown,
    callToAction: string,
  ) {
    if (copyingGenerationId) {
      return
    }

    setCopyingGenerationId(
      generationId,
    )

    setCopySuccess(null)

    try {
      const parsedHighlights =
        parseHighlights(highlights)

      const text = [
        title,
        '',
        description,
        '',
        parsedHighlights.length > 0
          ? [
            'Características destacadas:',
            ...parsedHighlights.map(
              (highlight) =>
                `• ${highlight}`,
            ),
          ].join('\n')
          : '',
        '',
        callToAction,
      ]
        .filter(
          (section) =>
            section.trim().length >
            0,
        )
        .join('\n')

      await navigator.clipboard.writeText(
        text,
      )

      setCopySuccess(
        generationId,
      )
    } catch {
      setCopySuccess(null)
    } finally {
      setCopyingGenerationId(null)
    }
  }

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Inmueble
        </h1>

        <p className="mt-4 text-muted-foreground">
          Cargando inmueble...
        </p>
      </div>
    )
  }

  // ==========================================================
  // ERROR
  // ==========================================================

  if (error || !property) {
    return (
      <div>
        <Link
          to="/inmuebles"
          className="text-sm font-medium text-primary hover:underline"
        >
          ← Volver a Inmuebles
        </Link>

        <h1 className="mt-6 text-3xl font-bold">
          Inmueble no encontrado
        </h1>

        <p className="mt-2 text-muted-foreground">
          {error ??
            'No se ha encontrado el inmueble solicitado.'}
        </p>
      </div>
    )
  }

  // ==========================================================
  // CARACTERÍSTICAS (EXTRAS)
  // ==========================================================

  const features = [
    property.elevator && 'Ascensor',
    property.terrace && 'Terraza',
    property.balcony && 'Balcón',
    property.garage && 'Garaje',
    property.storageRoom && 'Trastero',
    property.pool && 'Piscina',
    property.garden && 'Jardín',
    property.airConditioning &&
    'Aire acondicionado',
    property.heating && 'Calefacción',
  ].filter(Boolean) as string[]

  // ==========================================================
  // PAGINACIÓN
  // ==========================================================

  const totalGenerations =
    property.generations.length

  const totalPages = totalPagesFor(
    totalGenerations,
    itemsPerPage,
  )

  const currentGenerations = pageSlice(
    property.generations,
    currentPage,
    itemsPerPage,
  )

  const handleNextPage = () => {
    if (
      currentPage <
      totalPages
    ) {
      setCurrentPage(
        (prev) => prev + 1,
      )
    }
  }

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(
        (prev) => prev - 1,
      )
    }
  }

  // Salto directo: PageJump solo entrega páginas válidas; se acota por si el total cambió.
  const handleJumpToPage = (page: number) => {
    setCurrentPage(clampPage(page, totalPages))
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="max-w-6xl">
      {/* =====================================================
          CABECERA
      ====================================================== */}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/inmuebles"
          className="text-sm font-medium text-primary hover:underline"
        >
          ← Volver a Inmuebles
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={
              isEditing
                ? handleCancelEdit
                : handleStartEdit
            }
            disabled={savingEdit}
            className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isEditing
              ? 'Cancelar edición'
              : 'Editar inmueble'}
          </button>

          <button
            type="button"
            onClick={
              handleDeleteProperty
            }
            disabled={deleting}
            className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting
              ? 'Eliminando...'
              : 'Eliminar inmueble'}
          </button>
        </div>
      </div>

      {deleteError && (
        <p className="mt-4 text-sm text-destructive">
          {deleteError}
        </p>
      )}

      {/* =====================================================
          EDICIÓN DEL INMUEBLE
      ====================================================== */}

      {isEditing ? (
        <form
          onSubmit={
            handleSaveEdit
          }
          className="mt-6 space-y-8 rounded-lg border bg-card p-6"
        >
          <div>
            <h2 className="text-xl font-semibold">
              Editar inmueble
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Modifica los datos del
              inmueble y guarda los
              cambios.
            </p>
          </div>

          {/* INFORMACIÓN BÁSICA */}

          <section>
            <h3 className="text-lg font-semibold">
              Información básica
            </h3>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {/* TÍTULO */}

              <div className="sm:col-span-2">
                <label
                  htmlFor="property-title"
                  className="text-sm font-medium"
                >
                  Título
                </label>

                <input
                  id="property-title"
                  type="text"
                  value={
                    editForm.title ??
                    ''
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      title:
                        event.target
                          .value,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              {/* OPERACIÓN */}

              <div>
                <label
                  htmlFor="property-operation"
                  className="text-sm font-medium"
                >
                  Operación
                </label>

                <select
                  id="property-operation"
                  value={
                    editForm.operation ??
                    ''
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      operation:
                        event.target
                          .value,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                >
                  <option value="">
                    Seleccionar
                  </option>

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

              {/* TIPO */}

              <div>
                <label
                  htmlFor="property-type"
                  className="text-sm font-medium"
                >
                  Tipo de inmueble
                </label>

                <select
                  id="property-type"
                  value={
                    editForm.type ??
                    ''
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      type:
                        event.target
                          .value,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                >
                  <option value="">
                    Seleccionar
                  </option>

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

              {/* ESTADO */}

              <div>
                <label
                  htmlFor="property-condition"
                  className="text-sm font-medium"
                >
                  Estado
                </label>

                <select
                  id="property-condition"
                  value={
                    editForm.condition ??
                    ''
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      condition:
                        event.target
                          .value,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                >
                  <option value="">
                    Seleccionar
                  </option>

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

              {/* PRECIO */}

              <div>
                <label
                  htmlFor="property-price"
                  className="text-sm font-medium"
                >
                  Precio (€)
                </label>

                <input
                  id="property-price"
                  type="number"
                  min="0"
                  value={
                    editForm.price ??
                    0
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      price:
                        Number(
                          event.target
                            .value,
                        ),
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              {/* SUPERFICIE */}

              <div>
                <label
                  htmlFor="property-area"
                  className="text-sm font-medium"
                >
                  Superficie (m²)
                </label>

                <input
                  id="property-area"
                  type="number"
                  min="0"
                  value={
                    editForm.area ??
                    0
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      area:
                        Number(
                          event.target
                            .value,
                        ),
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              {/* HABITACIONES */}

              <div>
                <label
                  htmlFor="property-bedrooms"
                  className="text-sm font-medium"
                >
                  Habitaciones
                </label>

                <input
                  id="property-bedrooms"
                  type="number"
                  min="0"
                  value={
                    editForm.bedrooms ??
                    0
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      bedrooms:
                        Number(
                          event.target
                            .value,
                        ),
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              {/* BAÑOS */}

              <div>
                <label
                  htmlFor="property-bathrooms"
                  className="text-sm font-medium"
                >
                  Baños
                </label>

                <input
                  id="property-bathrooms"
                  type="number"
                  min="0"
                  value={
                    editForm.bathrooms ??
                    0
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      bathrooms:
                        Number(
                          event.target
                            .value,
                        ),
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              {/* PLANTA */}

              <div>
                <label
                  htmlFor="property-floor"
                  className="text-sm font-medium"
                >
                  Planta
                </label>

                <input
                  id="property-floor"
                  type="number"
                  value={editForm.floor ?? ''}
                  onChange={(event) => {
                    const value = event.target.value

                    setEditForm({
                      ...editForm,
                      floor:
                        value === ''
                          ? null
                          : Number(value),
                    })
                  }}
                  disabled={savingEdit}
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>
            </div>
          </section>

          {/* UBICACIÓN */}

          <section>
            <h3 className="text-lg font-semibold">
              Ubicación
            </h3>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {/* DIRECCIÓN */}

              <div className="sm:col-span-2">
                <label
                  htmlFor="property-address"
                  className="text-sm font-medium"
                >
                  Dirección
                </label>

                <input
                  id="property-address"
                  type="text"
                  value={
                    editForm.address ??
                    ''
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      address:
                        event.target
                          .value,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              {/* CIUDAD */}

              <div>
                <label
                  htmlFor="property-city"
                  className="text-sm font-medium"
                >
                  Ciudad
                </label>

                <input
                  id="property-city"
                  type="text"
                  value={
                    editForm.city ??
                    ''
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      city:
                        event.target
                          .value,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              {/* BARRIO */}

              <div>
                <label
                  htmlFor="property-neighborhood"
                  className="text-sm font-medium"
                >
                  Zona
                </label>

                <input
                  id="property-neighborhood"
                  type="text"
                  value={
                    editForm.neighborhood ??
                    ''
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      neighborhood:
                        event.target
                          .value,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>
            </div>
          </section>

          {/* CARACTERÍSTICAS */}

          <section>
            <h3 className="text-lg font-semibold">
              Características
            </h3>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* ASCENSOR */}

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted">
                <input
                  type="checkbox"
                  checked={
                    editForm.elevator ??
                    false
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      elevator:
                        event.target
                          .checked,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="h-4 w-4"
                />

                <span className="text-sm font-medium">
                  Ascensor
                </span>
              </label>

              {/* TERRAZA */}

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted">
                <input
                  type="checkbox"
                  checked={
                    editForm.terrace ??
                    false
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      terrace:
                        event.target
                          .checked,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="h-4 w-4"
                />

                <span className="text-sm font-medium">
                  Terraza
                </span>
              </label>

              {/* BALCÓN */}

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted">
                <input
                  type="checkbox"
                  checked={
                    editForm.balcony ??
                    false
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      balcony:
                        event.target
                          .checked,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="h-4 w-4"
                />

                <span className="text-sm font-medium">
                  Balcón
                </span>
              </label>

              {/* GARAJE */}

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted">
                <input
                  type="checkbox"
                  checked={
                    editForm.garage ??
                    false
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      garage:
                        event.target
                          .checked,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="h-4 w-4"
                />

                <span className="text-sm font-medium">
                  Garaje
                </span>
              </label>

              {/* TRASTERO */}

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted">
                <input
                  type="checkbox"
                  checked={
                    editForm.storageRoom ??
                    false
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      storageRoom:
                        event.target
                          .checked,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="h-4 w-4"
                />

                <span className="text-sm font-medium">
                  Trastero
                </span>
              </label>

              {/* PISCINA */}

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted">
                <input
                  type="checkbox"
                  checked={
                    editForm.pool ??
                    false
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      pool:
                        event.target
                          .checked,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="h-4 w-4"
                />

                <span className="text-sm font-medium">
                  Piscina
                </span>
              </label>

              {/* JARDÍN */}

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted">
                <input
                  type="checkbox"
                  checked={
                    editForm.garden ??
                    false
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      garden:
                        event.target
                          .checked,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="h-4 w-4"
                />

                <span className="text-sm font-medium">
                  Jardín
                </span>
              </label>

              {/* AIRE ACONDICIONADO */}

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted">
                <input
                  type="checkbox"
                  checked={
                    editForm.airConditioning ??
                    false
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      airConditioning:
                        event.target
                          .checked,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="h-4 w-4"
                />

                <span className="text-sm font-medium">
                  Aire acondicionado
                </span>
              </label>

              {/* CALEFACCIÓN */}

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted">
                <input
                  type="checkbox"
                  checked={
                    editForm.heating ??
                    false
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditForm({
                      ...editForm,
                      heating:
                        event.target
                          .checked,
                    })
                  }
                  disabled={
                    savingEdit
                  }
                  className="h-4 w-4"
                />

                <span className="text-sm font-medium">
                  Calefacción
                </span>
              </label>
            </div>
          </section>

          {/* INFORMACIÓN ADICIONAL */}

          <section>
            <h3 className="text-lg font-semibold">
              Información adicional
            </h3>

            <textarea
              value={
                editForm.additionalInformation ??
                ''
              }
              onChange={(
                event,
              ) =>
                setEditForm({
                  ...editForm,
                  additionalInformation:
                    event.target
                      .value,
                })
              }
              disabled={
                savingEdit
              }
              rows={8}
              placeholder="Información adicional sobre el inmueble..."
              className="mt-4 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary disabled:opacity-50"
            />
          </section>

          {/* ERROR */}

          {editError && (
            <p className="text-sm text-destructive">
              {editError}
            </p>
          )}

          {/* BOTONES */}

          <div className="flex justify-end gap-2 border-t pt-5">
            <button
              type="button"
              onClick={
                handleCancelEdit
              }
              disabled={
                savingEdit
              }
              className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={
                savingEdit
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingEdit
                ? 'Guardando...'
                : 'Guardar cambios'}
            </button>
          </div>
        </form>
      ) : (
        /* ===================================================
           VISTA NORMAL
        ==================================================== */

        <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h1 className="mt-1 text-3xl font-bold">
              {property.title ||
                'Inmueble sin título'}
            </h1>
          </div>
        </div>
      )}

      {/* =====================================================
          INFORMACIÓN DEL INMUEBLE
      ====================================================== */}

      <section className="mt-8 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Información del inmueble
        </h2>

        <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Precio */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Precio
            </dt>

            <dd className="mt-1 font-medium">
              {property.price.toLocaleString('es-ES')} €
            </dd>
          </div>

          {/* Operación */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Operación
            </dt>

            <dd className="mt-1 font-medium">
              {getOperationLabel(property.operation)}
            </dd>
          </div>

          {/* Tipo */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Tipo
            </dt>

            <dd className="mt-1 font-medium">
              {getPropertyTypeLabel(property.type)}
            </dd>
          </div>

          {/* Superficie */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Superficie
            </dt>

            <dd className="mt-1 font-medium">
              {property.area} m²
            </dd>
          </div>

          {/* Habitaciones */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Habitaciones
            </dt>

            <dd className="mt-1 font-medium">
              {property.bedrooms}
            </dd>
          </div>

          {/* Baños */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Baños
            </dt>

            <dd className="mt-1 font-medium">
              {property.bathrooms}
            </dd>
          </div>

          {/* Ciudad */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Ciudad
            </dt>

            <dd className="mt-1 font-medium">
              {property.city || 'No indicada'}
            </dd>
          </div>

          {/* Zona */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Zona
            </dt>

            <dd className="mt-1 font-medium">
              {property.neighborhood || 'No indicado'}
            </dd>
          </div>

          {/* Dirección */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Dirección
            </dt>

            <dd className="mt-1 font-medium">
              {property.address || 'No indicada'}
            </dd>
          </div>

          {/* Estado */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Estado
            </dt>

            <dd className="mt-1 font-medium">
              {getConditionLabel(property.condition)}
            </dd>
          </div>

          {/* Planta */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Planta
            </dt>

            <dd className="mt-1 font-medium">
              {property.floor ?? '—'}
            </dd>
          </div>

          {/* Fecha de creación */}

          <div>
            <dt className="text-sm text-muted-foreground">
              Fecha de creación
            </dt>

            <dd className="mt-1 font-medium">
              {new Date(
                property.createdAt,
              ).toLocaleString(
                'es-ES',
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* =====================================================
          EXTRAS
      ====================================================== */}

      <section className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Extras
        </h2>

        {features.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No se han indicado
            características
            adicionales.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {features.map(
              (feature) => (
                <span
                  key={feature}
                  className="rounded-full border bg-muted/70 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {feature}
                </span>
              ),
            )}
          </div>
        )}
      </section>

      {/* =====================================================
          INFORMACIÓN ADICIONAL
      ====================================================== */}

      {property.additionalInformation && (
        <section className="mt-6 rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold">
            Información adicional
          </h2>

          <p className="mt-4 whitespace-pre-line leading-7 text-muted-foreground">
            {
              property.additionalInformation
            }
          </p>
        </section>
      )}

      {/* =====================================================
          GENERAR ANUNCIO
      ===================================================== */}

      <section className="mt-8 rounded-lg border bg-card p-6">
        <div>
          <h2 className="text-xl font-semibold">
            Generar anuncio
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            Elige el proveedor, tono
            y el idioma antes de
            generar un nuevo anuncio.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {/* PROVEEDOR */}

          <div>
            <label
              htmlFor="generation-provider"
              className="text-sm font-medium"
            >
              Proveedor de IA
            </label>

            <select
              id="generation-provider"
              value={provider}
              onChange={(
                event,
              ) =>
                setProvider(
                  event.target
                    .value as AIProviderType,
                )
              }
              disabled={
                generating
              }
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="mock">
                Mock
              </option>

              <option value="gemini">
                Gemini
              </option>

              <option value="openai">
                OpenAI
              </option>
            </select>

            <p className="mt-2 text-xs text-muted-foreground">
              Mock no consume ninguna API ni usa IA.
            </p>
          </div>

          {/* TONO */}

          <div>
            <label
              htmlFor="generation-tone"
              className="text-sm font-medium"
            >
              Tono
            </label>

            <select
              id="generation-tone"
              value={tone}
              onChange={(
                event,
              ) =>
                setTone(
                  event.target
                    .value as ListingTone,
                )
              }
              disabled={
                generating
              }
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="professional">
                Profesional
              </option>

              <option value="luxurious">
                De lujo
              </option>

              <option value="casual">
                Casual
              </option>

              <option value="persuasive">
                Persuasivo
              </option>
            </select>
          </div>

          {/* IDIOMA */}

          <div>
            <label
              htmlFor="generation-language"
              className="text-sm font-medium"
            >
              Idioma
            </label>

            <select
              id="generation-language"
              value={language}
              onChange={(
                event,
              ) =>
                setLanguage(
                  event.target
                    .value as ListingLanguage,
                )
              }
              disabled={
                generating
              }
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="español">
                Español
              </option>

              <option value="english">
                Inglés
              </option>
            </select>
          </div>
        </div>

        {showCustomApiKey && (
          <div className="mt-6 rounded-lg border bg-muted/30 p-4">
            <div>
              <p className="text-sm font-medium">
                Usar mi propia API key
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Puedes utilizar tu propia API key para continuar generando anuncios cuando se haya agotado la cuota disponible. La clave se utilizará únicamente para esta generación y no se guardará.
              </p>
            </div>

            <div className="mt-4">
              <label
                htmlFor="generation-api-key"
                className="text-sm font-medium"
              >
                API key de {provider === 'gemini' ? 'Gemini' : 'OpenAI'}
              </label>

              <PasswordInput
                id="generation-api-key"
                
                value={apiKey}
                onChange={(event) =>
                  setApiKey(event.target.value)
                }
                disabled={generating}
                autoComplete="off"
                placeholder="Introduce tu API key"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
               wrapperClassName="mt-2"  visibilityLabel="clave API" />

              <p className="mt-2 text-xs text-muted-foreground">
                No guardamos ni mostramos esta clave después de la generación.
              </p>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={
              handleGenerateListing
            }
            disabled={
              generating
            }
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating
              ? 'Generando...'
              : 'Generar anuncio'}
          </button>
        </div>

        {generationError && (
          <p className="mt-4 text-sm text-destructive">
            {generationError}
          </p>
        )}
      </section>

      {/* =====================================================
          ANUNCIOS GENERADOS
      ====================================================== */}

      <section className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">
              Anuncios generados
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              {totalGenerations === 0
                ? 'Todavía no hay anuncios para este inmueble.'
                : `${totalGenerations} ${totalGenerations === 1
                  ? 'anuncio generado'
                  : 'anuncios generados'
                }.`}
            </p>
          </div>

          {totalGenerations > 0 && (
            <Link
              to="/historial"
              className="text-sm font-medium text-primary hover:underline"
            >
              Ver todos los anuncios
            </Link>
          )}
        </div>

        {totalGenerations === 0 ? (
          <div className="mt-5 rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Genera el primer anuncio para este inmueble.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {currentGenerations.map((generation) => {
              const isEditingGeneration =
                editingGenerationId === generation.id

              const isSavingGeneration =
                savingGeneration

              const isDeletingGeneration =
                deletingGenerationId === generation.id

              const isCopyingGeneration =
                copyingGenerationId === generation.id

              const highlights = parseHighlights(
                generation.highlights,
              )

              return (
                <div
                  key={generation.id}
                  className="rounded-lg border bg-card transition"
                >
                  {isEditingGeneration ? (
                    /* EDICIÓN DEL ANUNCIO */
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="text-lg font-semibold">
                            Editar anuncio
                          </h3>

                          <p className="mt-1 text-sm text-muted-foreground">
                            Modifica el contenido del anuncio
                            directamente desde este inmueble.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={handleCancelEditGeneration}
                          disabled={isSavingGeneration}
                          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>

                      <div className="mt-6 space-y-5">
                        {/* TÍTULO */}
                        <div>
                          <label
                            htmlFor={`generation-title-${generation.id}`}
                            className="text-sm font-medium"
                          >
                            Título
                          </label>

                          <input
                            id={`generation-title-${generation.id}`}
                            type="text"
                            value={generationEditForm.title}
                            onChange={(event) =>
                              setGenerationEditForm(
                                (current) => ({
                                  ...current,
                                  title: event.target.value,
                                }),
                              )
                            }
                            disabled={isSavingGeneration}
                            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                          />
                        </div>

                        {/* DESCRIPCIÓN */}
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
                            value={generationEditForm.description}
                            onChange={(event) =>
                              setGenerationEditForm(
                                (current) => ({
                                  ...current,
                                  description: event.target.value,
                                }),
                              )
                            }
                            disabled={isSavingGeneration}
                            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary disabled:opacity-50"
                          />
                        </div>

                        {/* HIGHLIGHTS */}
                        <div>
                          <label
                            htmlFor={`generation-highlights-${generation.id}`}
                            className="text-sm font-medium"
                          >
                            Características destacadas
                          </label>

                          <p className="mt-1 text-xs text-muted-foreground">
                            Escribe una característica por línea.
                          </p>

                          <textarea
                            id={`generation-highlights-${generation.id}`}
                            rows={6}
                            value={generationEditForm.highlights}
                            onChange={(event) =>
                              setGenerationEditForm(
                                (current) => ({
                                  ...current,
                                  highlights: event.target.value,
                                }),
                              )
                            }
                            disabled={isSavingGeneration}
                            placeholder={'133 m²\n3 habitaciones\n2 baños\nBalcón'}
                            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary disabled:opacity-50"
                          />
                        </div>

                        {/* CTA */}
                        <div>
                          <label
                            htmlFor={`generation-cta-${generation.id}`}
                            className="text-sm font-medium"
                          >
                            Llamada a la acción
                          </label>

                          <textarea
                            id={`generation-cta-${generation.id}`}
                            rows={3}
                            value={generationEditForm.callToAction}
                            onChange={(event) =>
                              setGenerationEditForm(
                                (current) => ({
                                  ...current,
                                  callToAction: event.target.value,
                                }),
                              )
                            }
                            disabled={isSavingGeneration}
                            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary disabled:opacity-50"
                          />
                        </div>

                        {generationEditError && (
                          <p className="text-sm text-destructive">
                            {generationEditError}
                          </p>
                        )}

                        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                          <button
                            type="button"
                            onClick={handleCancelEditGeneration}
                            disabled={isSavingGeneration}
                            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Cancelar
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleSaveGeneration()}
                            disabled={isSavingGeneration}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            {isSavingGeneration
                              ? 'Guardando...'
                              : 'Guardar cambios'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* CONTENIDO DEL ANUNCIO */}
                      <div className="p-5">
                        {/* METADATOS */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-fit shrink-0 rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                            {getProviderLabel(generation.provider)}
                          </span>

                          <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                            {getToneLabel(generation.tone)}
                          </span>

                          <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                            {getLanguageLabel(generation.language)}
                          </span>

                          {/* Fecha de generación */}
                          <span className="rounded-full border bg-muted/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                            Generado el{' '}
                            {formatGenerationDate(generation.createdAt)
                            }
                          </span>
                        </div>

                        {/* TÍTULO Y DESCRIPCIÓN */}
                        <div className="mt-3">
                          <h3 className="text-lg font-semibold">
                            {generation.title}
                          </h3>

                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {generation.description}
                          </p>
                        </div>

                        {/* CARACTERÍSTICAS DESTACADAS */}
                        {highlights.length > 0 && (
                          <div className="mt-4 pl-5">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Características destacadas
                            </p>

                            <ul className="mt-2 space-y-1 text-sm">
                              {highlights.slice(0, 5).map((highlight) => (
                                <li
                                  key={highlight}
                                  className="text-muted-foreground"
                                >
                                  • {highlight}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {generationDeleteError && (
                          <p className="mt-4 text-sm text-destructive">
                            {generationDeleteError}
                          </p>
                        )}
                      </div>

                      {/* ACCIONES INFERIORES */}
                      <div className="grid grid-cols-4 border-t">
                        <Link
                          to={`/historial/${generation.id}`}
                          className="flex min-h-11 items-center justify-center border-r text-sm font-medium transition hover:bg-muted"
                        >
                          Ver
                        </Link>

                        <button
                          type="button"
                          onClick={() =>
                            handleStartEditGeneration(generation)
                          }
                          disabled={
                            isDeletingGeneration || deleting
                          }
                          className="flex min-h-11 items-center justify-center border-r text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Editar
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyGeneration(
                              generation.id,
                              generation.title,
                              generation.description,
                              generation.highlights,
                              generation.callToAction,
                            )
                          }
                          disabled={
                            isCopyingGeneration ||
                            isDeletingGeneration ||
                            deleting
                          }
                          className="flex min-h-11 items-center justify-center border-r text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isCopyingGeneration
                            ? 'Copiando...'
                            : copySuccess === generation.id
                              ? 'Copiado'
                              : 'Copiar'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void handleDeleteGeneration(generation.id)
                          }
                          disabled={
                            isDeletingGeneration || deleting
                          }
                          className="flex min-h-11 items-center justify-center text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isDeletingGeneration
                            ? 'Eliminando...'
                            : 'Eliminar'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            {/* PAGINACIÓN */}
            {totalPages > 1 && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                <button
                  type="button"
                  onClick={handlePrevPage}
                  disabled={currentPage === 1}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Anterior
                </button>

                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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
                  <PageJump
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onJump={handleJumpToPage}
                    label="Ir a la página de generaciones"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Siguiente
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

export default PropertyDetailPage
