import type { Property } from './property.js'

export type AIProviderType =
  | 'mock'
  | 'gemini'
  | 'openai'

export type ListingTone =
  | 'professional'
  | 'premium'
  | 'friendly'

export type ListingLanguage =
  | 'español'
  | 'english'

export interface GenerationRequest {
  property: Property
  provider: AIProviderType
  tone: ListingTone
  language: ListingLanguage
}