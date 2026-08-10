import type { Property } from './property'
import type { GeneratedListing } from './listing'

export interface GenerateListingRequest {
  property: Property
}

export interface GenerateListingResponse {
  listing: GeneratedListing
}