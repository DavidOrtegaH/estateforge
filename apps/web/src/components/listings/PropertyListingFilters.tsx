import { getProviderLabel } from '@estateforge/shared'
import { EMPTY_LISTING_FILTERS, type ListingFilterItem, type PropertyListingFilter } from '@/lib/listingFilters'

const tones: Record<string, string> = { professional: 'Profesional', luxurious: 'De lujo', casual: 'Casual', persuasive: 'Persuasivo' }
const languageLabel = (value: string) => value === 'english' ? 'Inglés' : value === 'español' ? 'Español' : value

export function PropertyListingFilters({ listings, value, onChange, count }: { listings: readonly ListingFilterItem[]; value: PropertyListingFilter; onChange: (value: PropertyListingFilter) => void; count: number }) {
  const options = (field: 'provider' | 'tone' | 'language') => [...new Set([...listings.map(item => item[field]), value[field]].filter((item): item is string => !!item))].sort()
  const input = 'mt-1 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm'
  return <section className="mt-4 rounded-lg border bg-card p-4" aria-label="Búsqueda y filtros de los anuncios del inmueble">
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="min-w-0 text-sm">Buscar anuncios de este inmueble
        <input type="search" aria-label="Buscar anuncios de este inmueble" value={value.search} onChange={event => onChange({ ...value, search: event.target.value })} placeholder="Buscar por título" className={input} />
      </label>
      <label className="min-w-0 text-sm">Método de generación del anuncio
        <select aria-label="Método de generación del anuncio" value={value.provider} onChange={event => onChange({ ...value, provider: event.target.value })} className={input}>
          <option value="">Cualquier método</option>{options('provider').map(option => <option key={option} value={option}>{getProviderLabel(option)}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-sm">Tono del anuncio
        <select aria-label="Tono del anuncio" value={value.tone} onChange={event => onChange({ ...value, tone: event.target.value })} className={input}>
          <option value="">Cualquier tono</option>{options('tone').map(option => <option key={option} value={option}>{tones[option] ?? option}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-sm">Idioma del anuncio
        <select aria-label="Idioma del anuncio" value={value.language} onChange={event => onChange({ ...value, language: event.target.value })} className={input}>
          <option value="">Cualquier idioma</option>{options('language').map(option => <option key={option} value={option}>{languageLabel(option)}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-sm">Ordenar anuncios
        <select aria-label="Ordenar anuncios" value={value.sort} onChange={event => onChange({ ...value, sort: event.target.value as PropertyListingFilter['sort'] })} className={input}>
          <option value="newest">Más recientes primero</option><option value="oldest">Más antiguos primero</option>
        </select>
      </label>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-muted-foreground">{count} de {listings.length} anuncios de este inmueble</p>
      <button type="button" onClick={() => onChange({ ...EMPTY_LISTING_FILTERS })} className="rounded-md border px-3 py-2 text-sm">Limpiar búsqueda y filtros</button>
    </div>
  </section>
}
