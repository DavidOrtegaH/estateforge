import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import type {
  AIProviderType,
  ListingLanguage,
  ListingTone,
} from '@estateforge/shared'

import {
  deleteProperty,
  getProperty,
  type PropertyItem,
} from '@/services/propertyService'

import {
  generatePropertyListing,
} from '@/services/propertyGenerationService'

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
            item.replace(/^[-•*]\s*/, '').trim(),
          )
          .filter(Boolean)
      }
    }
  }

  return []
}

function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [property, setProperty] =
    useState<PropertyItem | null>(null)

  const [loading, setLoading] = useState(true)

  const [error, setError] =
    useState<string | null>(null)

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

  const [deleting, setDeleting] =
    useState(false)

  const [deleteError, setDeleteError] =
    useState<string | null>(null)

  const [copyingGenerationId, setCopyingGenerationId] =
    useState<string | null>(null)

  const [copySuccess, setCopySuccess] =
    useState<string | null>(null)

  // Estados para la paginación de anuncios
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 3

  useEffect(() => {
    async function loadProperty() {
      if (!id) {
        setError('No se ha indicado el inmueble.')
        setLoading(false)
        return
      }

      try {
        const result = await getProperty(id)

        setProperty(result)
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

  // Scroll instantáneo al cambiar de página (igual que en HistoryPage)
  useEffect(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    })
  }, [currentPage])

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
      })

      const updatedProperty =
        await getProperty(id)

      setProperty(updatedProperty)
      setCurrentPage(1)
    } catch (error) {
      console.error(
        'Error generando anuncio:',
        error,
      )

      setGenerationError(
        'No se ha podido generar el anuncio. Comprueba que la API esté disponible y que el proveedor seleccionado esté correctamente configurado.',
      )
    } finally {
      setGenerating(false)
    }
  }

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

    setCopyingGenerationId(generationId)
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
                (highlight) => `• ${highlight}`,
              ),
            ].join('\n')
          : '',
        '',
        callToAction,
      ]
        .filter(
          (section) => section.trim().length > 0,
        )
        .join('\n')

      await navigator.clipboard.writeText(text)

      setCopySuccess(generationId)
    } catch {
      setCopySuccess(null)
    } finally {
      setCopyingGenerationId(null)
    }
  }

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

  if (error || !property) {
    return (
      <div>
        <Link
          to="/inmuebles"
          className="text-sm font-medium text-primary hover:underline"
        >
          ← Volver a inmuebles
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

  const features = [
    property.elevator && 'Ascensor',
    property.terrace && 'Terraza',
    property.balcony && 'Balcón',
    property.garage && 'Garaje',
    property.pool && 'Piscina',
    property.garden && 'Jardín',
    property.airConditioning &&
      'Aire acondicionado',
    property.heating && 'Calefacción',
  ].filter(Boolean) as string[]

  // Cálculos para la paginación de anuncios
  const totalGenerations = property.generations.length
  const totalPages = Math.ceil(totalGenerations / itemsPerPage)
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentGenerations = property.generations.slice(indexOfFirstItem, indexOfLastItem)

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

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/inmuebles"
          className="text-sm font-medium text-primary hover:underline"
        >
          ← Volver a inmuebles
        </Link>

        <button
          type="button"
          onClick={handleDeleteProperty}
          disabled={deleting}
          className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting
            ? 'Eliminando...'
            : 'Eliminar inmueble'}
        </button>
      </div>

      {deleteError && (
        <p className="mt-4 text-sm text-destructive">
          {deleteError}
        </p>
      )}

      <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {property.operation}
          </p>

          <h1 className="mt-1 text-3xl font-bold">
            {property.type}
          </h1>

          <p className="mt-2 text-muted-foreground">
            {property.city || 'Sin ciudad'}
            {property.neighborhood
              ? ` · ${property.neighborhood}`
              : ''}
          </p>
        </div>

        <div className="text-left sm:text-right">
          <p className="text-3xl font-bold">
            {property.price.toLocaleString(
              'es-ES',
            )}{' '}
            €
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            {property.area} m²
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Superficie
          </p>

          <p className="mt-1 text-xl font-semibold">
            {property.area} m²
          </p>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Habitaciones
          </p>

          <p className="mt-1 text-xl font-semibold">
            {property.bedrooms}
          </p>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Baños
          </p>

          <p className="mt-1 text-xl font-semibold">
            {property.bathrooms}
          </p>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Planta
          </p>

          <p className="mt-1 text-xl font-semibold">
            {property.floor ?? '—'}
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Información del inmueble
        </h2>

        <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">
              Operación
            </dt>

            <dd className="mt-1 font-medium">
              {property.operation}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Tipo
            </dt>

            <dd className="mt-1 font-medium">
              {property.type}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Estado
            </dt>

            <dd className="mt-1 font-medium">
              {property.condition}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Dirección
            </dt>

            <dd className="mt-1 font-medium">
              {property.address || 'No indicada'}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Ciudad
            </dt>

            <dd className="mt-1 font-medium">
              {property.city || 'No indicada'}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Barrio
            </dt>

            <dd className="mt-1 font-medium">
              {property.neighborhood ||
                'No indicado'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Características
        </h2>

        {features.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No se han indicado características
            adicionales.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {features.map((feature) => (
              <span
                key={feature}
                className="rounded-full bg-muted px-3 py-1.5 text-sm"
              >
                {feature}
              </span>
            ))}
          </div>
        )}
      </section>

      {property.additionalInformation && (
        <section className="mt-6 rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold">
            Información adicional
          </h2>

          <p className="mt-4 whitespace-pre-line leading-7 text-muted-foreground">
            {property.additionalInformation}
          </p>
        </section>
      )}

      <section className="mt-8 rounded-lg border bg-card p-6">
        <div>
          <h2 className="text-xl font-semibold">
            Generar anuncio
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            Elige el proveedor, tono y el idioma antes
            de generar un nuevo anuncio.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
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
              onChange={(event) =>
                setProvider(
                  event.target.value as AIProviderType,
                )
              }
              disabled={generating}
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="gemini">
                Gemini
              </option>

              <option value="mock">
                Mock
              </option>
            </select>

            <p className="mt-2 text-xs text-muted-foreground">
              Gemini utiliza la API configurada en el
              servidor. Mock no consume ninguna API.
            </p>
          </div>

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
              onChange={(event) =>
                setTone(
                  event.target.value as ListingTone,
                )
              }
              disabled={generating}
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="professional">
                Profesional
              </option>

              <option value="premium">
                Premium
              </option>

              <option value="friendly">
                Cercano
              </option>
            </select>
          </div>

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
              onChange={(event) =>
                setLanguage(
                  event.target.value as ListingLanguage,
                )
              }
              disabled={generating}
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

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={handleGenerateListing}
            disabled={generating}
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

      <section className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">
              Anuncios generados
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              {totalGenerations === 0
                ? 'Todavía no hay anuncios para este inmueble.'
                : `${totalGenerations} ${
                    totalGenerations === 1
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
              Ver historial
            </Link>
          )}
        </div>

        {totalGenerations === 0 ? (
          <div className="mt-5 rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Genera el primer anuncio para este
              inmueble.
            </p>
          </div>
        ) : (
          <div>
            <div className="mt-5 space-y-4">
              {currentGenerations.map(
                (generation) => {
                  const highlights =
                    parseHighlights(
                      generation.highlights,
                    )

                  return (
                    <div
                      key={generation.id}
                      className="rounded-lg border bg-card p-5"
                    >
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="w-fit shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                          {generation.provider}
                        </span>

                        <span className="rounded-md bg-muted px-2 py-1 text-xs">
                          {generation.tone}
                        </span>

                        <span className="rounded-md bg-muted px-2 py-1 text-xs">
                          {generation.language}
                        </span>
                      </div>
                      <div className="flex flex-col justify-between gap-4 sm:flex-row mt-8">
                        <Link
                          to={`/historial/${generation.id}`}
                          className="min-w-0 flex-1"
                        >
                          <h3 className="font-semibold hover:underline">
                            {generation.title}
                          </h3>

                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                            {generation.description}
                          </p>
                        </Link>
                      </div>

                      {highlights.length > 0 && (
                        <div className="mt-4">
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

                      

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                        <p className="text-xs text-muted-foreground">
                          Generado el{' '}
                          {new Date(
                            generation.createdAt,
                          ).toLocaleString('es-ES')}
                        </p>

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
                            copyingGenerationId !== null
                          }
                          className="rounded-md border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {copyingGenerationId ===
                          generation.id
                            ? 'Copiando...'
                            : copySuccess ===
                                generation.id
                              ? 'Copiado'
                              : 'Copiar anuncio'}
                        </button>
                      </div>
                    </div>
                  )
                },
              )}
            </div>

            {/* Controles de Paginación */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between border-t pt-4">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 1}
                  className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-muted"
                >
                  Anterior
                </button>

                <span className="text-sm text-muted-foreground">
                  Página <span className="font-semibold">{currentPage}</span> de{' '}
                  <span className="font-semibold">{totalPages}</span>
                </span>

                <button
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages}
                  className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-muted"
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