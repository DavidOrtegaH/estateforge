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
        const data = await getProperties()
        setProperties(data)
      } catch {
        setError('No se pudieron cargar los inmuebles.')
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

        <p className="mt-4 text-red-600">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Inmuebles
          </h1>

          <p className="mt-2 text-muted-foreground">
            Propiedades almacenadas en EstateForge.
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
          <p className="text-muted-foreground">
            Todavía no hay inmuebles registrados.
          </p>

          <Link
            to="/inmuebles/nuevo"
            className="mt-4 inline-block text-sm underline"
          >
            Crear el primer inmueble
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((property) => (
            <Link
              key={property.id}
              to={`/inmuebles/${property.id}`}
              className="rounded-lg border bg-card p-5 shadow-sm transition hover:border-primary hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">
                    {property.type}
                  </h2>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {property.city || 'Ubicación no indicada'}
                  </p>
                </div>

                <span className="text-sm font-semibold">
                  {property.price.toLocaleString('es-ES')} €
                </span>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
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

              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full bg-muted px-3 py-1 text-xs">
                  {property.operation === 'sale'
                    ? 'Venta'
                    : 'Alquiler'}
                </span>

                <span className="rounded-full bg-muted px-3 py-1 text-xs">
                  {property.condition}
                </span>

                {property.terrace && (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs">
                    Terraza
                  </span>
                )}

                {property.garage && (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs">
                    Garaje
                  </span>
                )}

                {property.pool && (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs">
                    Piscina
                  </span>
                )}
              </div>

              <div className="mt-5 border-t pt-4 text-xs text-muted-foreground">
                {property.generations.length === 1
                  ? '1 anuncio generado'
                  : `${property.generations.length} anuncios generados`}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default PropertiesPage