export type PropertyOperation =
  | 'sale'
  | 'rent'
  | 'transfer'

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

export interface Property {
  id?: string

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

  pool: boolean

  garden: boolean

  storageRoom: boolean

  airConditioning: boolean

  heating: boolean

  additionalInformation: string
}