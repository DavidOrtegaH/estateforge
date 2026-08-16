import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getGeneration } from '@/services/generationDetailService'
import type { GenerationHistoryItem } from '@/services/generationHistoryService'

function GenerationDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [generation, setGeneration] =
    useState<GenerationHistoryItem | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setError('Anuncio no encontrado.')
      setLoading(false)
      return
    }

    const generationId = id

    async function loadGeneration() {
      try {
        const data = await getGeneration(generationId)
        setGeneration(data)
      } catch {
        setError('No se pudo cargar el anuncio.')
      } finally {
        setLoading(false)
      }
    }

    void loadGeneration()
  }, [id])

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">
          Cargando anuncio...
        </h1>
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
          {error ?? 'No se encontró el anuncio solicitado.'}
        </p>

        <Link
          to="/historial"
          className="mt-4 inline-block text-sm underline"
        >
          ← Volver al historial
        </Link>
      </div>
    )
  }

  const { property } = generation

  return (
    <div className="max-w-4xl">
      <Link
        to="/historial"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Volver al historial
      </Link>

      <div className="mt-6">
        <h1 className="text-3xl font-bold">
          {generation.title}
        </h1>

        <p className="mt-2 text-muted-foreground">
          {property.city}
          {property.neighborhood
            ? ` · ${property.neighborhood}`
            : ''}
        </p>
        <Link
          to={`/inmuebles/${property.id}`}
          className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
        >
          Ver inmueble →
        </Link>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Precio
          </p>

          <p className="mt-1 text-lg font-semibold">
            {property.price.toLocaleString('es-ES')} €
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Superficie
          </p>

          <p className="mt-1 text-lg font-semibold">
            {property.area} m²
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Habitaciones
          </p>

          <p className="mt-1 text-lg font-semibold">
            {property.bedrooms}
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Baños
          </p>

          <p className="mt-1 text-lg font-semibold">
            {property.bathrooms}
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Descripción
        </h2>

        <p className="mt-4 whitespace-pre-line leading-7">
          {generation.description}
        </p>
      </section>

      <section className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Características destacadas
        </h2>

        <ul className="mt-4 list-disc space-y-2 pl-5">
          {generation.highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Llamada a la acción
        </h2>

        <p className="mt-4">
          {generation.callToAction}
        </p>
      </section>

      <section className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Información de generación
        </h2>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">
              Proveedor
            </dt>

            <dd className="mt-1">
              {generation.provider}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Tono
            </dt>

            <dd className="mt-1">
              {generation.tone}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Idioma
            </dt>

            <dd className="mt-1">
              {generation.language}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Generado
            </dt>

            <dd className="mt-1">
              {new Date(
                generation.createdAt,
              ).toLocaleString('es-ES')}
            </dd>
          </div>
        </dl>
      </section>
      <section className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Inmueble asociado
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          {property.city}
          {property.neighborhood
            ? ` · ${property.neighborhood}`
            : ''}
        </p>

        <Link
          to={`/inmuebles/${property.id}`}
          className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
        >
          Ver inmueble →
        </Link>
      </section>
    </div>
  )
}

export default GenerationDetailPage