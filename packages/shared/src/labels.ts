import type {
  PropertyCommercialStatus,
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

export const commercialStatusLabels: Record<
  PropertyCommercialStatus,
  string
> = {
  'for-sale': 'En venta',
  sold: 'Vendido',
  'for-rent': 'Por alquilar',
  rented: 'Alquilado',
}

export const COMMERCIAL_STATUS_NOT_SET_LABEL =
  'Sin indicar'

/** Los inmuebles anteriores a este campo no tienen estado: no se les inventa uno. */
export function getCommercialStatusLabel(
  status: string | null | undefined,
): string {
  return (
    commercialStatusLabels[
      status as PropertyCommercialStatus
    ] ?? COMMERCIAL_STATUS_NOT_SET_LABEL
  )
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

/**
 * Presentación de un importe. Solo para mostrar: nunca se usa en cálculos.
 */
export function formatMoneyAmount(
  value: string | number,
): string {
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 2,
  }).format(Number(value))
}
