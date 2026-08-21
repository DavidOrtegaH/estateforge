import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import {
  getGeneration,
  type GenerationItem,
} from '@/services/generationService'

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

function parseHighlights(
  highlights: unknown,
): string[] {
  if (Array.isArray(highlights)) {
    return highlights.filter(
      (item): item is string =>
        typeof item === 'string',
    )
  }

  if (typeof highlights === 'string') {
    try {
      const parsed: unknown =
        JSON.parse(highlights)

      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string =>
            typeof item === 'string',
        )
      }

      if (parsed && typeof parsed === 'object') {
        return []
      }
    } catch {
      if (highlights.trim().length > 0) {
        return highlights
          .split('\n')
          .map((item) =>
            item.replace(/^[-•*]\s*/, '').trim(),
          )
          .filter(Boolean)
      }
    }
  }

  return []
}

function GenerationDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [generation, setGeneration] =
    useState<GenerationItem | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] =
    useState<string | null>(null)

  const [copying, setCopying] = useState(false)
  const [copySuccess, setCopySuccess] =
    useState(false)

  useEffect(() => {
    if (!id) {
      setError('Anuncio no encontrado.')
      setLoading(false)
      return
    }

    const generationId = id

    async function loadGeneration() {
      try {
        const data =
          await getGeneration(generationId)

        setGeneration(data)
      } catch {
        setError(
          'No se pudo cargar el anuncio.',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadGeneration()
  }, [id])

  async function handleCopy() {
    if (!generation || copying) {
      return
    }

    setCopying(true)
    setCopySuccess(false)

    try {
      const highlights = parseHighlights(
        generation.highlights,
      )

      const text = [
        generation.title,
        '',
        generation.description,
        '',
        highlights.length > 0
          ? [
              'Características destacadas:',
              ...highlights.map(
                (highlight) => `• ${highlight}`,
              ),
            ].join('\n')
          : '',
        '',
        generation.callToAction,
      ]
        .filter(
          (section) => section.trim().length > 0,
        )
        .join('\n')

      await navigator.clipboard.writeText(text)

      setCopySuccess(true)
    } catch {
      setCopySuccess(false)
    } finally {
      setCopying(false)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">
          Cargando anuncio...
        </h1>

        <p className="mt-4 text-muted-foreground">
          Obteniendo la información del anuncio.
        </p>
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
          {error ??
            'No se encontró el anuncio solicitado.'}
        </p>

        <Link
          to="/historial"
          className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
        >
          ← Volver al historial
        </Link>
      </div>
    )
  }

  const { property } = generation

  const highlights = parseHighlights(
    generation.highlights,
  )

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/historial"
          className="text-sm font-medium text-primary hover:underline"
        >
          ← Volver al historial
        </Link>

        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={copying}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copying
            ? 'Copiando...'
            : copySuccess
              ? 'Copiado'
              : 'Copiar anuncio'}
        </button>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary capitalize">
            {generation.provider}
          </span>

          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
            {getToneLabel(generation.tone)}
          </span>

          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize">
            {generation.language === 'es'
              ? 'Español'
              : generation.language}
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-bold">
          {generation.title}
        </h1>

        <p className="mt-2 text-muted-foreground">
          {property.city || 'Sin ciudad'}
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
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Precio
          </p>

          <p className="mt-1 text-lg font-semibold">
            {property.price.toLocaleString(
              'es-ES',
            )}{' '}
            €
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Superficie
          </p>

          <p className="mt-1 text-lg font-semibold">
            {property.area} m²
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Habitaciones
          </p>

          <p className="mt-1 text-lg font-semibold">
            {property.bedrooms}
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4">
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

        {highlights.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No se han indicado características
            destacadas.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {highlights.map((highlight) => (
              <li
                key={highlight}
                className="rounded-md bg-muted px-3 py-2 text-sm"
              >
                {highlight}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Llamada a la acción
        </h2>

        <p className="mt-4 whitespace-pre-line leading-7">
          {generation.callToAction}
        </p>
      </section>

      <section className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Información de generación
        </h2>

        <dl className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">
              Proveedor
            </dt>

            <dd className="mt-1 font-medium capitalize">
              {generation.provider}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Tono
            </dt>

            <dd className="mt-1 font-medium">
              {getToneLabel(generation.tone)}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Idioma
            </dt>

            <dd className="mt-1 font-medium capitalize">
              {generation.language === 'es'
                ? 'Español'
                : generation.language}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">
              Generado
            </dt>

            <dd className="mt-1 font-medium">
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

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">
              Tipo
            </p>

            <p className="mt-1 font-medium">
              {getPropertyTypeLabel(property.type)}
            </p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">
              Operación
            </p>

            <p className="mt-1 font-medium">
              {getOperationLabel(property.operation)}
            </p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">
              Ciudad
            </p>

            <p className="mt-1 font-medium">
              {property.city || 'No indicada'}
            </p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">
              Barrio
            </p>

            <p className="mt-1 font-medium">
              {property.neighborhood ||
                'No indicado'}
            </p>
          </div>
        </div>

        <Link
          to={`/inmuebles/${property.id}`}
          className="mt-5 inline-block text-sm font-medium text-primary hover:underline"
        >
          Ver inmueble →
        </Link>
      </section>
    </div>
  )
}

export default GenerationDetailPage