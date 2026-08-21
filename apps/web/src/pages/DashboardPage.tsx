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

// Diccionario de traducción para los tipos de inmueble
const propertyTypeLabels: Record<string, string> = {
  flat: 'Piso',
  house: 'Casa',
  chalet: 'Chalet',
  penthouse: 'Ático',
  duplex: 'Dúplex',
  studio: 'Estudio',
  commercial: 'Local comercial',
  office: 'Oficina',
  land: 'Terreno',
}

// Diccionario de traducción para las operaciones
const operationLabels: Record<string, string> = {
  sale: 'Venta',
  rent: 'Alquiler',
  transfer: 'Traspaso',
}

// Diccionario de traducción para los tonos
const toneLabels: Record<string, string> = {
  professional: 'Profesional',
  friendly: 'Amigable',
  commercial: 'Comercial',
  luxurious: 'De lujo',
  casual: 'Casual',
  persuasive: 'Persuasivo',
  direct: 'Directo',
}

function getPropertyTypeLabel(type: string | undefined): string {
  if (!type) return 'No indicado'
  return propertyTypeLabels[type.toLowerCase()] || type
}

function getOperationLabel(operation: string | undefined): string {
  if (!operation) return 'No indicada'
  return operationLabels[operation.toLowerCase()] || operation
}

function getToneLabel(tone: string | undefined): string {
  if (!tone) return 'No indicado'
  return toneLabels[tone.toLowerCase()] || tone
}

function DashboardPage() {
  const [properties, setProperties] = useState<PropertyItem[]>([])
  const [stats, setStats] =
    useState<DashboardStats | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] =
    useState<string | null>(null)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [
          propertiesResult,
          statsResult,
        ] = await Promise.all([
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

  const recentGenerations = properties
    .flatMap((property) =>
      property.generations.map((generation) => ({
        ...generation,
        property,
      })),
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime(),
    )
    .slice(0, 6)

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Dashboard
        </h1>

        <p className="mt-4 text-muted-foreground">
          Cargando datos...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">
          Dashboard
        </h1>

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
            {stats?.properties ?? properties.length}
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
            {stats?.generations ??
              properties.reduce(
                (total, property) =>
                  total + property.generations.length,
                0,
              )}
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
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
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
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {getOperationLabel(property.operation)}
                      </span>

                      <span className="text-xs text-muted-foreground">
                        ·
                      </span>

                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {getPropertyTypeLabel(property.type)}
                      </span>

                      <span className="text-xs text-muted-foreground">
                        ·
                      </span>

                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {property.city || 'Sin ciudad'}
                        {property.neighborhood
                          ? ` (${property.neighborhood})`
                          : ''}
                      </span>
                    </div>

                    <h3 className="mt-1.5 text-lg font-semibold">
                      {property.title ||
                        `${getPropertyTypeLabel(property.type)} en ${getOperationLabel(property.operation).toLowerCase()}`}
                    </h3>
                  </div>

                  <div className="sm:text-right">
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

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {property.area} m²
                  </span>

                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {property.bedrooms}{' '}
                    {property.bedrooms === 1
                      ? 'habitación'
                      : 'habitaciones'}
                  </span>

                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {property.bathrooms}{' '}
                    {property.bathrooms === 1
                      ? 'baño'
                      : 'baños'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold">
              Anuncios recientes
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Los últimos anuncios generados.
            </p>
          </div>

          <Link
            to="/historial"
            className="text-sm font-medium text-primary hover:underline"
          >
            Ver historial
          </Link>
        </div>

        {recentGenerations.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed p-8 text-center">
            <h3 className="font-semibold">
              Todavía no hay anuncios
            </h3>

            <p className="mt-2 text-sm text-muted-foreground">
              Genera un anuncio desde el detalle de un
              inmueble.
            </p>

            <Link
              to="/inmuebles"
              className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Ver inmuebles
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {recentGenerations.map((generation) => (
              <Link
                key={generation.id}
                to={`/historial/${generation.id}`}
                className="rounded-lg border bg-card p-5 transition hover:border-primary hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">
                      {generation.title}
                    </h3>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {generation.property.city ||
                        'Sin ciudad'}
                      {generation.property.neighborhood
                        ? ` · ${generation.property.neighborhood}`
                        : ''}
                    </p>
                  </div>
                </div>

                <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">
                  {generation.description}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary capitalize">
                    {generation.provider}
                  </span>

                  <span className="rounded-md bg-muted px-2 py-1 text-xs">
                    {getToneLabel(generation.tone)}
                  </span>

                  <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                    {generation.language === 'es'
                      ? 'Español'
                      : generation.language}
                  </span>
                </div>

                <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                  Generado el{' '}
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

export default DashboardPage