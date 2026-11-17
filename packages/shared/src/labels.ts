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
  mock: 'Plantilla local (sin IA)',
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  xai: 'xAI (Grok)',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  simulador: 'Simulador local (pruebas)',
}

/**
 * Nombre visible del método con el que se generó un anuncio (MD-36). «mock» es la plantilla local:
 * una composición programática, sin IA ni servicios externos. «simulador» es el simulador técnico de
 * pruebas. Un valor desconocido (datos antiguos) se muestra tal cual, con la inicial en mayúscula.
 */
export function getProviderLabel(
  provider: string | null | undefined,
): string {
  const value = provider?.trim()
  if (!value) return 'No indicado'
  const known = (providerLabels as Record<string, string>)[value.toLowerCase()]
  return known ?? value.charAt(0).toUpperCase() + value.slice(1)
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
