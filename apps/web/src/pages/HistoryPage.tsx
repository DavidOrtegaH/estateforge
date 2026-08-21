import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import {
  getGenerations,
  updateGeneration,
  deleteGeneration,
  type GenerationItem,
} from '@/services/generationService'

// Diccionario de traducción para los tipos de inmueble
const propertyTypeLabels: Record<string, string> = {
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

function getPropertyTypeLabel(type: string | undefined): string {
  if (!type) return 'No indicado'
  return propertyTypeLabels[type.toLowerCase()] || type
}

function parseHighlights(highlights: unknown): string[] {
  if (Array.isArray(highlights)) {
    return highlights.filter(
      (item): item is string => typeof item === 'string',
    )
  }

  if (typeof highlights === 'string') {
    try {
      const parsed: unknown = JSON.parse(highlights)

      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === 'string',
        )
      }
    } catch {
      if (highlights.trim().length > 0) {
        return highlights
          .split('\n')
          .map((item) => item.replace(/^[-•*]\s*/, '').trim())
          .filter(Boolean)
      }
    }
  }

  return []
}

function HistoryPage() {
  const [generations, setGenerations] = useState<GenerationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Estados para la paginación
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 5

  // Estados para la edición y eliminación por ID
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    highlights: '',
    callToAction: '',
  })

  useEffect(() => {
    async function loadGenerations() {
      try {
        const result = await getGenerations()
        setGenerations(result)
      } catch {
        setError('No se ha podido cargar el historial.')
      } finally {
        setLoading(false)
      }
    }

    void loadGenerations()
  }, [])

  // Scroll instantáneo hacia abajo cada vez que cambia la página
  useEffect(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    })
  }, [currentPage])

  // Cálculos de paginación
  const totalPages = Math.ceil(generations.length / itemsPerPage)
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentGenerations = generations.slice(indexOfFirstItem, indexOfLastItem)

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

  function handleStartEdit(generation: GenerationItem, e: React.MouseEvent) {
    e.preventDefault() // Evita que el Link navegue al detalle
    const parsedHighlights = parseHighlights(generation.highlights)

    setEditForm({
      title: generation.title || '',
      description: generation.description || '',
      highlights: parsedHighlights.join('\n'),
      callToAction: generation.callToAction || '',
    })
    setEditError(null)
    setEditingId(generation.id)
  }

  function handleCancelEdit(e: React.MouseEvent) {
    e.preventDefault()
    setEditingId(null)
    setEditError(null)
  }

  async function handleSaveEdit(id: string, e: React.MouseEvent) {
    e.preventDefault()
    setSaving(true)
    setEditError(null)

    try {
      const highlightsArray = editForm.highlights
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)

      const updated = await updateGeneration(id, {
        title: editForm.title,
        description: editForm.description,
        highlights: highlightsArray.join('\n'),
        callToAction: editForm.callToAction,
      })

      setGenerations((prev) =>
        prev.map((item) => (item.id === id ? updated : item)),
      )
      setEditingId(null)
    } catch {
      setEditError('No se pudieron guardar los cambios.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.preventDefault()
    const confirmed = window.confirm(
      '¿Estás seguro de que deseas eliminar este anuncio? Esta acción no se puede deshacer.',
    )

    if (!confirmed) return

    setDeletingId(id)

    try {
      await deleteGeneration(id)
      setGenerations((prev) => prev.filter((item) => item.id !== id))
    } catch {
      alert('No se pudo eliminar el anuncio.')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Historial</h1>
        <p className="mt-4 text-muted-foreground">Cargando historial...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Historial</h1>
        <p className="mt-4 text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-bold">Historial</h1>
          <p className="mt-2 text-muted-foreground">
            Consulta todos los anuncios generados en EstateForge.
          </p>
        </div>

        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          <span className="font-semibold">{generations.length}</span>{' '}
          {generations.length === 1 ? 'anuncio generado' : 'anuncios generados'}
        </div>
      </div>

      {generations.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <h2 className="font-semibold">Todavía no hay anuncios</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Genera un anuncio desde cualquiera de tus inmuebles para verlo aquí.
          </p>
          <Link
            to="/inmuebles"
            className="mt-5 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Ver inmuebles
          </Link>
        </div>
      ) : (
        <div>
          <div className="mt-8 space-y-4">
            {currentGenerations.map((generation) => {
              const highlights = parseHighlights(generation.highlights)
              const isBeingEdited = editingId === generation.id

              return (
                <div
                  key={generation.id}
                  className="rounded-lg border bg-card p-6 transition hover:border-primary hover:shadow-md"
                >
                  {isBeingEdited ? (
                    // FORMULARIO DE EDICIÓN EN LÍNEA
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold">Editar anuncio</h2>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={saving}
                          className="text-sm text-muted-foreground hover:text-foreground"
                        >
                          Cancelar
                        </button>
                      </div>

                      <div>
                        <label className="text-sm font-medium">Título</label>
                        <input
                          type="text"
                          value={editForm.title}
                          onChange={(e) =>
                            setEditForm({ ...editForm, title: e.target.value })
                          }
                          disabled={saving}
                          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium">Descripción</label>
                        <textarea
                          rows={4}
                          value={editForm.description}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              description: e.target.value,
                            })
                          }
                          disabled={saving}
                          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium">
                          Características (una por línea)
                        </label>
                        <textarea
                          rows={3}
                          value={editForm.highlights}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              highlights: e.target.value,
                            })
                          }
                          disabled={saving}
                          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium">
                          Llamada a la acción
                        </label>
                        <textarea
                          rows={2}
                          value={editForm.callToAction}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              callToAction: e.target.value,
                            })
                          }
                          disabled={saving}
                          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>

                      {editError && (
                        <p className="text-sm text-destructive">{editError}</p>
                      )}

                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={saving}
                          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={(e) => void handleSaveEdit(generation.id, e)}
                          disabled={saving}
                          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                        >
                          {saving ? 'Guardando...' : 'Guardar cambios'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    // VISTA NORMAL DE LA TARJETA
                    <Link
                      to={`/historial/${generation.id}`}
                      className="block"
                    >
                      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                              {generation.provider}
                            </span>
                            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                              {generation.tone}
                            </span>
                            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                              {generation.language}
                            </span>
                          </div>

                          <h2 className="mt-3 text-xl font-semibold">
                            {generation.title}
                          </h2>

                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {generation.description}
                          </p>
                        </div>

                        <div className="shrink-0 lg:w-64 lg:text-right">
                          <p className="text-sm font-medium">
                            {getPropertyTypeLabel(generation.property.type)}
                          </p>

                          <p className="mt-1 text-sm text-muted-foreground">
                            {generation.property.city || 'Sin ciudad'}
                          </p>

                          {generation.property.neighborhood && (
                            <p className="text-sm text-muted-foreground">
                              {generation.property.neighborhood}
                            </p>
                          )}

                          <p className="mt-3 text-lg font-semibold">
                            {generation.property.price.toLocaleString('es-ES')} €
                          </p>
                        </div>
                      </div>

                      {highlights.length > 0 && (
                        <div className="mt-5 border-t pt-4">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Características destacadas
                          </p>

                          <div className="mt-2 flex flex-wrap gap-2">
                            {highlights.slice(0, 5).map((highlight) => (
                              <span
                                key={highlight}
                                className="rounded-md bg-muted px-2.5 py-1 text-xs"
                              >
                                {highlight}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-5 flex flex-col justify-between gap-2 border-t pt-4 sm:flex-row sm:items-center">
                        <p className="text-xs text-muted-foreground">
                          Generado el{' '}
                          {new Date(generation.createdAt).toLocaleString('es-ES')}
                        </p>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={(e) => handleStartEdit(generation, e)}
                            className="text-sm font-medium text-muted-foreground hover:text-foreground"
                          >
                            Editar
                          </button>

                          <button
                            type="button"
                            onClick={(e) => void handleDelete(generation.id, e)}
                            disabled={deletingId === generation.id}
                            className="text-sm font-medium text-destructive hover:underline disabled:opacity-50"
                          >
                            {deletingId === generation.id
                              ? 'Eliminando...'
                              : 'Eliminar'}
                          </button>

                          <span className="text-sm font-medium text-primary">
                            Ver anuncio →
                          </span>
                        </div>
                      </div>
                    </Link>
                  )}
                </div>
              )
            })}
          </div>

          {/* Controles de Paginación */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between border-t pt-4">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Anterior
              </button>

              <span className="text-sm text-muted-foreground">
                Página <span className="font-semibold">{currentPage}</span> de{' '}
                <span className="font-semibold">{totalPages}</span>
              </span>

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
    </div>
  )
}

export default HistoryPage