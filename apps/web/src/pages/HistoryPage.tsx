import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  getGenerationHistory,
  type GenerationHistoryItem,
} from '@/services/generationHistoryService'

function HistoryPage() {
  const [generations, setGenerations] = useState<
    GenerationHistoryItem[]
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadHistory() {
      try {
        const data = await getGenerationHistory()
        setGenerations(data)
      } catch {
        setError('No se pudo cargar el historial.')
      } finally {
        setLoading(false)
      }
    }

    void loadHistory()
  }, [])

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">
          Historial
        </h1>

        <p className="mt-4 text-slate-500">
          Cargando anuncios...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">
          Historial
        </h1>

        <p className="mt-4 text-red-600">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">
          Historial
        </h1>

        <p className="mt-1 text-slate-500">
          Anuncios generados anteriormente.
        </p>
      </div>

      {generations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-slate-500">
            Todavía no hay anuncios generados.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {generations.map((generation) => (
            <Link
              key={generation.id}
              to={`/historial/${generation.id}`}
              className="block rounded-lg border bg-white p-5 shadow-sm transition hover:border-primary hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {generation.title}
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    {generation.property.city}
                    {generation.property.neighborhood
                      ? ` · ${generation.property.neighborhood}`
                      : ''}
                  </p>
                </div>

                <span className="text-sm font-medium">
                  {generation.property.price.toLocaleString(
                    'es-ES',
                  )}{' '}
                  €
                </span>
              </div>

              <p className="mt-4 line-clamp-3 text-sm text-slate-600">
                {generation.description}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                  {generation.property.area} m²
                </span>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                  {generation.property.bedrooms} hab.
                </span>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                  {generation.property.bathrooms} baños
                </span>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                  {generation.property.type}
                </span>
              </div>

              <p className="mt-4 text-xs text-slate-400">
                {new Date(
                  generation.createdAt,
                ).toLocaleString('es-ES')}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default HistoryPage