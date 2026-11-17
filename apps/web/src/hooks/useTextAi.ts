import { useEffect, useState } from 'react'

import { getProviderLabel, type AIProviderType } from '@estateforge/shared'

import { getAiIntegrations, getAiProviders, type AiConnection, type AiModelInfo, type AiPreference, type AiProviderInfo } from '@/services/aiMediaService'

// Generación de texto con la API key del propio usuario (BYOK obligatorio, DA-77 y DA-82). EstateForge no
// aporta claves de IA: un proveedor solo se puede elegir si el usuario ha guardado su clave en Ajustes. La
// «plantilla local» no es IA, no llama a ningún servicio y siempre está disponible. Proveedores, modelos y
// precios vienen del catálogo de la API.

export interface TextAiOption {
  id: AIProviderType
  label: string
  /** Nombre corto para el selector (DA-90): la descripción completa va en el aviso bajo el selector. */
  shortLabel?: string
  /** false: el usuario no tiene API key de este proveedor. */
  enabled: boolean
  /** Modelo que se usará por defecto: el de la preferencia del usuario o el recomendado. */
  model: AiModelInfo | null
  /** Modelos de texto elegibles de este proveedor. */
  models: AiModelInfo[]
  /** Conexiones del usuario con este proveedor. */
  connections: AiConnection[]
  provider: AiProviderInfo | null
}

export interface TextAiState {
  ready: boolean
  options: TextAiOption[]
  /** Proveedor de IA preferido y utilizable, o null si no hay ninguno. */
  preferred: AIProviderType | null
  preference: AiPreference | null
}

/** Modelo y conexión elegidos para esta generación, y confirmación del usuario. */
export interface TextAiChoiceValue {
  model: string | null
  connectionId: string | null
  consent: boolean
}
export const EMPTY_TEXT_CHOICE: TextAiChoiceValue = { model: null, connectionId: null, consent: false }

export const LOCAL_TEMPLATE: TextAiOption = { id: 'mock', label: 'Plantilla local (sin IA)', enabled: true, model: null, models: [], connections: [], provider: null }

/** Proveedores de texto del catálogo de la API, marcando cuáles tiene conectados el usuario. */
export function useTextAi(): TextAiState {
  const [state, setState] = useState<TextAiState>({ ready: false, options: [LOCAL_TEMPLATE], preferred: null, preference: null })
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [providers, integrations] = await Promise.all([getAiProviders(), getAiIntegrations()])
        if (cancelled) return
        const preference = integrations.preferences.text
        const options: TextAiOption[] = providers
          .filter(provider => provider.capabilities.includes('text'))
          .map(provider => {
            // Solo modelos que generan texto y siguen siendo elegibles.
            const models = provider.models.filter(model => model.purpose === 'text' && model.selectable !== false && (!model.outputs || model.outputs.includes('text')))
            const model = models.find(item => preference?.provider === provider.id && item.id === preference.model) ?? models[0] ?? null
            const connections = integrations.connections.filter(connection => connection.provider === provider.id)
            return { id: provider.id as AIProviderType, label: provider.name, shortLabel: provider.name.length > 24 ? getProviderLabel(provider.id) : provider.name, enabled: connections.length > 0, model, models, connections, provider }
          })
        const usable = options.filter(option => option.enabled)
        const preferred = usable.find(option => option.id === preference?.provider)?.id ?? usable[0]?.id ?? null
        setState({ ready: true, options: [LOCAL_TEMPLATE, ...options], preferred, preference })
      } catch {
        // Sin catálogo se puede seguir usando la plantilla local y editar los textos a mano.
        setState({ ready: true, options: [LOCAL_TEMPLATE], preferred: null, preference: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
