import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import {
  getProperty,
  type PropertyItem,
} from '@/services/propertyService'

import {
  generatePropertyListing,
} from '@/services/propertyGenerationService'

function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [property, setProperty] =
    useState<PropertyItem | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] =
    useState<string | null>(null)

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

  async function handleGenerateListing() {
    if (!id) {
      return
    }

    setGenerating(true)
    setGenerationError(null)

    try {
      await generatePropertyListing({
        propertyId: id,
        tone: 'professional',
        language: 'es',
      })

      const updatedProperty = await getProperty(id)

      setProperty(updatedProperty)
    } catch {
      setGenerationError(
        'No se ha podido generar el anuncio.',
      )
    } finally {
      setGenerating(false)
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
          {error ?? 'No se ha encontrado el inmueble.'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <Link
        to="/inmuebles"
        className="text-sm font-medium text-primary hover:underline"
      >
        ← Volver a inmuebles
      </Link>

      <div className="mt-6 flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {property.operation}
          </p>

          <h1 className="mt-1 text-3xl font-bold">
            {property.type}
          </h1>

          <p className="mt-2 text-muted-foreground">
            {property.address || 'Sin dirección'}
            {property.city
              ? ` · ${property.city}`
              : ''}
            {property.neighborhood
              ? ` · ${property.neighborhood}`
              : ''}
          </p>
        </div>

        <p className="whitespace-nowrap text-2xl font-bold">
          {property.price.toLocaleString('es-ES')} €
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
            Estado
          </p>

          <p className="mt-1 text-xl font-semibold">
            {property.condition}
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          Características
        </h2>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {property.floor !== null && (
            <div className="rounded-md border p-4">
              Planta: {property.floor}
            </div>
          )}

          <div className="rounded-md border p-4">
            Ascensor:{' '}
            {property.elevator ? 'Sí' : 'No'}
          </div>

          <div className="rounded-md border p-4">
            Terraza:{' '}
            {property.terrace ? 'Sí' : 'No'}
          </div>

          <div className="rounded-md border p-4">
            Balcón:{' '}
            {property.balcony ? 'Sí' : 'No'}
          </div>

          <div className="rounded-md border p-4">
            Garaje:{' '}
            {property.garage ? 'Sí' : 'No'}
          </div>

          <div className="rounded-md border p-4">
            Piscina:{' '}
            {property.pool ? 'Sí' : 'No'}
          </div>

          <div className="rounded-md border p-4">
            Jardín:{' '}
            {property.garden ? 'Sí' : 'No'}
          </div>

          <div className="rounded-md border p-4">
            Aire acondicionado:{' '}
            {property.airConditioning ? 'Sí' : 'No'}
          </div>

          <div className="rounded-md border p-4">
            Calefacción:{' '}
            {property.heating ? 'Sí' : 'No'}
          </div>
        </div>
      </section>

      {property.additionalInformation && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold">
            Información adicional
          </h2>

          <p className="mt-3 whitespace-pre-wrap text-muted-foreground">
            {property.additionalInformation}
          </p>
        </section>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              Anuncios generados
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Anuncios creados para este inmueble.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              void handleGenerateListing()
            }}
            disabled={generating}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating
              ? 'Generando...'
              : 'Generar nuevo anuncio'}
          </button>
        </div>

        {generationError && (
          <p className="mt-3 text-sm text-destructive">
            {generationError}
          </p>
        )}

        {property.generations.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-6">
            <p className="text-sm text-muted-foreground">
              Este inmueble todavía no tiene anuncios
              generados.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {property.generations.map((generation) => (
              <Link
                key={generation.id}
                to={`/historial/${generation.id}`}
                className="block rounded-lg border bg-card p-5 transition hover:border-primary hover:shadow-sm"
              >
                <h3 className="font-semibold">
                  {generation.title}
                </h3>

                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {generation.description}
                </p>

                <p className="mt-3 text-xs text-muted-foreground">
                  {generation.provider} ·{' '}
                  {generation.language} ·{' '}
                  {generation.tone}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default PropertyDetailPage