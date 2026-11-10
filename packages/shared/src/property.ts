export type PropertyOperation = 'sale' | 'rent' | 'transfer'

export type PropertyType =
  | 'apartment'
  | 'house'
  | 'villa'
  | 'penthouse'
  | 'duplex'
  | 'studio'
  | 'commercial'
  | 'office'
  | 'land'

export type PropertyCondition =
  | 'new'
  | 'good'
  | 'renovated'
  | 'needs-renovation'

/**
 * Situación comercial del inmueble. No tiene relación con `condition`
 * (conservación) ni con el Checklist de publicación del anuncio.
 */
export const PROPERTY_COMMERCIAL_STATUSES = [
  'for-sale',
  'sold',
  'for-rent',
  'rented',
] as const

export type PropertyCommercialStatus =
  (typeof PROPERTY_COMMERCIAL_STATUSES)[number]

export interface Property {
  title: string
  operation: PropertyOperation
  type: PropertyType
  price: number
  address: string
  city: string
  neighborhood: string
  area: number
  bedrooms: number
  bathrooms: number
  floor?: number
  condition: PropertyCondition
  commercialStatus?: PropertyCommercialStatus

  elevator: boolean
  terrace: boolean
  balcony: boolean
  garage: boolean
  storageRoom: boolean
  pool: boolean
  garden: boolean
  airConditioning: boolean
  heating: boolean

  additionalInformation: string
}