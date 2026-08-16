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
  const [error, setError] =
    useState<string | null>(null)

  const [generating, setGenerating] =
    useState(false)

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

  return (
    <div className="max-w-6xl">
      <Link
        to="/inmuebles"
        className="text-sm font-medium text-primary hover:underline"
      >
        ← Volver a inmuebles
      </Link>

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
            {property.price.toLocaleString('es-ES')} €
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
              {property.neighborhood || 'No indicado'}
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
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold">
              Generar anuncio
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Crea un nuevo anuncio utilizando este
              inmueble como información de origen.
            </p>
          </div>

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
              {property.generations.length === 0
                ? 'Todavía no hay anuncios para este inmueble.'
                : `${property.generations.length} ${
                    property.generations.length === 1
                      ? 'anuncio generado'
                      : 'anuncios generados'
                  }.`}
            </p>
          </div>

          {property.generations.length > 0 && (
            <Link
              to="/historial"
              className="text-sm font-medium text-primary hover:underline"
            >
              Ver historial
            </Link>
          )}
        </div>

        {property.generations.length === 0 ? (
          <div className="mt-5 rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Genera el primer anuncio para este
              inmueble.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {property.generations.map(
              (generation) => (
                <Link
                  key={generation.id}
                  to={`/historial/${generation.id}`}
                  className="block rounded-lg border bg-card p-5 transition hover:border-primary hover:shadow-sm"
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div>
                      <h3 className="font-semibold">
                        {generation.title}
                      </h3>

                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {generation.description}
                      </p>
                    </div>

                    <span className="w-fit shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                      {generation.provider}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-md bg-muted px-2 py-1 text-xs">
                      {generation.language === 'es'
                        ? 'Español'
                        : generation.language}
                    </span>

                    <span className="rounded-md bg-muted px-2 py-1 text-xs">
                      {generation.tone}
                    </span>
                  </div>

                  <div className="mt-4 border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      Generado el{' '}
                      {new Date(
                        generation.createdAt,
                      ).toLocaleString('es-ES')}
                    </p>
                  </div>
                </Link>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  )
}

export default PropertyDetailPage