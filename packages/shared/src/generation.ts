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
  property: Omit<Property, 'price'> & {
    price: number | string
  }
  provider: AIProviderType
  tone: ListingTone
  language: ListingLanguage
  apiKey?: string
}