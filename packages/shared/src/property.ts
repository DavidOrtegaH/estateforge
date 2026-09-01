export type PropertyOperation = 'sale' | 'rent'

export type PropertyType =
  | 'apartment'
  | 'house'
  | 'villa'
  | 'penthouse'
  | 'commercial'

export type PropertyCondition =
  | 'new'
  | 'good'
  | 'renovated'
  | 'needs-renovation'

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