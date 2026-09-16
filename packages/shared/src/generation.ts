import { Property } from "./property.js"

export type AIProviderType =
  | 'mock'
  | 'gemini'
  | 'openai'

export type ListingTone =
  | 'professional'
  | 'luxurious'
  | 'casual'
  | 'persuasive'

export type ListingLanguage =
  | 'español'
  | 'english'

export type GenerationRequest = {
  property: Property
  provider: AIProviderType
  tone: ListingTone
  language: ListingLanguage
  apiKey?: string
}