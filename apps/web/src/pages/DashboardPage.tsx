import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import {
  getProperties,
  type PropertyItem,
} from '@/services/propertyService'

import {
  getDashboardStats,
  type DashboardStats,
} from '@/services/dashboardService'

function DashboardPage() {
  const [properties, setProperties] = useState<PropertyItem[]>([])
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [propertiesResult, statsResult] =
          await Promise.all([
            getProperties(),
            getDashboardStats(),
          ])

        setProperties(propertiesResult)
        setStats(statsResult)
      } catch {
        setError(
          'No se han podido cargar los datos del dashboard.',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadDashboard()
  }, [])

  const recentProperties = [...properties]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime(),
    )
    .slice(0, 5)

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>

        <p className="mt-4 text-muted-foreground">
          Cargando datos...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>

        <p className="mt-4 text-destructive">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div>
        <h1 className="text-3xl font-bold">
          Dashboard
        </h1>

        <p className="mt-2 text-muted-foreground">
          Resumen de tu actividad en EstateForge.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Inmuebles
          </p>

          <p className="mt-2 text-3xl font-bold">
            {stats?.properties ?? 0}
          </p>

          <Link
            to="/inmuebles"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            Ver inmuebles →
          </Link>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Anuncios generados
          </p>

          <p className="mt-2 text-3xl font-bold">
            {stats?.generations ?? 0}
          </p>

          <Link
            to="/historial"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            Ver historial →
          </Link>
        </div>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              Inmuebles recientes
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Los últimos inmuebles añadidos.
            </p>
          </div>

          <Link
            to="/inmuebles"
            className="text-sm font-medium text-primary hover:underline"
          >
            Ver todos
          </Link>
        </div>

        {recentProperties.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed p-8 text-center">
            <h3 className="font-semibold">
              Todavía no hay inmuebles
            </h3>

            <p className="mt-2 text-sm text-muted-foreground">
              Crea tu primer inmueble para empezar.
            </p>

            <Link
              to="/inmuebles/nuevo"
              className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Crear inmueble
            </Link>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {recentProperties.map((property) => (
              <Link
                key={property.id}
                to={`/inmuebles/${property.id}`}
                className="block rounded-lg border bg-card p-4 transition hover:border-primary hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-medium">
                      {property.type}
                    </h3>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {property.city || 'Sin ciudad'}
                      {property.neighborhood
                        ? ` · ${property.neighborhood}`
                        : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-semibold">
                      {property.price.toLocaleString(
                        'es-ES',
                      )}{' '}
                      €
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {property.generations.length}{' '}
                      {property.generations.length === 1
                        ? 'anuncio'
                        : 'anuncios'}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default DashboardPage