import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  getProperty,
  type PropertyItem,
} from '../services/propertyService'

function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [property, setProperty] =
    useState<PropertyItem | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setError('Inmueble no encontrado.')
      setLoading(false)
      return
    }

    const propertyId = id

    async function loadProperty() {
      try {
        const data = await getProperty(propertyId)
        setProperty(data)
      } catch {
        setError('No se pudo cargar el inmueble.')
      } finally {
        setLoading(false)
      }
    }

    void loadProperty()
  }, [id])

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">
          Cargando inmueble...
        </h1>
      </div>
    )
  }

  if (error || !property) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">
          Inmueble no encontrado
        </h1>

        <p className="mt-2 text-muted-foreground">
          {error}
        </p>

        <Link
          to="/inmuebles"
          className="mt-4 inline-block text-sm underline"
        >
          ← Volver a inmuebles
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <Link
        to="/inmuebles"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Volver a inmuebles
      </Link>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {property.type}
          </h1>

          <p className="mt-2 text-muted-foreground">
            {property.address || 'Dirección no indicada'}
          </p>

          <p className="text-muted-foreground">
            {property.city || 'Ciudad no indicada'}
            {property.neighborhood
              ? ` · ${property.neighborhood}`
              : ''}
          </p>
        </div>

        <div className="text-left sm:text-right">
          <p className="text-2xl font-bold">
            {property.price.toLocaleString('es-ES')} €
          </p>

          <span className="text-sm text-muted-foreground">
            {property.operation === 'sale'
              ? 'Venta'
              : 'Alquiler'}
          </span>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          Características
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Superficie
            </p>
            <p className="mt-1 font-semibold">
              {property.area} m²
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Habitaciones
            </p>
            <p className="mt-1 font-semibold">
              {property.bedrooms}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Baños
            </p>
            <p className="mt-1 font-semibold">
              {property.bathrooms}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Planta
            </p>
            <p className="mt-1 font-semibold">
              {property.floor ?? '—'}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Estado y equipamiento
        </h2>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-muted px-3 py-1 text-sm">
            {property.condition}
          </span>

          {property.elevator && (
            <span className="rounded-full bg-muted px-3 py-1 text-sm">
              Ascensor
            </span>
          )}

          {property.terrace && (
            <span className="rounded-full bg-muted px-3 py-1 text-sm">
              Terraza
            </span>
          )}

          {property.balcony && (
            <span className="rounded-full bg-muted px-3 py-1 text-sm">
              Balcón
            </span>
          )}

          {property.garage && (
            <span className="rounded-full bg-muted px-3 py-1 text-sm">
              Garaje
            </span>
          )}

          {property.pool && (
            <span className="rounded-full bg-muted px-3 py-1 text-sm">
              Piscina
            </span>
          )}

          {property.garden && (
            <span className="rounded-full bg-muted px-3 py-1 text-sm">
              Jardín
            </span>
          )}

          {property.airConditioning && (
            <span className="rounded-full bg-muted px-3 py-1 text-sm">
              Aire acondicionado
            </span>
          )}

          {property.heating && (
            <span className="rounded-full bg-muted px-3 py-1 text-sm">
              Calefacción
            </span>
          )}
        </div>
      </section>

      {property.additionalInformation && (
        <section className="mt-8 rounded-lg border bg-card p-6">
          <h2 className="text-xl font-semibold">
            Información adicional
          </h2>

          <p className="mt-4 whitespace-pre-line leading-7">
            {property.additionalInformation}
          </p>
        </section>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              Anuncios generados
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Anuncios creados para este inmueble.
            </p>
          </div>

          <span className="rounded-full bg-muted px-3 py-1 text-sm">
            {property.generations.length}
          </span>
        </div>

        {property.generations.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-6 text-center">
            <p className="text-muted-foreground">
              Este inmueble todavía no tiene anuncios
              generados.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {property.generations.map((generation) => (
              <Link
                key={generation.id}
                to={`/historial/${generation.id}`}
                className="block rounded-lg border bg-card p-5 transition hover:border-primary hover:shadow-md"
              >
                <h3 className="font-semibold">
                  {generation.title}
                </h3>

                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                  {generation.description}
                </p>

                <p className="mt-4 text-xs text-muted-foreground">
                  {new Date(
                    generation.createdAt,
                  ).toLocaleString('es-ES')}
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