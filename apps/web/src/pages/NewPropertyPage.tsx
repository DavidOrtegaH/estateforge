import { useState } from 'react'
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
import { generateListing } from '@/services/generationService'

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

  // Estados para Edición, Eliminación y Copiado
  const [isEditing, setIsEditing] = useState(false)
  const [editedListing, setEditedListing] =
    useState<GeneratedListing | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

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

    const validationError = validateProperty()

    if (validationError) {
      setError(validationError)
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
      })

      setGeneratedListing(result.listing)
      setEditedListing(result.listing)
      setCreatedPropertyId(result.propertyId)
      setCreatedGenerationId(result.generationId)
    } catch (generationError) {
      console.error(
        'Error generando anuncio:',
        generationError,
      )

      setError(
        'No se ha podido generar el anuncio. Comprueba que la API esté disponible y que el proveedor de IA esté correctamente configurado.',
      )
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
    setIsEditing(false)
    setIsCopied(false)
  }

  async function handleSaveChanges() {
    if (!createdGenerationId || !editedListing) return

    setIsSaving(true)
    setError(null)

    try {
      // Aquí invocarías tu servicio de actualización, por ejemplo:
      // await updateListingService(createdGenerationId, editedListing)

      setGeneratedListing(editedListing)
      setIsEditing(false)
    } catch (err) {
      console.error('Error al guardar:', err)
      setError('No se han podido guardar los cambios del anuncio.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteListing() {
    if (!createdGenerationId) return

    const confirmed = window.confirm(
      '¿Estás seguro de que deseas eliminar este anuncio generado?',
    )
    if (!confirmed) return

    setIsDeleting(true)
    setError(null)

    try {
      // Aquí invocarías tu servicio de borrado, por ejemplo:
      // await deleteListingService(createdGenerationId)

      handleResetGeneration()
    } catch (err) {
      console.error('Error al eliminar:', err)
      setError('No se ha podido eliminar el anuncio.')
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleCopyListing() {
    const listingToCopy = isEditing ? editedListing : generatedListing
    if (!listingToCopy) return

    try {
      const textToCopy = `
${listingToCopy.title}

${listingToCopy.description}

Características destacadas:
${listingToCopy.highlights.map((h) => `- ${h}`).join('\n')}

${listingToCopy.callToAction}
      `.trim()

      await navigator.clipboard.writeText(textToCopy)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error('Error al copiar al portapapeles:', err)
      setError('No se ha podido copiar el contenido al portapapeles.')
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

      {error && (
        <div
          role="alert"
          className="mb-8 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
        >
          <p className="text-sm font-medium text-destructive">
            {error}
          </p>
        </div>
      )}

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
                Este nombre se utilizará para identificar el inmueble
                en EstateForge.
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
                  Piso
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

                <option value="commercial">
                  Local
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
                value={property.price || ''}
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
                value={property.area || ''}
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
                value={property.bedrooms || ''}
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
                value={property.bathrooms || ''}
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
                value={property.floor ?? ''}
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
                  Obra nueva
                </option>

                <option value="good">
                  Buen estado
                </option>

                <option value="renovated">
                  Reformado
                </option>

                <option value="needs-renovation">
                  Necesita reforma
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
                ['pool', 'Piscina'],
                ['garden', 'Jardín'],
                [
                  'airConditioning',
                  'Aire acondicionado',
                ],
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

          <div className="mt-6 grid gap-6 md:grid-cols-3">
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
                <option value="gemini">
                  Gemini
                </option>

                <option value="mock">
                  Mock
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

                <option value="premium">
                  Premium
                </option>

                <option value="friendly">
                  Cercano
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
        <section className="mt-8 rounded-lg border bg-card p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h2 className="text-lg font-semibold">
                Anuncio generado
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                El anuncio ha sido generado y guardado
                correctamente.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyListing}
              >
                {isCopied ? '¡Copiado!' : 'Copiar anuncio'}
              </Button>

              {!isEditing ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditing(true)
                    setEditedListing(generatedListing)
                  }}
                >
                  Editar anuncio
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSaving}
                    onClick={handleSaveChanges}
                  >
                    {isSaving ? 'Guardando...' : 'Guardar'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => {
                      setIsEditing(false)
                      setEditedListing(generatedListing)
                    }}
                  >
                    Cancelar
                  </Button>
                </>
              )}

              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isDeleting}
                onClick={handleDeleteListing}
              >
                {isDeleting ? 'Eliminando...' : 'Eliminar'}
              </Button>
            </div>
          </div>

          <div className="mt-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Título
              </p>

              {isEditing && editedListing ? (
                <input
                  type="text"
                  value={editedListing.title}
                  onChange={(e) =>
                    setEditedListing({
                      ...editedListing,
                      title: e.target.value,
                    })
                  }
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 font-bold"
                />
              ) : (
                <h3 className="mt-1 text-2xl font-bold">
                  {generatedListing.title}
                </h3>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Descripción
              </p>

              {isEditing && editedListing ? (
                <textarea
                  value={editedListing.description}
                  onChange={(e) =>
                    setEditedListing({
                      ...editedListing,
                      description: e.target.value,
                    })
                  }
                  rows={6}
                  className="mt-2 w-full resize-y rounded-md border bg-background p-3"
                />
              ) : (
                <p className="mt-2 whitespace-pre-line leading-7">
                  {generatedListing.description}
                </p>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Características destacadas
              </p>

              {generatedListing.highlights
                .length === 0 ? (
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

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Llamada a la acción
              </p>

              {isEditing && editedListing ? (
                <input
                  type="text"
                  value={editedListing.callToAction}
                  onChange={(e) =>
                    setEditedListing({
                      ...editedListing,
                      callToAction: e.target.value,
                    })
                  }
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                />
              ) : (
                <p className="mt-2">
                  {generatedListing.callToAction}
                </p>
              )}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 border-t pt-6">
            {createdPropertyId && (
              <Link
                to={`/inmuebles/${createdPropertyId}`}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Ver inmueble
              </Link>
            )}

            {createdGenerationId && (
              <Link
                to={`/historial/${createdGenerationId}`}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Ver anuncio detallado
              </Link>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

export default NewPropertyPage