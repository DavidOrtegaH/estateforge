import { Property } from "./property.js"

export type AIProviderType =
  | 'mock'
  | 'gemini'
  | 'openai'

export type ListingTone =
  | 'professional'
  | 'premium'
  | 'friendly'
  | 'close'
  | 'enthusiastic'
  | 'investment'

export type ListingLanguage =
  | 'español'
  | 'english'
  | 'es'
  | 'en'
  | 'ca'
  | 'gl'
  | 'eu'

export interface GenerationRequest {
  property: Property
  provider: AIProviderType
  tone: ListingTone
  language: ListingLanguage
}