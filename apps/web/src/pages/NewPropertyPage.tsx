import { useRef, useState } from 'react'
import { Link } from 'react-router'

import type {
  AIProviderType,
  GeneratedListing,
  ListingLanguage,
  ListingTone,
  Property,
  PropertyCondition,
  PropertyOperation,
  PropertyType,
} from '@estateforge/shared'

import { Button } from '@/components/ui/button'
import {
  generateListing,
  GenerationApiError,
} from '@/services/generationService'

const initialProperty: Property = {
  title: '',
  operation: 'sale',
  type: 'apartment',
  price: 0,
  address: '',
  city: '',
  neighborhood: '',
  area: 0,
  bedrooms: 0,
  bathrooms: 0,
  condition: 'good',
  elevator: false,
  terrace: false,
  balcony: false,
  garage: false,
  storageRoom: false,
  pool: false,
  garden: false,
  airConditioning: false,
  heating: false,
  additionalInformation: '',
}

function NewPropertyPage() {
  const [property, setProperty] =
    useState<Property>(initialProperty)

  const [provider, setProvider] =
    useState<AIProviderType>('gemini')

  const [tone, setTone] =
    useState<ListingTone>('professional')

  const [language, setLanguage] =
    useState<ListingLanguage>('español')

  const [generatedListing, setGeneratedListing] =
    useState<GeneratedListing | null>(null)

  const [createdPropertyId, setCreatedPropertyId] =
    useState<string | null>(null)

  const [createdGenerationId, setCreatedGenerationId] =
    useState<string | null>(null)

  const [isGenerating, setIsGenerating] =
    useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const [apiKey, setApiKey] =
    useState('')

  const [showCustomApiKey, setShowCustomApiKey] =
    useState(false)

  // Estados para Edición, Eliminación y Copiado
  const [isEditing, setIsEditing] =
    useState(false)

  const [editedListing, setEditedListing] =
    useState<GeneratedListing | null>(null)

  const [isSaving, setIsSaving] =
    useState(false)

  const [isDeleting, setIsDeleting] =
    useState(false)

  const [isCopied, setIsCopied] =
    useState(false)

  const generatedListingRef = useRef<HTMLDivElement>(null)

  function preserveScrollPosition(
    callback: () => void,
  ) {
    const scrollY = window.scrollY

    callback()

    requestAnimationFrame(() => {
      window.scrollTo({
        top: scrollY,
        behavior: 'auto',
      })

      requestAnimationFrame(() => {
        window.scrollTo({
          top: scrollY,
          behavior: 'auto',
        })
      })
    })
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const targetY = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo({
        top: targetY,
        behavior: 'instant',
      })
    })
  }

  function scrollToElement(element: HTMLElement | null) {
    if (!element) {
      scrollToBottom()
      return
    }

    requestAnimationFrame(() => {
      element.scrollIntoView({
        behavior: 'instant',
        block: 'start',
      })
    })
  }

  function updateProperty<K extends keyof Property>(
    field: K,
    value: Property[K],
  ) {
    setProperty((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function validateProperty(): string | null {
    if (property.price <= 0) {
      return 'El precio debe ser mayor que 0.'
    }

    if (property.area <= 0) {
      return 'La superficie debe ser mayor que 0.'
    }

    if (property.bedrooms < 0) {
      return 'Las habitaciones no pueden ser negativas.'
    }

    if (property.bathrooms < 0) {
      return 'Los baños no pueden ser negativos.'
    }

    if (!property.address.trim()) {
      return 'La dirección es obligatoria.'
    }

    if (!property.city.trim()) {
      return 'La ciudad es obligatoria.'
    }

    return null
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (isGenerating) {
      return
    }

    setError(null)

    const validationError =
      validateProperty()

    if (validationError) {
      setError(validationError)
      scrollToBottom()
      return
    }

    setIsGenerating(true)
    setGeneratedListing(null)
    setEditedListing(null)
    setCreatedPropertyId(null)
    setCreatedGenerationId(null)
    setIsEditing(false)
    setIsCopied(false)

    try {
      const result = await generateListing({
        property,
        provider,
        tone,
        language,
        apiKey: apiKey.trim() || undefined,
      })

      setGeneratedListing(result.listing)
      setEditedListing(result.listing)
      setCreatedPropertyId(result.propertyId)
      setCreatedGenerationId(
        result.generationId,
      )
      setApiKey('')
      setShowCustomApiKey(false)

      setTimeout(() => {
        scrollToElement(generatedListingRef.current)
      }, 50)
    } catch (generationError) {
      if (generationError instanceof GenerationApiError) {
        if (
          generationError.code ===
          'AI_QUOTA_EXCEEDED'
        ) {
          setError(
            'La cuota disponible del proveedor de IA se ha agotado.',
          )
          setShowCustomApiKey(true)
          scrollToBottom()
          return
        }

        if (
          generationError.code ===
          'AI_INVALID_API_KEY'
        ) {
          setError(
            'La API key proporcionada no es válida. Comprueba la clave e inténtalo de nuevo.',
          )
          setShowCustomApiKey(true)
          scrollToBottom()
          return
        }

        if (
          generationError.code ===
          'AI_TIMEOUT'
        ) {
          setError(
            'La generación ha superado el tiempo límite de 40 segundos.',
          )
          scrollToBottom()
          return
        }

        if (
          generationError.code ===
          'AI_PROVIDER_ERROR'
        ) {
          setError(
            'El proveedor de IA no está disponible en este momento. Inténtalo de nuevo más tarde.',
          )
          scrollToBottom()
          return
        }
      }

      setError(
        'No se ha podido generar el anuncio. Comprueba que la API esté disponible y que el proveedor de IA esté correctamente configurado.',
      )
      scrollToBottom()
    } finally {
      setIsGenerating(false)
    }
  }

  function handleResetGeneration() {
    setGeneratedListing(null)
    setEditedListing(null)
    setCreatedPropertyId(null)
    setCreatedGenerationId(null)
    setError(null)
    setApiKey('')
    setShowCustomApiKey(false)
    setIsEditing(false)
    setIsCopied(false)
  }

  async function handleSaveChanges() {
    if (
      !createdGenerationId ||
      !editedListing
    ) {
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      setGeneratedListing(editedListing)
      setIsEditing(false)
    } catch (err) {
      console.error(
        'Error al guardar:',
        err,
      )

      preserveScrollPosition(() => {
        setError(
          'No se han podido guardar los cambios del anuncio.',
        )
      })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteListing() {
    if (!createdGenerationId) {
      return
    }

    const confirmed = window.confirm(
      '¿Estás seguro de que deseas eliminar este anuncio generado?',
    )

    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    setError(null)

    try {
      handleResetGeneration()
    } catch (err) {
      console.error(
        'Error al eliminar:',
        err,
      )

      preserveScrollPosition(() => {
        setError(
          'No se ha podido eliminar el anuncio.',
        )
      })
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleCopyListing() {
    const listingToCopy =
      isEditing
        ? editedListing
        : generatedListing

    if (!listingToCopy) {
      return
    }

    try {
      const textToCopy = `
${listingToCopy.title}

${listingToCopy.description}

Características destacadas:
${listingToCopy.highlights
          .map((highlight) => `- ${highlight}`)
          .join('\n')}

${listingToCopy.callToAction}
      `.trim()

      await navigator.clipboard.writeText(
        textToCopy,
      )

      setIsCopied(true)

      setTimeout(
        () => setIsCopied(false),
        2000,
      )
    } catch (err) {
      console.error(
        'Error al copiar al portapapeles:',
        err,
      )

      preserveScrollPosition(() => {
        setError(
          'No se ha podido copiar el contenido al portapapeles.',
        )
      })
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">
          Crear inmueble
        </h1>

        <p className="mt-2 text-muted-foreground">
          Introduce los datos del inmueble para
          generar posteriormente su anuncio con IA.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-8"
      >
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">
            Información básica
          </h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-medium">
                Título del inmueble
              </span>

              <input
                type="text"
                value={property.title}
                onChange={(event) =>
                  updateProperty(
                    'title',
                    event.target.value,
                  )
                }
                placeholder="Ej. Piso luminoso en Parla Centro"
                className="h-10 rounded-md border bg-background px-3"
              />

              <span className="text-xs text-muted-foreground">
                Este nombre se utilizará para identificar
                el inmueble en EstateForge.
              </span>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Operación
              </span>

              <select
                value={property.operation}
                onChange={(event) =>
                  updateProperty(
                    'operation',
                    event.target
                      .value as PropertyOperation,
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="sale">
                  Venta
                </option>

                <option value="rent">
                  Alquiler
                </option>

                <option value="transfer">
                  Traspaso
                </option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Tipo de inmueble
              </span>

              <select
                value={property.type}
                onChange={(event) =>
                  updateProperty(
                    'type',
                    event.target
                      .value as PropertyType,
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="apartment">
                  Apartamento
                </option>

                <option value="house">
                  Casa
                </option>

                <option value="villa">
                  Chalet
                </option>

                <option value="penthouse">
                  Ático
                </option>

                <option value="duplex">
                  Dúplex
                </option>

                <option value="studio">
                  Estudio
                </option>

                <option value="commercial">
                  Local comercial
                </option>

                <option value="office">
                  Oficina
                </option>

                <option value="land">
                  Terreno
                </option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Precio (€)
              </span>

              <input
                type="number"
                min="0"
                value={
                  property.price || ''
                }
                onChange={(event) =>
                  updateProperty(
                    'price',
                    Number(
                      event.target.value,
                    ),
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Superficie (m²)
              </span>

              <input
                type="number"
                min="0"
                value={
                  property.area || ''
                }
                onChange={(event) =>
                  updateProperty(
                    'area',
                    Number(
                      event.target.value,
                    ),
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Habitaciones
              </span>

              <input
                type="number"
                min="0"
                value={
                  property.bedrooms || ''
                }
                onChange={(event) =>
                  updateProperty(
                    'bedrooms',
                    Number(
                      event.target.value,
                    ),
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Baños
              </span>

              <input
                type="number"
                min="0"
                value={
                  property.bathrooms || ''
                }
                onChange={(event) =>
                  updateProperty(
                    'bathrooms',
                    Number(
                      event.target.value,
                    ),
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">
            Ubicación
          </h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-medium">
                Dirección
              </span>

              <input
                type="text"
                value={property.address}
                onChange={(event) =>
                  updateProperty(
                    'address',
                    event.target.value,
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Ciudad
              </span>

              <input
                type="text"
                value={property.city}
                onChange={(event) =>
                  updateProperty(
                    'city',
                    event.target.value,
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Zona
              </span>

              <input
                type="text"
                value={property.neighborhood}
                onChange={(event) =>
                  updateProperty(
                    'neighborhood',
                    event.target.value,
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Planta
              </span>

              <input
                type="number"
                min="0"
                value={
                  property.floor ?? ''
                }
                onChange={(event) =>
                  updateProperty(
                    'floor',
                    event.target.value === ''
                      ? undefined
                      : Number(
                        event.target.value,
                      ),
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">
                Estado
              </span>

              <select
                value={property.condition}
                onChange={(event) =>
                  updateProperty(
                    'condition',
                    event.target
                      .value as PropertyCondition,
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="new">
                  Nuevo
                </option>

                <option value="good">
                  Buen estado
                </option>

                <option value="renovated">
                  Reformado
                </option>

                <option value="needs-renovation">
                  A reformar
                </option>
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">
            Características
          </h2>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {(
              [
                ['elevator', 'Ascensor'],
                ['terrace', 'Terraza'],
                ['balcony', 'Balcón'],
                ['garage', 'Garaje'],
                ['storageRoom', 'Trastero'],
                ['pool', 'Piscina'],
                ['garden', 'Jardín'],
                ['airConditioning', 'Aire acondicionado'],
                ['heating', 'Calefacción'],
              ] as const
            ).map(([field, label]) => (
              <label
                key={field}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <input
                  type="checkbox"
                  checked={property[field]}
                  onChange={(event) =>
                    updateProperty(
                      field,
                      event.target.checked,
                    )
                  }
                />

                <span className="text-sm">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">
            Información adicional
          </h2>

          <textarea
            value={
              property.additionalInformation
            }
            onChange={(event) =>
              updateProperty(
                'additionalInformation',
                event.target.value,
              )
            }
            placeholder="Describe cualquier información adicional que pueda ser relevante para el anuncio..."
            rows={6}
            className="mt-6 w-full resize-y rounded-md border bg-background p-3"
          />

          <p className="mt-2 text-xs text-muted-foreground">
            Esta información se proporciona a la IA
            como parte de los datos del inmueble.
          </p>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <div>
            <h2 className="text-lg font-semibold">
              Configuración de generación
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Elige qué proveedor y qué estilo quieres
              utilizar para generar el anuncio.
            </p>
          </div>

          <div className="mt-6">
            {/* Fila 1: Tres selectores alineados horizontalmente */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <label className="grid gap-2">
                <span className="text-sm font-medium">
                  Proveedor de IA
                </span>

                <select
                  value={provider}
                  onChange={(event) =>
                    setProvider(
                      event.target
                        .value as AIProviderType,
                    )
                  }
                  disabled={isGenerating}
                  className="h-10 rounded-md border bg-background px-3 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="mock">
                    Mock
                  </option>

                  <option value="gemini">
                    Gemini
                  </option>

                  <option value="openai">
                    OpenAI
                  </option>
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium">
                  Tono
                </span>

                <select
                  value={tone}
                  onChange={(event) =>
                    setTone(
                      event.target
                        .value as ListingTone,
                    )
                  }
                  disabled={isGenerating}
                  className="h-10 rounded-md border bg-background px-3 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="professional">
                    Profesional
                  </option>

                  <option value="luxurious">
                    De lujo
                  </option>

                  <option value="casual">
                    Casual
                  </option>

                  <option value="persuasive">
                    Persuasivo
                  </option>
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium">
                  Idioma
                </span>

                <select
                  value={language}
                  onChange={(event) =>
                    setLanguage(
                      event.target
                        .value as ListingLanguage,
                    )
                  }
                  disabled={isGenerating}
                  className="h-10 rounded-md border bg-background px-3 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="español">
                    Español
                  </option>

                  <option value="english">
                    Inglés
                  </option>
                </select>
              </label>
            </div>

            {/* Fila 2: Aviso informativo siempre visible con mt-2 justo bajo el proveedor */}
            <div className="mt-2 grid grid-cols-1 gap-6 md:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  Mock no consume ninguna API ni usa IA.
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
            >
              <p className="text-sm font-medium text-destructive">
                {error}
              </p>
            </div>
          )}

          {showCustomApiKey && (
            <div className="mt-6 rounded-lg border bg-muted/30 p-4">
              <div>
                <p className="text-sm font-medium">
                  Usar mi propia API key
                </p>

                <p className="mt-1 text-xs text-muted-foreground">
                  Puedes utilizar tu propia API key para
                  continuar generando anuncios cuando se
                  haya agotado la cuota disponible. La
                  clave se utilizará únicamente para esta
                  generación y no se guardará.
                </p>
              </div>

              <div className="mt-4">
                <label
                  htmlFor="generation-api-key"
                  className="text-sm font-medium"
                >
                  API key de{' '}
                  {provider === 'gemini'
                    ? 'Gemini'
                    : 'OpenAI'}
                </label>

                <input
                  id="generation-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) =>
                    setApiKey(
                      event.target.value,
                    )
                  }
                  disabled={isGenerating}
                  autoComplete="off"
                  placeholder="Introduce tu API key"
                  className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                />

                <p className="mt-2 text-xs text-muted-foreground">
                  No guardamos ni mostramos esta clave
                  después de la generación.
                </p>
              </div>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button
            type="submit"
            size="lg"
            disabled={isGenerating}
          >
            {isGenerating
              ? 'Generando...'
              : 'Crear inmueble y generar su anuncio con IA'}
          </Button>
        </div>
      </form>

      {generatedListing && (
        <section
          ref={generatedListingRef}
          className="mt-8 overflow-hidden rounded-lg border bg-card"
        >
          {/* ENLACES SUPERIORES */}
          <div className="grid grid-cols-2">
            {createdPropertyId ? (
              <Link
                to={`/inmuebles/${createdPropertyId}`}
                className="flex min-h-11 items-center justify-center border-r text-sm font-medium transition hover:bg-muted"
              >
                Ver inmueble
              </Link>
            ) : (
              <div className="min-h-11" />
            )}

            {createdGenerationId ? (
              <Link
                to={`/historial/${createdGenerationId}`}
                className="flex min-h-11 items-center justify-center text-sm font-medium transition hover:bg-muted"
              >
                Ver anuncio detallado
              </Link>
            ) : (
              <div className="min-h-11" />
            )}
          </div>

          {/* CABECERA */}
          <div className="border-t p-6 pb-0">
            <div>
              <h2 className="text-lg font-semibold">
                Anuncio generado
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                El anuncio ha sido generado y guardado
                correctamente.
              </p>
            </div>
          </div>

          {/* CONTENIDO DEL ANUNCIO */}
          <div className="p-6">
            <div className="space-y-6">
              {/* TÍTULO */}
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Título
                </p>

                {isEditing &&
                  editedListing ? (
                  <input
                    type="text"
                    value={
                      editedListing.title
                    }
                    onChange={(event) =>
                      setEditedListing({
                        ...editedListing,
                        title:
                          event.target.value,
                      })
                    }
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 font-bold"
                  />
                ) : (
                  <h3 className="mt-1 text-2xl font-bold">
                    {
                      generatedListing.title
                    }
                  </h3>
                )}
              </div>

              {/* DESCRIPCIÓN */}
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Descripción
                </p>

                {isEditing &&
                  editedListing ? (
                  <textarea
                    value={
                      editedListing.description
                    }
                    onChange={(event) =>
                      setEditedListing({
                        ...editedListing,
                        description:
                          event.target.value,
                      })
                    }
                    rows={6}
                    className="mt-2 w-full resize-y rounded-md border bg-background p-3"
                  />
                ) : (
                  <p className="mt-2 whitespace-pre-line leading-7">
                    {
                      generatedListing.description
                    }
                  </p>
                )}
              </div>

              {/* CARACTERÍSTICAS DESTACADAS */}
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Características destacadas
                </p>

                {isEditing &&
                  editedListing ? (
                  <textarea
                    value={editedListing.highlights.join(
                      '\n',
                    )}
                    onChange={(event) =>
                      setEditedListing({
                        ...editedListing,
                        highlights:
                          event.target.value
                            .split('\n')
                            .map(
                              (item) =>
                                item.trim(),
                            )
                            .filter(Boolean),
                      })
                    }
                    rows={6}
                    className="mt-2 w-full resize-y rounded-md border bg-background p-3"
                    placeholder="Una característica por línea"
                  />
                ) : generatedListing
                  .highlights.length ===
                  0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No se han indicado características
                    destacadas.
                  </p>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {generatedListing.highlights.map(
                      (highlight) => (
                        <li key={highlight}>
                          {highlight}
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </div>

              {/* CTA */}
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Llamada a la acción
                </p>

                {isEditing &&
                  editedListing ? (
                  <input
                    type="text"
                    value={
                      editedListing.callToAction
                    }
                    onChange={(event) =>
                      setEditedListing({
                        ...editedListing,
                        callToAction:
                          event.target.value,
                      })
                    }
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                  />
                ) : (
                  <p className="mt-2">
                    {
                      generatedListing.callToAction
                    }
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ACCIONES INFERIORES */}
          {!isEditing ? (
            <div className="grid grid-cols-3 border-t">
              <button
                type="button"
                onClick={
                  handleCopyListing
                }
                disabled={isDeleting}
                className="flex min-h-11 items-center justify-center border-r text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCopied
                  ? '¡Copiado!'
                  : 'Copiar anuncio'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsEditing(true)
                  setEditedListing(
                    generatedListing,
                  )
                }}
                disabled={isDeleting}
                className="flex min-h-11 items-center justify-center border-r text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Editar anuncio
              </button>

              <button
                type="button"
                onClick={
                  handleDeleteListing
                }
                disabled={isDeleting}
                className="flex min-h-11 items-center justify-center text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeleting
                  ? 'Eliminando...'
                  : 'Eliminar'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 border-t">
              <button
                type="button"
                onClick={
                  handleSaveChanges
                }
                disabled={isSaving}
                className="flex min-h-11 items-center justify-center border-r text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving
                  ? 'Guardando...'
                  : 'Guardar'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsEditing(false)
                  setEditedListing(
                    generatedListing,
                  )
                }}
                disabled={isSaving}
                className="flex min-h-11 items-center justify-center text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default NewPropertyPage