import { describe, expect, it } from 'vitest'
import { EMPTY_LISTING_FILTERS, filterPropertyListings, matchesListingFilters } from './listingFilters'
import { pageSlice } from './pagination'

const listings = Array.from({ length: 9 }, (_, index) => ({ id: `listing-${index}`, propertyId: 'one-property', title: `${index % 2 ? 'Terraza' : 'Casa'} ${index}`, createdAt: `2026-11-${String(index + 1).padStart(2, '0')}T10:00:00Z`, provider: index % 2 ? 'mock' : 'gemini', language: index % 2 ? 'english' : 'español', tone: index % 3 ? 'casual' : 'professional' }))
describe('búsqueda y filtros compartidos de anuncios', () => {
  it('busca por título ignorando mayúsculas y espacios exteriores, como la página general', () => {
    expect(filterPropertyListings(listings, { ...EMPTY_LISTING_FILTERS, search: '  TERRAZA ' }).map(item => item.id)).toEqual(['listing-7', 'listing-5', 'listing-3', 'listing-1'])
  })
  it('combina método, tono, idioma y búsqueda antes de paginar', () => {
    const filter = { ...EMPTY_LISTING_FILTERS, search: 'Terraza', provider: 'mock', tone: 'casual', language: 'english' }
    const result = filterPropertyListings(listings, filter)
    expect(result.map(item => item.id)).toEqual(['listing-7', 'listing-5', 'listing-1'])
    expect(pageSlice(result, 2, 2).map(item => item.id)).toEqual(['listing-1'])
    expect(listings.filter(item => matchesListingFilters(item, filter))).toHaveLength(3)
  })
  it('procesa solo la colección del inmueble recibida y no modifica el orden original', () => {
    const original = listings.map(item => item.id)
    expect(filterPropertyListings(listings.slice(0, 2), EMPTY_LISTING_FILTERS).map(item => item.id)).toEqual(['listing-1', 'listing-0'])
    expect(listings.map(item => item.id)).toEqual(original)
  })
  it('admite invertir el orden y devuelve cero resultados al combinar criterios incompatibles', () => {
    expect(filterPropertyListings(listings, { ...EMPTY_LISTING_FILTERS, sort: 'oldest' })[0].id).toBe('listing-0')
    expect(filterPropertyListings(listings, { ...EMPTY_LISTING_FILTERS, provider: 'mock', language: 'español' })).toEqual([])
  })
})
