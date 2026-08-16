import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import {
  getProperties,
  type PropertyItem,
} from '@/services/propertyService'

function PropertiesPage() {
  const [properties, setProperties] = useState<PropertyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadProperties() {
      try {
        const result = await getProperties()
        setProperties(result)
      } catch {
        setError('No se han podido cargar los inmuebles.')
      } finally {
        setLoading(false)
      }
    }

    void loadProperties()
  }, [])

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Inmuebles
        </h1>

        <p className="mt-4 text-muted-foreground">
          Cargando inmuebles...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Inmuebles
        </h1>

        <p className="mt-4 text-destructive">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold">
            Inmuebles
          </h1>

          <p className="mt-2 text-muted-foreground">
            Gestiona los inmuebles y sus anuncios generados.
          </p>
        </div>

        <Link
          to="/inmuebles/nuevo"
          className="inline-flex w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Crear inmueble
        </Link>
      </div>

      {properties.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <h2 className="font-semibold">
            No hay inmuebles todavía
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            Crea tu primer inmueble para empezar a generar
            anuncios.
          </p>

          <Link
            to="/inmuebles/nuevo"
            className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Crear inmueble
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((property) => {
            const generationCount =
              property.generations.length

            return (
              <Link
                key={property.id}
                to={`/inmuebles/${property.id}`}
                className="block rounded-lg border bg-card p-5 transition hover:border-primary hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {property.operation}
                    </p>

                    <h2 className="mt-1 text-lg font-semibold">
                      {property.type}
                    </h2>
                  </div>

                  <p className="whitespace-nowrap text-lg font-bold">
                    {property.price.toLocaleString('es-ES')}{' '}
                    €
                  </p>
                </div>

                <div className="mt-4">
                  <p className="text-sm">
                    {property.city || 'Sin ciudad'}
                  </p>

                  {property.neighborhood && (
                    <p className="text-sm text-muted-foreground">
                      {property.neighborhood}
                    </p>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-md bg-muted px-2 py-1">
                    {property.area} m²
                  </span>

                  <span className="rounded-md bg-muted px-2 py-1">
                    {property.bedrooms}{' '}
                    {property.bedrooms === 1
                      ? 'habitación'
                      : 'habitaciones'}
                  </span>

                  <span className="rounded-md bg-muted px-2 py-1">
                    {property.bathrooms}{' '}
                    {property.bathrooms === 1
                      ? 'baño'
                      : 'baños'}
                  </span>
                </div>

                <div className="mt-5 border-t pt-4">
                  <p className="text-xs text-muted-foreground">
                    Anuncios generados
                  </p>

                  <p className="mt-1 text-sm font-medium">
                    {generationCount}{' '}
                    {generationCount === 1
                      ? 'anuncio'
                      : 'anuncios'}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default PropertiesPage