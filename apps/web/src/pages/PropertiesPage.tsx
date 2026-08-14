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
        <h1 className="text-3xl font-bold">Inmuebles</h1>
        <p className="mt-4 text-muted-foreground">
          Cargando inmuebles...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Inmuebles</h1>
        <p className="mt-4 text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Inmuebles</h1>
          <p className="mt-2 text-muted-foreground">
            Gestiona los inmuebles registrados en EstateForge.
          </p>
        </div>

        <Link
          to="/inmuebles/nuevo"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Crear inmueble
        </Link>
      </div>

      {properties.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-8 text-center">
          <h2 className="font-semibold">
            Todavía no hay inmuebles
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            Crea tu primer inmueble para empezar a generar anuncios.
          </p>

          <Link
            to="/inmuebles/nuevo"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Crear primer inmueble
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((property) => (
            <Link
              key={property.id}
              to={`/inmuebles/${property.id}`}
              className="block rounded-lg border bg-card p-5 transition hover:border-primary hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">
                    {property.type}
                  </h2>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {property.city || 'Sin ciudad'}
                    {property.neighborhood
                      ? ` · ${property.neighborhood}`
                      : ''}
                  </p>
                </div>

                <span className="rounded-full bg-muted px-2 py-1 text-xs">
                  {property.operation === 'sale'
                    ? 'Venta'
                    : 'Alquiler'}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">
                    Precio
                  </p>
                  <p className="font-medium">
                    {property.price.toLocaleString('es-ES')} €
                  </p>
                </div>

                <div>
                  <p className="text-muted-foreground">
                    Superficie
                  </p>
                  <p className="font-medium">
                    {property.area} m²
                  </p>
                </div>

                <div>
                  <p className="text-muted-foreground">
                    Habitaciones
                  </p>
                  <p className="font-medium">
                    {property.bedrooms}
                  </p>
                </div>

                <div>
                  <p className="text-muted-foreground">
                    Baños
                  </p>
                  <p className="font-medium">
                    {property.bathrooms}
                  </p>
                </div>
              </div>

              <div className="mt-5 border-t pt-4 text-sm text-muted-foreground">
                {property.generations.length === 0
                  ? 'Sin anuncios generados'
                  : `${property.generations.length} anuncio${
                      property.generations.length === 1
                        ? ''
                        : 's'
                    } generado${
                      property.generations.length === 1
                        ? ''
                        : 's'
                    }`}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default PropertiesPage