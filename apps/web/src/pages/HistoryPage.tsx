import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import {
  getGenerations,
  type GenerationItem,
} from '@/services/generationService'

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
      return []
    }
  }

  return []
}

function HistoryPage() {
  const [generations, setGenerations] =
    useState<GenerationItem[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] =
    useState<string | null>(null)

  // Estados para la paginación
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 5

  useEffect(() => {
    async function loadGenerations() {
      try {
        const result = await getGenerations()

        setGenerations(result)
      } catch {
        setError(
          'No se ha podido cargar el historial.',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadGenerations()
  }, [])

  // Scroll instantáneo hacia abajo cada vez que cambia la página (sin animación suave)
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

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Historial
        </h1>

        <p className="mt-4 text-muted-foreground">
          Cargando historial...
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

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-bold">
            Historial
          </h1>

          <p className="mt-2 text-muted-foreground">
            Consulta todos los anuncios generados en
            EstateForge.
          </p>
        </div>

        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          <span className="font-semibold">
            {generations.length}
          </span>{' '}
          {generations.length === 1
            ? 'anuncio generado'
            : 'anuncios generados'}
        </div>
      </div>

      {generations.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <h2 className="font-semibold">
            Todavía no hay anuncios
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            Genera un anuncio desde cualquiera de tus
            inmuebles para verlo aquí.
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
              const highlights = parseHighlights(
                generation.highlights,
              )

              return (
                <Link
                  key={generation.id}
                  to={`/historial/${generation.id}`}
                  className="block rounded-lg border bg-card p-6 transition hover:border-primary hover:shadow-md"
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
                        {generation.property.type}
                      </p>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {generation.property.city ||
                          'Sin ciudad'}
                      </p>

                      {generation.property
                        .neighborhood && (
                        <p className="text-sm text-muted-foreground">
                          {generation.property.neighborhood}
                        </p>
                      )}

                      <p className="mt-3 text-lg font-semibold">
                        {generation.property.price.toLocaleString(
                          'es-ES',
                        )}{' '}
                        €
                      </p>
                    </div>
                  </div>

                  {highlights.length > 0 && (
                    <div className="mt-5 border-t pt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Características destacadas
                      </p>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {highlights
                          .slice(0, 5)
                          .map((highlight) => (
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
                      {new Date(
                        generation.createdAt,
                      ).toLocaleString('es-ES')}
                    </p>

                    <span className="text-sm font-medium text-primary">
                      Ver anuncio →
                    </span>
                  </div>
                </Link>
              )
            })}
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
    </div>
  )
}

export default HistoryPage