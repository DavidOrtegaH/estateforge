export interface ListingFilterFields { search: string; provider: string; tone: string; language: string }
export interface ListingFilterItem { id: string; title: string; provider?: string; tone?: string; language?: string; createdAt: string }
export interface PropertyListingFilter extends ListingFilterFields { sort: 'newest' | 'oldest' }
export const EMPTY_LISTING_FILTERS: PropertyListingFilter = { search: '', provider: '', tone: '', language: '', sort: 'newest' }
const normalized = (value: string | undefined) => (value ?? '').trim().toLowerCase()

/** Same title search, method, tone and language rules in the general and property lists. */
export function matchesListingFilters(item: ListingFilterItem, filters: ListingFilterFields): boolean {
  return (!normalized(filters.search) || normalized(item.title).includes(normalized(filters.search)))
    && (!normalized(filters.provider) || normalized(item.provider).includes(normalized(filters.provider)))
    && (!normalized(filters.tone) || normalized(item.tone) === normalized(filters.tone))
    && (!normalized(filters.language) || normalized(item.language) === normalized(filters.language))
}

export function compareListingDate(a: ListingFilterItem, b: ListingFilterItem, order: 'newest' | 'oldest'): number {
  const dateA = Date.parse(a.createdAt) || 0
  const dateB = Date.parse(b.createdAt) || 0
  return order === 'newest' ? dateB - dateA || b.id.localeCompare(a.id) : dateA - dateB || a.id.localeCompare(b.id)
}

/** Only processes the caller's supplied property list; never fetches the general listing collection. */
export function filterPropertyListings<T extends ListingFilterItem>(listings: readonly T[], filters: PropertyListingFilter): T[] {
  return listings.filter(item => matchesListingFilters(item, filters)).sort((a, b) => compareListingDate(a, b, filters.sort))
}
