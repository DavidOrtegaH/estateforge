import type {
  PropertyCondition,
  PropertyOperation,
  PropertyType,
} from './property.js'

import type {
  AIProviderType,
  ListingLanguage,
  ListingTone,
} from './generation.js'

export const propertyTypeLabels: Record<
  PropertyType,
  string
> = {
  apartment: 'Apartamento',
  house: 'Casa',
  villa: 'Chalet',
  penthouse: 'Ático',
  duplex: 'Dúplex',
  studio: 'Estudio',
  commercial: 'Local comercial',
  office: 'Oficina',
  land: 'Terreno',
}

export const operationLabels: Record<
  PropertyOperation,
  string
> = {
  sale: 'Venta',
  rent: 'Alquiler',
  transfer: 'Traspaso',
}

export const conditionLabels: Record<
  PropertyCondition,
  string
> = {
  new: 'Nuevo',
  good: 'Buen estado',
  renovated: 'Reformado',
  'needs-renovation': 'A reformar',
}

export const toneLabels: Record<
  ListingTone,
  string
> = {
  professional: 'Profesional',
  luxurious: 'De lujo',
  casual: 'Casual',
  persuasive: 'Persuasivo',
}

export const languageLabels: Record<
  ListingLanguage,
  string
> = {
  español: 'Español',
  english: 'Inglés',
}

export const providerLabels: Record<
  AIProviderType,
  string
> = {
  mock: 'Mock',
  gemini: 'Gemini',
  openai: 'OpenAI',
}