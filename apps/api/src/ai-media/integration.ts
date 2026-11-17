import type { AiIntegrationLevel } from '@estateforge/shared'

import type { ModelDefinition, ProviderDefinition } from './catalog-types.js'

// Estado de integración de cada proveedor (DA-88), separado de su estado documental (estable, preliminar…).
//
//  · documented: el modelo, su endpoint y sus parámetros constan en la documentación oficial (consultedAt).
//  · adapter:    EstateForge tiene un adaptador que construye la petición y lee la respuesta.
//  · contract:   el adaptador supera pruebas de contrato con respuestas HTTP simuladas que siguen la forma
//                documentada. Hay una prueba por cada modelo del catálogo (adapters.contract.test.ts,
//                «recorrido por los 65 modelos»).
//  · simulator:  el flujo de EstateForge para esa modalidad (trabajo, moderación, validación, almacenamiento,
//                interfaz) está probado de extremo a extremo con el simulador local. No implica al proveedor.
//  · real:       una prueba real controlada con la clave de un usuario lo ha validado. Nunca es estático:
//                EstateForge no lo declara en el catálogo; cada usuario ve el resultado de las suyas.
//
// Ninguno de los cuatro primeros niveles demuestra que el servicio real responda así.

/** Versión del contrato de los adaptadores: cambia cuando cambia la forma de alguna petición o respuesta. */
export const CONTRACT_VERSION = '2026-11-15.1'

const TEXT_CONTRACTS = ['ai/text/text-providers.contract.test.ts']
const MEDIA_CONTRACTS = ['ai-media/adapters/adapters.contract.test.ts']

/** Archivos del adaptador y pruebas de contrato de cada proveedor (rutas relativas a apps/api/src). */
export const PROVIDER_INTEGRATION: Record<string, { adapters: string[]; contractTests: string[] }> = {
  gemini: { adapters: ['ai/gemini.provider.ts', 'ai-media/gemini.adapter.ts'], contractTests: ['ai-media/ai-media.test.ts', 'ai/ai-providers-timeout.test.ts', ...MEDIA_CONTRACTS] },
  openai: { adapters: ['ai/openai.provider.ts', 'ai-media/adapters/openai.adapter.ts'], contractTests: ['ai/openai.contract.test.ts', ...MEDIA_CONTRACTS] },
  anthropic: { adapters: ['ai/text/text-providers.ts', 'ai-media/adapters/verify-only.adapter.ts'], contractTests: [...TEXT_CONTRACTS, ...MEDIA_CONTRACTS] },
  xai: { adapters: ['ai/text/text-providers.ts', 'ai-media/adapters/xai.adapter.ts'], contractTests: [...TEXT_CONTRACTS, ...MEDIA_CONTRACTS] },
  mistral: { adapters: ['ai/text/text-providers.ts', 'ai-media/adapters/verify-only.adapter.ts'], contractTests: [...TEXT_CONTRACTS, ...MEDIA_CONTRACTS] },
  deepseek: { adapters: ['ai/text/text-providers.ts', 'ai-media/adapters/verify-only.adapter.ts'], contractTests: [...TEXT_CONTRACTS, ...MEDIA_CONTRACTS] },
  openrouter: { adapters: ['ai/text/text-providers.ts', 'ai/text/openrouter-discovery.ts'], contractTests: TEXT_CONTRACTS },
  groq: { adapters: ['ai/text/text-providers.ts', 'ai-media/adapters/verify-only.adapter.ts'], contractTests: [...TEXT_CONTRACTS, ...MEDIA_CONTRACTS] },
  bfl: { adapters: ['ai-media/adapters/bfl.adapter.ts'], contractTests: MEDIA_CONTRACTS },
  stability: { adapters: ['ai-media/adapters/stability.adapter.ts'], contractTests: MEDIA_CONTRACTS },
  ideogram: { adapters: ['ai-media/adapters/ideogram.adapter.ts'], contractTests: MEDIA_CONTRACTS },
  recraft: { adapters: ['ai-media/adapters/recraft.adapter.ts'], contractTests: MEDIA_CONTRACTS },
  runway: { adapters: ['ai-media/adapters/runway.adapter.ts'], contractTests: MEDIA_CONTRACTS },
  fal: { adapters: ['ai-media/adapters/fal.adapter.ts'], contractTests: MEDIA_CONTRACTS },
  replicate: { adapters: ['ai-media/adapters/replicate.adapter.ts'], contractTests: MEDIA_CONTRACTS },
  simulador: { adapters: ['ai-media/simulator.adapter.ts', 'ai/mock-ai.provider.ts'], contractTests: ['ai-media/ai-media.test.ts'] },
}

/** Niveles alcanzados por un modelo según el código y las pruebas del repositorio (nunca «real»). */
export function integrationLevels(provider: ProviderDefinition, _model?: ModelDefinition): AiIntegrationLevel[] {
  const entry = PROVIDER_INTEGRATION[provider.id]
  if (!entry) return ['documented']
  return ['documented', 'adapter', 'contract', 'simulator']
}

/** Lo que la web muestra del estado de integración de un proveedor. */
export function publicIntegration(provider: ProviderDefinition) {
  return {
    contractVersion: CONTRACT_VERSION,
    levels: integrationLevels(provider),
    /** EstateForge no ha validado ningún proveedor contra el servicio real; cada usuario ve sus propias pruebas. */
    realValidation: null,
  }
}
