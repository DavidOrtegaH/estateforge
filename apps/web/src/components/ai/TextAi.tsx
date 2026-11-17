import { Link } from 'react-router'

import type { AIProviderType } from '@estateforge/shared'

import type { TextAiChoiceValue, TextAiOption, TextAiState } from '@/hooks/useTextAi'
import { describePricing } from '@/services/aiMediaService'

// Controles de la generación de texto con la API key del usuario (BYOK obligatorio, DA-77 y DA-82).

export function TextProviderOptions({ options }: { options: TextAiOption[] }) {
  return (
    <>
      {options.map(option => (
        <option key={option.id} value={option.id} disabled={!option.enabled}>
          {option.shortLabel ?? option.label}
          {option.enabled ? '' : ' — requiere tu API key'}
        </option>
      ))}
    </>
  )
}

/** Modelo que se usará: el elegido para esta generación o el predeterminado de la opción. */
function chosenModel(option: TextAiOption | undefined, value?: TextAiChoiceValue) {
  if (!option) return null
  return option.models.find(model => model.id === value?.model) ?? option.model
}

/** Aviso bajo el selector: qué se usará y quién paga, o cómo configurar una clave. */
export function TextAiNotice({ provider, state, errorCode, value }: { provider: AIProviderType; state: TextAiState; errorCode?: string | null; value?: TextAiChoiceValue }) {
  const option = state.options.find(item => item.id === provider)
  const hasAi = state.options.some(item => item.id !== 'mock' && item.enabled)
  const settings = (
    <Link to="/cuenta" className="font-medium underline">
      Abrir los ajustes de IA
    </Link>
  )
  if (errorCode === 'AI_KEY_REQUIRED' || errorCode === 'AI_KEY_UNREADABLE' || errorCode === 'AI_INVALID_API_KEY') {
    return (
      <p className="mt-2 text-xs text-amber-700" data-testid="text-ai-notice">
        Revisa la API key de este proveedor: debe ser la tuya y estar guardada en Ajustes. {settings}
      </p>
    )
  }
  if (errorCode === 'AI_PERMISSION_DENIED') {
    return (
      <p className="mt-2 text-xs text-amber-700" data-testid="text-ai-notice">
        El proveedor reconoce tu API key, pero tu cuenta no tiene permiso para este modelo u operación. Revisa los permisos, el plan o la región en tu cuenta del proveedor. {settings}
      </p>
    )
  }
  if (provider === 'mock') {
    return (
      <p className="mt-2 text-xs text-muted-foreground" data-testid="text-ai-notice">
        La plantilla local no usa IA ni consume ninguna API.{' '}
        {state.ready && !hasAi && (
          <>
            Para generar con IA necesitas tu propia API key: EstateForge no aporta claves y el proveedor te factura el consumo directamente. {settings}
          </>
        )}
      </p>
    )
  }
  const model = chosenModel(option, value)
  return (
    <p className="mt-2 text-xs text-muted-foreground" data-testid="text-ai-notice">
      Se usará tu API key de {option?.label ?? provider}
      {model ? ` con el modelo ${model.label}` : ''}
      {model?.maker && option?.provider?.kind === 'aggregator' ? ` (fabricante: ${model.maker}; la API y la factura son de ${option.label})` : ''}. Se envían los datos del inmueble (sin tu contacto). El proveedor factura el consumo en tu cuenta
      {model?.pricing ? `: ${model.pricing.detail} (consultado el ${model.pricing.consultedAt.split('-').reverse().join('/')})` : '; consulta su tarifa oficial'}.
    </p>
  )
}

/**
 * Elección para esta generación: modelo, conexión (si hay varias) y confirmación expresa. No cambia la
 * preferencia guardada en Ajustes. Solo aparece con un proveedor de IA elegido.
 */
export function TextAiChoice({ provider, state, value, onChange, disabled }: { provider: AIProviderType; state: TextAiState; value: TextAiChoiceValue; onChange: (value: TextAiChoiceValue) => void; disabled?: boolean }) {
  const option = state.options.find(item => item.id === provider)
  if (provider === 'mock' || !option?.enabled) return null
  const model = chosenModel(option, value)
  const preferredConnection = state.preference?.provider === provider ? state.preference.connectionId : null
  const connectionId = value.connectionId ?? preferredConnection ?? (option.connections.length === 1 ? option.connections[0].id : (option.connections.find(connection => connection.label === '')?.id ?? ''))
  const billing = option.provider?.billing ?? `tu cuenta de ${option.label}`
  return (
    <div className="@container mt-3 min-w-0 space-y-2 rounded-md border bg-muted/30 p-3 text-sm break-words" data-testid="text-ai-choice">
      {/* Dos columnas solo si el propio bloque es ancho (consulta de contenedor), no según la ventana. */}
      <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1">
          Modelo
          <select value={model?.id ?? ''} disabled={disabled} onChange={event => onChange({ ...value, model: event.target.value })} className="box-border w-full min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5" data-testid="text-ai-model">
            {option.models.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {/* Fabricante y recomendación fuera de la opción (DA-90): un texto largo se recortaría en móvil. */}
          {model && (model.tier === 'recommended' || (model.maker && option.provider?.kind === 'aggregator')) && (
            <span className="text-xs text-muted-foreground" data-testid="text-ai-model-info">
              {[model.maker && option.provider?.kind === 'aggregator' ? `Fabricante: ${model.maker}` : null, model.tier === 'recommended' ? 'Recomendado por EstateForge' : null].filter(Boolean).join(' · ')}
            </span>
          )}
        </label>
        {option.connections.length > 1 && (
          <label className="flex min-w-0 flex-col gap-1">
            Cuenta
            <select value={connectionId} disabled={disabled} onChange={event => onChange({ ...value, connectionId: event.target.value || null })} className="box-border w-full min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5" data-testid="text-ai-connection">
              {!connectionId && <option value="">Elige una conexión</option>}
              {option.connections.map(connection => (
                <option key={connection.id} value={connection.id}>
                  {connection.label || 'Conexión principal'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="text-ai-cost">
        Factura: {billing}. {model?.pricing ? describePricing(model.pricing) : 'Consultar tarifa del proveedor: no hay un precio publicado verificado.'} El importe depende de los tokens de cada petición; un anuncio usa unos pocos miles.
      </p>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={value.consent} disabled={disabled} onChange={event => onChange({ ...value, consent: event.target.checked })} className="mt-1" data-testid="text-ai-consent" />
        <span>Acepto enviar los datos del inmueble a {option.label} y que el consumo se cargue en mi cuenta de ese proveedor.</span>
      </label>
    </div>
  )
}
