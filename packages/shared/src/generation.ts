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
  | 'es'
  | 'en'

export interface GenerationRequest {
  property: Property
  tone: ListingTone
  language: ListingLanguage
  provider: AIProviderType
}