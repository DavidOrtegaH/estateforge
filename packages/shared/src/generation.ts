import { Property } from "./property.js"

// «mock» es la plantilla local (sin IA). El resto son proveedores de texto del catálogo (DA-82).
export const AI_TEXT_GENERATION_PROVIDERS = ['mock', 'gemini', 'openai', 'anthropic', 'xai', 'mistral', 'deepseek', 'openrouter', 'groq', 'simulador'] as const
export type AIProviderType = (typeof AI_TEXT_GENERATION_PROVIDERS)[number]

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
  /** Modelo y conexión para esta operación; si faltan, se usan los de la preferencia del usuario. */
  model?: string
  connectionId?: string
  tone: ListingTone
  language: ListingLanguage
}