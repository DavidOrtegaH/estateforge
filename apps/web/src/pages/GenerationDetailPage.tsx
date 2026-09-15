import { useEffect, useState } from 'react'
import {
  Link,
  useNavigate,
  useParams,
} from 'react-router'

import {
  getGeneration,
  updateGeneration,
  deleteGeneration,
  type GenerationItem,
} from '@/services/generationService'

// Diccionario de traducción para los tipos de inmueble
const propertyTypeLabels: Record<string, string> = {
  apartment: 'Apartamento',
  flat: 'Piso',
  house: 'Casa',
  villa: 'Chalet',
  penthouse: 'Ático',
  duplex: 'Dúplex',
  studio: 'Estudio',
  commercial: 'Local comercial',
  office: 'Oficina',
  land: 'Terreno',
}

// Diccionario de traducción para las operaciones
const operationLabels: Record<string, string> = {
  sale: 'Venta',
  rent: 'Alquiler',
  transfer: 'Traspaso',
}

// Diccionario de traducción para los tonos
const toneLabels: Record<string, string> = {
  professional: 'Profesional',
  friendly: 'Cercano',
  commercial: 'Comercial',
  luxurious: 'De lujo',
  casual: 'Casual',
  persuasive: 'Persuasivo',
  direct: 'Directo',
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

function getConditionLabel(
  condition: string | undefined,
): string {
  if (!condition) return 'No indicado'

  const normalized = condition
    .toLowerCase()
    .replace(/_/g, '-')

  const conditionLabels: Record<
    string,
    string
  > = {
    new: 'Nuevo',
    good: 'Buen estado',
    renovated: 'Reformado',
    'needs-renovation':
      'Necesita reforma',
    'to-renovate':
      'Necesita reforma',
    'to-renovate-':
      'Necesita reforma',
  }

  return (
    conditionLabels[normalized] ||
    capitalizeFirstLetter(condition)
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

      if (
        parsed &&
        typeof parsed === 'object'
      ) {
        return []
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

function GenerationDetailPage() {
  const { id } =
    useParams<{ id: string }>()

  const navigate = useNavigate()

  const [generation, setGeneration] =
    useState<GenerationItem | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const [copying, setCopying] =
    useState(false)

  const [copySuccess, setCopySuccess] =
    useState(false)

  // Estados para la funcionalidad de edición
  const [isEditing, setIsEditing] =
    useState(false)

  const [saving, setSaving] =
    useState(false)

  const [editError, setEditError] =
    useState<string | null>(null)

  // Estado para la funcionalidad de eliminación
  const [deleting, setDeleting] =
    useState(false)

  const [editForm, setEditForm] =
    useState({
      title: '',
      description: '',
      highlights: '',
      callToAction: '',
    })

  useEffect(() => {
    if (!id) {
      setError(
        'Anuncio no encontrado.',
      )

      setLoading(false)

      return
    }

    const generationId = id

    async function loadGeneration() {
      try {
        const data =
          await getGeneration(
            generationId,
          )

        setGeneration(data)
      } catch {
        setError(
          'No se pudo cargar el anuncio.',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadGeneration()
  }, [id])

  function handleStartEdit() {
    if (!generation) return

    const parsedHighlights =
      parseHighlights(
        generation.highlights,
      )

    setEditForm({
      title:
        generation.title || '',
      description:
        generation.description || '',
      highlights:
        parsedHighlights.join('\n'),
      callToAction:
        generation.callToAction || '',
    })

    setEditError(null)
    setIsEditing(true)
  }

  function handleCancelEdit() {
    setIsEditing(false)
    setEditError(null)
  }

  async function handleSaveEdit() {
    if (!generation) return

    setSaving(true)
    setEditError(null)

    try {
      const highlightsArray =
        editForm.highlights
          .split('\n')
          .map((item) =>
            item.trim(),
          )
          .filter(Boolean)

      const updated =
        await updateGeneration(
          generation.id,
          {
            title:
              editForm.title,
            description:
              editForm.description,
            highlights:
              highlightsArray,
            callToAction:
              editForm.callToAction,
          },
        )

      setGeneration(updated)
      setIsEditing(false)
    } catch {
      setEditError(
        'No se pudieron guardar los cambios. Inténtalo de nuevo.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!generation) return

    const confirmed =
      window.confirm(
        '¿Estás seguro de que deseas eliminar este anuncio? Esta acción no se puede deshacer.',
      )

    if (!confirmed) return

    setDeleting(true)

    try {
      await deleteGeneration(
        generation.id,
      )

      navigate('/historial')
    } catch {
      alert(
        'No se pudo eliminar el anuncio. Inténtalo de nuevo.',
      )

      setDeleting(false)
    }
  }

  async function handleCopy() {
    if (
      !generation ||
      copying
    ) {
      return
    }

    setCopying(true)
    setCopySuccess(false)

    try {
      const highlights =
        parseHighlights(
          generation.highlights,
        )

      const text = [
        generation.title,
        '',
        generation.description,
        '',
        highlights.length > 0
          ? [
              'Características destacadas:',
              ...highlights.map(
                (highlight) =>
                  `• ${highlight}`,
              ),
            ].join('\n')
          : '',
        '',
        generation.callToAction,
      ]
        .filter(
          (section) =>
            section.trim().length > 0,
        )
        .join('\n')

      await navigator.clipboard.writeText(
        text,
      )

      setCopySuccess(true)
    } catch {
      setCopySuccess(false)
    } finally {
      setCopying(false)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">
          Cargando anuncio...
        </h1>

        <p className="mt-4 text-muted-foreground">
          Obteniendo la información del
          anuncio.
        </p>
      </div>
    )
  }

  if (error || !generation) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">
          Anuncio no encontrado
        </h1>

        <p className="mt-2 text-muted-foreground">
          {error ??
            'No se encontró el anuncio solicitado.'}
        </p>

        <Link
          to="/historial"
          className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
        >
          ← Volver a Anuncios
        </Link>
      </div>
    )
  }

  const { property } =
    generation

  const highlights =
    parseHighlights(
      generation.highlights,
    )

  return (
    <div className="max-w-4xl">
      {/* =====================================================
          CABECERA
      ====================================================== */}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/historial"
          className="text-sm font-medium text-primary hover:underline"
        >
          ← Volver a Anuncios
        </Link>

        <div className="flex items-center gap-2">
          {!isEditing && (
            <>
              <button
                type="button"
                onClick={
                  handleStartEdit
                }
                className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted"
              >
                Editar
              </button>

              <button
                type="button"
                onClick={() =>
                  void handleDelete()
                }
                disabled={deleting}
                className="rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
              >
                {deleting
                  ? 'Eliminando...'
                  : 'Eliminar'}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() =>
              void handleCopy()
            }
            disabled={
              copying ||
              isEditing ||
              deleting
            }
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copying
              ? 'Copiando...'
              : copySuccess
                ? 'Copiado'
                : 'Copiar anuncio'}
          </button>
        </div>
      </div>

      {/* =====================================================
          EDICIÃN
      ====================================================== */}

      {isEditing ? (
        <div className="mt-6 rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">
              Editar anuncio
            </h2>

            <button
              type="button"
              onClick={
                handleCancelEdit
              }
              disabled={saving}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>

          <div className="mt-6 space-y-5">
            {/* TÍTULO */}

            <div>
              <label
                htmlFor="edit-title"
                className="text-sm font-medium"
              >
                Título
              </label>

              <input
                id="edit-title"
                type="text"
                value={
                  editForm.title
                }
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    title:
                      e.target.value,
                  })
                }
                disabled={saving}
                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
              />
            </div>

            {/* DESCRIPCIÃN */}

            <div>
              <label
                htmlFor="edit-description"
                className="text-sm font-medium"
              >
                Descripción
              </label>

              <textarea
                id="edit-description"
                rows={8}
                value={
                  editForm.description
                }
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    description:
                      e.target.value,
                  })
                }
                disabled={saving}
                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary disabled:opacity-50"
              />
            </div>

            {/* HIGHLIGHTS */}

            <div>
              <label
                htmlFor="edit-highlights"
                className="text-sm font-medium"
              >
                Características destacadas
              </label>

              <p className="mt-1 text-xs text-muted-foreground">
                Escribe una característica
                por línea.
              </p>

              <textarea
                id="edit-highlights"
                rows={5}
                value={
                  editForm.highlights
                }
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    highlights:
                      e.target.value,
                  })
                }
                disabled={saving}
                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary disabled:opacity-50"
              />
            </div>

            {/* CTA */}

            <div>
              <label
                htmlFor="edit-cta"
                className="text-sm font-medium"
              >
                Llamada a la acción
              </label>

              <textarea
                id="edit-cta"
                rows={3}
                value={
                  editForm.callToAction
                }
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    callToAction:
                      e.target.value,
                  })
                }
                disabled={saving}
                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary disabled:opacity-50"
              />
            </div>

            {editError && (
              <p className="text-sm text-destructive">
                {editError}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={
                  handleCancelEdit
                }
                disabled={saving}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() =>
                  void handleSaveEdit()
                }
                disabled={saving}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saving
                  ? 'Guardando...'
                  : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* =================================================
              CABECERA DEL ANUNCIO
          ================================================== */}

          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary capitalize">
                {generation.provider}
              </span>

              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {getToneLabel(
                  generation.tone,
                )}
              </span>

              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize">
                {generation.language ===
                'es'
                  ? 'Español'
                  : generation.language}
              </span>
            </div>

            <h1 className="mt-4 text-3xl font-bold">
              {generation.title}
            </h1>
          </div>

          {/* =================================================
              RESUMEN DEL ANUNCIO
          ================================================== */}

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Precio
              </p>

              <p className="mt-1 text-lg font-semibold">
                {property.price.toLocaleString(
                  'es-ES',
                )}{' '}
                €
              </p>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Superficie
              </p>

              <p className="mt-1 text-lg font-semibold">
                {property.area} m²
              </p>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Habitaciones
              </p>

              <p className="mt-1 text-lg font-semibold">
                {property.bedrooms}
              </p>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Baños
              </p>

              <p className="mt-1 text-lg font-semibold">
                {property.bathrooms}
              </p>
            </div>
          </div>

          {/* =================================================
              DESCRIPCIÃN
          ================================================== */}

          <section className="mt-8 rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold">
              Descripción
            </h2>

            <p className="mt-4 whitespace-pre-line leading-7">
              {generation.description}
            </p>
          </section>

          {/* =================================================
              HIGHLIGHTS
          ================================================== */}

          <section className="mt-6 rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold">
              Características destacadas
            </h2>

            {highlights.length ===
            0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No se han indicado
                características destacadas.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {highlights.map(
                  (highlight) => (
                    <li
                      key={highlight}
                      className="rounded-md bg-muted px-3 py-2 text-sm"
                    >
                      {highlight}
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>

          {/* =================================================
              LLAMADA A LA ACCIÃN
          ================================================== */}

          <section className="mt-6 rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold">
              Llamada a la acción
            </h2>

            <p className="mt-4 whitespace-pre-line leading-7">
              {generation.callToAction}
            </p>
          </section>

          {/* =================================================
              INFORMACIÃN DE GENERACIÃN
          ================================================== */}

          <section className="mt-6 rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold">
              Información de generación
            </h2>

            <dl className="mt-4 grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">
                  Proveedor
                </dt>

                <dd className="mt-1 font-medium capitalize">
                  {generation.provider}
                </dd>
              </div>

              <div>
                <dt className="text-sm text-muted-foreground">
                  Tono
                </dt>

                <dd className="mt-1 font-medium">
                  {getToneLabel(
                    generation.tone,
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-sm text-muted-foreground">
                  Idioma
                </dt>

                <dd className="mt-1 font-medium capitalize">
                  {generation.language ===
                  'es'
                    ? 'Español'
                    : generation.language}
                </dd>
              </div>

              <div>
                <dt className="text-sm text-muted-foreground">
                  Generado
                </dt>

                <dd className="mt-1 font-medium">
                  {new Date(
                    generation.createdAt,
                  ).toLocaleString(
                    'es-ES',
                  )}
                </dd>
              </div>
            </dl>
          </section>

          {/* =================================================
              INFORMACIÃN DEL INMUEBLE ASOCIADO
          ================================================== */}

          <section className="mt-6 rounded-lg border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                Información del inmueble
              </h2>

              <Link
                to={`/inmuebles/${property.id}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                Ver inmueble →
              </Link>
            </div>

            <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {/* Precio */}

              <div>
                <dt className="text-sm text-muted-foreground">
                  Precio
                </dt>

                <dd className="mt-1 font-medium">
                  {property.price.toLocaleString(
                    'es-ES',
                  )}{' '}
                  €
                </dd>
              </div>

              {/* Operación */}

              <div>
                <dt className="text-sm text-muted-foreground">
                  Operación
                </dt>

                <dd className="mt-1 font-medium">
                  {getOperationLabel(
                    property.operation,
                  )}
                </dd>
              </div>

              {/* Tipo */}

              <div>
                <dt className="text-sm text-muted-foreground">
                  Tipo
                </dt>

                <dd className="mt-1 font-medium">
                  {getPropertyTypeLabel(
                    property.type,
                  )}
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
                  {property.city ||
                    'No indicada'}
                </dd>
              </div>

              {/* Zona */}

              <div>
                <dt className="text-sm text-muted-foreground">
                  Zona
                </dt>

                <dd className="mt-1 font-medium">
                  {property.neighborhood ||
                    'No indicado'}
                </dd>
              </div>

              {/* Dirección */}

              <div>
                <dt className="text-sm text-muted-foreground">
                  Dirección
                </dt>

                <dd className="mt-1 font-medium">
                  {property.address ||
                    'No indicada'}
                </dd>
              </div>

              {/* Estado */}

              <div>
                <dt className="text-sm text-muted-foreground">
                  Estado
                </dt>

                <dd className="mt-1 font-medium">
                  {getConditionLabel(
                    (
                      property as {
                        condition?: string
                      }
                    ).condition,
                  )}
                </dd>
              </div>

              {/* Planta */}

              <div>
                <dt className="text-sm text-muted-foreground">
                  Planta
                </dt>

                <dd className="mt-1 font-medium">
                  {(
                    property as {
                      floor?:
                        | number
                        | null
                    }
                  ).floor ?? '—'}
                </dd>
              </div>

              {/* Fecha de creación */}

              <div>
                <dt className="text-sm text-muted-foreground">
                  Fecha de creación
                </dt>

                <dd className="mt-1 font-medium">
                  {generation.createdAt
                    ? new Date(
                        generation.createdAt,
                      ).toLocaleString(
                        'es-ES',
                      )
                    : 'No indicada'}
                </dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  )
}

export default GenerationDetailPage