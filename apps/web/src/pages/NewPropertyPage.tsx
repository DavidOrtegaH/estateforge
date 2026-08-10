import { useState } from 'react'
import type {
  Property,
  PropertyCondition,
  PropertyOperation,
  PropertyType,
} from '@/types/property'
import type { GeneratedListing } from '@/types/listing'
import { Button } from '@/components/ui/button'
import { generateListing } from '@/services/generationService'

const initialProperty: Property = {
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
  const [property, setProperty] = useState<Property>(initialProperty)

  const [generatedListing, setGeneratedListing] =
    useState<GeneratedListing | null>(null)

  function updateProperty<K extends keyof Property>(
    field: K,
    value: Property[K],
  ) {
    setProperty((current) => ({
      ...current,
      [field]: value,
    }))
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    const response = await generateListing({
      property,
    })

    setGeneratedListing(response.listing)
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Crear inmueble</h1>
        <p className="mt-2 text-muted-foreground">
          Introduce los datos del inmueble para generar posteriormente su
          anuncio con IA.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Información básica</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Operación</span>

              <select
                value={property.operation}
                onChange={(event) =>
                  updateProperty(
                    'operation',
                    event.target.value as PropertyOperation,
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="sale">Venta</option>
                <option value="rent">Alquiler</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Tipo de inmueble</span>

              <select
                value={property.type}
                onChange={(event) =>
                  updateProperty(
                    'type',
                    event.target.value as PropertyType,
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="apartment">Piso</option>
                <option value="house">Casa</option>
                <option value="villa">Chalet</option>
                <option value="penthouse">Ático</option>
                <option value="commercial">Local</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Precio (€)</span>

              <input
                type="number"
                min="0"
                value={property.price || ''}
                onChange={(event) =>
                  updateProperty('price', Number(event.target.value))
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Superficie (m²)</span>

              <input
                type="number"
                min="0"
                value={property.area || ''}
                onChange={(event) =>
                  updateProperty('area', Number(event.target.value))
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Habitaciones</span>

              <input
                type="number"
                min="0"
                value={property.bedrooms || ''}
                onChange={(event) =>
                  updateProperty('bedrooms', Number(event.target.value))
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Baños</span>

              <input
                type="number"
                min="0"
                value={property.bathrooms || ''}
                onChange={(event) =>
                  updateProperty('bathrooms', Number(event.target.value))
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Ubicación</h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-medium">Dirección</span>

              <input
                type="text"
                value={property.address}
                onChange={(event) =>
                  updateProperty('address', event.target.value)
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Ciudad</span>

              <input
                type="text"
                value={property.city}
                onChange={(event) =>
                  updateProperty('city', event.target.value)
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Zona</span>

              <input
                type="text"
                value={property.neighborhood}
                onChange={(event) =>
                  updateProperty('neighborhood', event.target.value)
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Planta</span>

              <input
                type="number"
                min="0"
                value={property.floor ?? ''}
                onChange={(event) =>
                  updateProperty(
                    'floor',
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Estado</span>

              <select
                value={property.condition}
                onChange={(event) =>
                  updateProperty(
                    'condition',
                    event.target.value as PropertyCondition,
                  )
                }
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="new">Obra nueva</option>
                <option value="good">Buen estado</option>
                <option value="renovated">Reformado</option>
                <option value="needs-renovation">
                  Necesita reforma
                </option>
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Características</h2>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {(
              [
                ['elevator', 'Ascensor'],
                ['terrace', 'Terraza'],
                ['balcony', 'Balcón'],
                ['garage', 'Garaje'],
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
                    updateProperty(field, event.target.checked)
                  }
                />

                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">
            Información adicional
          </h2>

          <textarea
            value={property.additionalInformation}
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
        </section>

        <div className="flex justify-end">
          <Button type="submit" size="lg">
            Generar anuncio con IA
          </Button>
        </div>
      </form>

      {generatedListing && (
        <section className="mt-8 rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">
            Anuncio generado
          </h2>

          <div className="mt-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Título
              </p>

              <h3 className="mt-1 text-2xl font-bold">
                {generatedListing.title}
              </h3>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Descripción
              </p>

              <p className="mt-2 whitespace-pre-line">
                {generatedListing.description}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Características destacadas
              </p>

              <ul className="mt-2 list-disc pl-5">
                {generatedListing.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Llamada a la acción
              </p>

              <p className="mt-2">
                {generatedListing.callToAction}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

export default NewPropertyPage

