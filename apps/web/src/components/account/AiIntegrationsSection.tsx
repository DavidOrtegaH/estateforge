import { useCallback, useEffect, useMemo, useState } from 'react'

import { AI_INTEGRATION_LEVEL_LABELS, AI_MODEL_STATUS_LABELS, maskedKey } from '@estateforge/shared'

import { AiTrialPanel } from '@/components/account/AiTrialPanel'
import { ProviderLogo } from '@/components/ai/ProviderLogo'

import {
  aiOptions,
  createAiConnection,
  deleteAiConnection,
  describePricing,
  discoverAiModels,
  getAiIntegrations,
  getAiProviders,
  optionValue,
  saveAiPreferences,
  TIER_LABELS,
  updateAiConnection,
  verifyAiConnection,
  type AiConnection,
  type AiDiscoveredModel,
  type AiIntegrations,
  type AiPreference,
  type AiPreferenceChoice,
  type AiProviderInfo,
} from '@/services/aiMediaService'

// Integraciones de IA del usuario (BYOK; DA-67 a DA-69 y DA-82 a DA-86). El catálogo de proveedores,
// fabricantes, modelos, capacidades y precios viene de la API. Cada proveedor admite varias conexiones
// (cuentas) con una etiqueta. La clave se escribe, se envía una vez y el campo se vacía: después solo se
// muestran sus 4 últimos caracteres. No hay ninguna forma de recuperarla.

const STATUS: Record<string, { label: string; tone: string }> = {
  verified: { label: 'Verificada', tone: 'bg-emerald-100 text-emerald-800' },
  unverified: { label: 'Sin comprobar', tone: 'bg-amber-100 text-amber-800' },
  invalid: { label: 'Clave rechazada', tone: 'bg-red-100 text-red-800' },
  error: { label: 'Error al comprobar', tone: 'bg-red-100 text-red-800' },
}

const CAPABILITIES: Record<string, string> = {
  text: 'Texto',
  image: 'Imagen',
  'image-reference': 'Imagen con referencias',
  video: 'Vídeo',
  'video-reference': 'Vídeo con referencias',
  moderation: 'Moderación',
  'moderation-video': 'Moderación de vídeo',
  'async-operations': 'Operaciones asíncronas',
  'model-discovery': 'Catálogo de modelos consultable',
}

const PURPOSES = { text: 'Textos con IA', poster: 'Carteles con IA', video: 'Vídeos con IA' } as const
const PURPOSE_NOUN = { text: 'textos', poster: 'carteles', video: 'vídeos' } as const
type Purpose = keyof typeof PURPOSES

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'connected', label: 'Conectados' },
  { id: 'text', label: 'Texto' },
  { id: 'image', label: 'Imagen' },
  { id: 'video', label: 'Vídeo' },
  { id: 'aggregator', label: 'Agregadores' },
] as const
type Filter = (typeof FILTERS)[number]['id']

const date = (value: string | null) => (value ? new Date(value).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const day = (value?: string) => (value ? value.split('-').reverse().join('/') : '')

export function AiIntegrationsSection() {
  const [providers, setProviders] = useState<AiProviderInfo[] | null>(null)
  const [data, setData] = useState<AiIntegrations | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [prefs, setPrefs] = useState<Record<Purpose, string>>({ text: '', poster: '', video: '' })
  const [moderation, setModeration] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [discovered, setDiscovered] = useState<{ connectionId: string; models: AiDiscoveredModel[]; note: string } | null>(null)
  // Confirmación de que el usuario acepta una comprobación cuyo coste no indica la documentación (DA-87).
  const [costAck, setCostAck] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try {
      const [list, integrations] = await Promise.all([getAiProviders(), getAiIntegrations()])
      setProviders(list)
      setData(integrations)
      const pref = (value: AiPreference | null) => {
        if (!value) return ''
        const own = integrations.connections.filter(connection => connection.provider === value.provider)
        const connection = own.find(item => item.id === value.connectionId) ?? (own.length === 1 ? own[0] : own.find(item => item.label === ''))
        return optionValue(value.provider, value.model, connection?.id ?? '')
      }
      setPrefs({ text: pref(integrations.preferences.text), poster: pref(integrations.preferences.poster), video: pref(integrations.preferences.video) })
      setModeration(integrations.preferences.moderation ? `${integrations.preferences.moderation.provider}|${integrations.preferences.moderation.connectionId}` : '')
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se han podido cargar las integraciones.' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function run(key: string, action: () => Promise<string>) {
    setBusy(key)
    setMessage(null)
    try {
      setMessage({ tone: 'ok', text: await action() })
      await load()
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se ha podido completar la operación.' })
    } finally {
      setBusy(null)
    }
  }

  const connectionsOf = useCallback((provider: string): AiConnection[] => data?.connections.filter(item => item.provider === provider) ?? [], [data])
  const options = (purpose: Purpose) => aiOptions(providers ?? [], data?.connections ?? [], purpose)
  const parse = (value: string): AiPreferenceChoice | null => {
    if (!value) return null
    const [provider, model, connectionId] = value.split('|')
    return { provider, model, connectionId: connectionId || null }
  }
  /** Preferencia guardada cuyo modelo o conexión ya no está disponible: se avisa y el usuario elige otra. */
  const unavailable = (purpose: Purpose) => {
    const saved = data?.preferences[purpose]
    return saved && saved.available === false ? saved : null
  }
  /** Conexiones que pueden clasificar contenido (moderación externa para proveedores que no traen la suya). */
  const moderators = useMemo(
    () =>
      (providers ?? [])
        .filter(provider => provider.capabilities.includes('moderation'))
        .flatMap(provider => connectionsOf(provider.id).map(connection => ({ value: `${provider.id}|${connection.id}`, label: `${provider.name}${connection.label ? ` · ${connection.label}` : ''}${provider.capabilities.includes('moderation-video') ? ' (imagen y vídeo)' : ' (texto e imagen; no vídeo)'}` }))),
    [providers, connectionsOf],
  )

  const shown = (providers ?? []).filter(provider => {
    if (filter === 'all') return true
    if (filter === 'connected') return connectionsOf(provider.id).length > 0
    if (filter === 'aggregator') return provider.kind === 'aggregator'
    return provider.capabilities.includes(filter)
  })

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-labelledby="ai-integrations-title" data-testid="ai-integrations">
      <div className="border-b px-5 py-5 sm:px-6">
        <h2 id="ai-integrations-title" className="text-lg font-semibold">
          Integraciones de inteligencia artificial
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          EstateForge no proporciona claves de IA ni paga el consumo de IA de sus usuarios. Para generar textos, carteles o vídeos con IA conecta tu propia API key: el proveedor te factura el uso directamente, según tu plan, incluidas las comprobaciones de seguridad (moderación) que se hagan con tu clave. La clave es solo tuya: se guarda cifrada (AES-256-GCM), solo la usa el servidor para la operación que pidas y nunca se vuelve a mostrar. Sin clave puedes seguir usando todo lo demás: inmuebles, fotos, anuncios, las seis plantillas, Aleatoria, el vídeo clásico y la edición manual.
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Un <strong>agregador</strong> (OpenRouter, Groq, Runway, fal.ai, Replicate) sirve modelos de otros fabricantes: la clave y la factura son del agregador, con sus propias tarifas, no las del fabricante del modelo.
        </p>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        {providers === null && !message && <p className="text-sm text-muted-foreground">Cargando…</p>}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar proveedores">
          {FILTERS.map(item => (
            <button key={item.id} type="button" onClick={() => setFilter(item.id)} aria-pressed={filter === item.id} className={`rounded-full border px-3 py-1 text-sm ${filter === item.id ? 'bg-primary text-primary-foreground' : 'bg-background'}`} data-testid={`ai-filter-${item.id}`}>
              {item.label}
            </button>
          ))}
          <span className="self-center text-xs text-muted-foreground" data-testid="ai-provider-count">
            {shown.length} de {providers?.length ?? 0} proveedores
          </span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map(provider => {
            const own = connectionsOf(provider.id)
            const adding = (inputs[provider.id] ?? '').trim()
            return (
              <article key={provider.id} id={`ai-provider-${provider.id}`} className="min-w-0 scroll-mt-4 rounded-xl border p-4" data-ai-provider={provider.id} data-ai-kind={provider.kind ?? 'direct'}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProviderLogo providerId={provider.id} name={provider.name} />
                    <div className="min-w-0">
                      <h3 className="font-semibold">{provider.name}</h3>
                      {provider.kind === 'aggregator' && (
                        <p className="text-xs text-muted-foreground" data-testid="ai-makers">
                          Modelos de: {[...new Set(provider.models.map(model => model.maker).filter(Boolean))].join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="flex flex-wrap items-center gap-1">
                    {!provider.simulated && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${provider.kind === 'aggregator' ? 'bg-sky-100 text-sky-800' : 'bg-muted text-muted-foreground'}`}>{provider.kind === 'aggregator' ? 'Agregador' : 'API directa'}</span>}
                    {own.length === 0 && <span className="text-xs text-muted-foreground">Sin configurar</span>}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>
                {provider.billing && (
                  <p className="mt-1 text-xs" data-testid="ai-billing">
                    <span className="font-medium">Factura:</span> {provider.billing}
                  </p>
                )}
                {provider.integration && !provider.simulated && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="ai-integration-status">
                    <span className="font-medium text-foreground">Integración en EstateForge:</span> {provider.integration.levels.map(level => AI_INTEGRATION_LEVEL_LABELS[level]).join(' · ')}.{' '}
                    {(data?.realTrials?.[provider.id] ?? []).length > 0 ? (
                      <span data-testid="ai-real-trials">Validado por ti con el servicio real: {data!.realTrials![provider.id].map(item => `${item.model} (${item.completedAt ? new Date(item.completedAt).toLocaleDateString('es-ES') : '—'})`).join(', ')}.</span>
                    ) : (
                      <span>Sin validar con el servicio real: EstateForge no lo ha probado con una clave real; puedes hacerlo tú con una prueba real controlada.</span>
                    )}
                  </p>
                )}
                <ul className="mt-2 flex flex-wrap gap-1" aria-label="Capacidades">
                  {provider.capabilities.map(capability => (
                    <li key={capability} className="rounded bg-muted px-2 py-0.5 text-xs">
                      {CAPABILITIES[capability] ?? capability}
                    </li>
                  ))}
                </ul>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-medium">Modelos, precios y datos ({provider.models.length})</summary>
                  <ul className="mt-2 space-y-2">
                    {provider.models.map(model => (
                      <li key={model.id} className="break-words" data-model={model.id}>
                        <span className="font-medium">{model.label}</span> — {PURPOSE_NOUN[model.purpose]}
                        {model.tier && !provider.simulated && (
                          <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${model.tier === 'recommended' ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}`} data-model-tier={model.tier}>
                            {TIER_LABELS[model.tier]}
                          </span>
                        )}{' '}
                        · {model.stability}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {model.maker && <span data-model-maker>Fabricante: {model.maker}. </span>}
                          {model.status && model.status !== 'stable' && model.status !== 'unknown' && <span>Estado: {AI_MODEL_STATUS_LABELS[model.status]}. </span>}
                          {model.purpose === 'video' && model.video && (
                            <span>
                              Duraciones: {model.video.durations.join(', ')} s · {model.video.resolution} · {model.video.aspectRatio} · {model.video.nativeAudio === 'disabled' ? 'se pide sin audio' : model.video.nativeAudio === 'discarded' ? 'EstateForge descarta el audio del modelo' : 'sin audio'}.{' '}
                            </span>
                          )}
                          {model.purpose === 'poster' && model.image && (
                            <span>
                              {model.image.resolution} · {model.image.aspectRatio} · {model.maxReferenceImages > 0 ? `hasta ${Math.min(3, model.maxReferenceImages)} fotografías de referencia` : 'solo texto a imagen (no se envían fotografías)'}.{' '}
                            </span>
                          )}
                          {model.pricing ? describePricing(model.pricing) : provider.simulated ? 'Sin coste: no usa ningún servicio externo.' : 'Consultar tarifa del proveedor: su precio no está publicado o no se ha podido verificar.'} {model.notes}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">{provider.dataUse}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Seguridad: {provider.moderation} Comprobación de la clave: {provider.verification}
                    {provider.authentication ? ` Autenticación: ${provider.authentication}.` : ''}
                    {provider.consultedAt ? ` Documentación verificada el ${day(provider.consultedAt)}.` : ''}
                  </p>
                  {provider.links.terms && (
                    <p className="mt-1 flex flex-wrap gap-3 text-xs">
                      <a className="underline" href={provider.links.docs} target="_blank" rel="noreferrer noopener">Documentación</a>
                      <a className="underline" href={provider.links.pricing} target="_blank" rel="noreferrer noopener">Precios</a>
                      <a className="underline" href={provider.links.keys} target="_blank" rel="noreferrer noopener">Obtener API key</a>
                      <a className="underline" href={provider.links.terms} target="_blank" rel="noreferrer noopener">Condiciones</a>
                      <a className="underline" href={provider.links.privacy} target="_blank" rel="noreferrer noopener">Privacidad</a>
                    </p>
                  )}
                </details>

                {own.map(connection => {
                  const status = STATUS[connection.status] ?? STATUS.unverified
                  const replacing = (inputs[connection.id] ?? '').trim()
                  return (
                    <div key={connection.id} className="mt-3 rounded-lg border bg-muted/20 p-3" data-testid="ai-connection" data-connection-label={connection.label}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <ProviderLogo providerId={provider.id} name={provider.name} size="sm" />
                          <p className="min-w-0 text-sm font-medium break-words">
                            {connection.label || 'Conexión principal'} <span className="font-normal text-muted-foreground">· {provider.name}</span>
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`} data-testid="ai-connection-status">
                          {status.label}
                        </span>
                      </div>
                      <p className="mt-1 text-sm" data-testid="ai-key-masked">
                        API key configurada: <span className="font-mono">{maskedKey(connection.keyHint)}</span>
                        <span className="block text-xs text-muted-foreground">
                          Actualizada: {date(connection.updatedAt)} · Última comprobación correcta: {date(connection.lastVerifiedAt)}
                        </span>
                      </p>
                      {(() => {
                        // Usos para los que esta conexión es la elegida (o la que se usaría por ser la única o la principal).
                        const uses: string[] = (['text', 'poster', 'video'] as const).filter(purpose => {
                          const saved = data?.preferences[purpose]
                          if (!saved || saved.provider !== provider.id) return false
                          return saved.connectionId ? saved.connectionId === connection.id : own.length === 1 || connection.label === ''
                        }).map(purpose => PURPOSES[purpose])
                        if (data?.preferences.moderation?.connectionId === connection.id) uses.push('Clasificador de seguridad')
                        return uses.length > 0 ? (
                          <p className="mt-1 flex flex-wrap gap-1 text-xs" data-testid="ai-connection-uses">
                            <span className="text-muted-foreground">Preferida para:</span>
                            {uses.map(use => (
                              <span key={use} className="rounded bg-primary/10 px-1.5 py-0.5 font-medium">
                                {use}
                              </span>
                            ))}
                          </p>
                        ) : null
                      })()}
                      <form
                        className="mt-2 flex flex-col gap-2 sm:flex-row"
                        onSubmit={event => {
                          event.preventDefault()
                          if (!replacing) return
                          void run(`replace:${connection.id}`, async () => {
                            await updateAiConnection(connection.id, { apiKey: replacing })
                            setInputs(state => ({ ...state, [connection.id]: '' }))
                            return `API key de ${provider.name} sustituida. Comprueba la conexión antes de usarla.`
                          })
                        }}
                      >
                        <label className="sr-only" htmlFor={`ai-key-${connection.id}`}>
                          Nueva API key de {provider.name}
                        </label>
                        <input
                          id={`ai-key-${connection.id}`}
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={inputs[connection.id] ?? ''}
                          onChange={event => setInputs(state => ({ ...state, [connection.id]: event.target.value }))}
                          placeholder="Nueva API key para sustituirla"
                          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                        />
                        <button type="submit" disabled={busy !== null || !replacing} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                          Sustituir
                        </button>
                      </form>
                      {provider.verificationCost === 'unknown' && (
                        <label className="mt-2 flex items-start gap-2 text-xs">
                          <input type="checkbox" checked={costAck[connection.id] === true} onChange={event => setCostAck(state => ({ ...state, [connection.id]: event.target.checked }))} className="mt-0.5" data-testid="ai-verify-ack" />
                          <span>La comprobación no genera contenido, pero la documentación de {provider.name} no indica si tiene coste. Acepto hacerla.</span>
                        </label>
                      )}
                      {provider.verificationCost === 'free' && <p className="mt-2 text-xs text-muted-foreground">Comprobación sin coste según la documentación del proveedor.</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy !== null || (provider.verificationCost === 'unknown' && costAck[connection.id] !== true)}
                          onClick={() =>
                            void run(`verify:${connection.id}`, async () => {
                              const result = await verifyAiConnection(connection.id, provider.verificationCost === 'unknown' && costAck[connection.id] === true)
                              if (result.message) return result.message
                              if (result.status === 'verified') return 'Conexión comprobada: la clave es válida. Esto no demuestra que puedas generar: para eso, haz una prueba real controlada.'
                              return result.diagnostics?.message ?? (result.status === 'invalid' ? 'El proveedor ha rechazado la clave.' : 'No se ha podido comprobar la conexión ahora mismo.')
                            })
                          }
                          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                          data-testid="ai-verify"
                        >
                          Comprobar conexión
                        </button>
                        {provider.capabilities.includes('model-discovery') && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() =>
                              void run(`discover:${connection.id}`, async () => {
                                const result = await discoverAiModels(connection.id)
                                setDiscovered({ connectionId: connection.id, models: result.models, note: result.note })
                                return `${result.models.length} modelos encontrados en el catálogo de ${provider.name}.`
                              })
                            }
                            className="rounded-md border px-3 py-1.5 text-sm"
                            data-testid="ai-discover"
                          >
                            Ver más modelos
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => {
                            if (!window.confirm(`¿Eliminar esta API key de ${provider.name}? Las preferencias que la usen se borrarán.`)) return
                            void run(`delete:${connection.id}`, async () => {
                              await deleteAiConnection(connection.id)
                              return `API key de ${provider.name} eliminada.`
                            })
                          }}
                          className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive"
                        >
                          Eliminar
                        </button>
                      </div>
                      {connection.diagnostics && (
                        <div className="mt-2 rounded border bg-background p-2 text-xs" data-testid="ai-diagnostics">
                          <p>
                            <span className="font-medium">Última comprobación:</span> {date(connection.diagnostics.checkedAt)} · no genera contenido.
                          </p>
                          {connection.diagnostics.message && (
                            <p className="mt-1 text-destructive" data-testid="ai-diagnostics-problem">
                              {connection.diagnostics.message}
                            </p>
                          )}
                          {connection.diagnostics.models && (
                            <p className="mt-1" data-testid="ai-diagnostics-models">
                              Tu cuenta lista {connection.diagnostics.models.accountTotal} modelos. Del catálogo de EstateForge aparecen: {connection.diagnostics.models.listedByAccount.join(', ') || 'ninguno'}.
                              {connection.diagnostics.models.notListedByAccount.length > 0 && <> No aparecen (puede que tu cuenta no tenga acceso): {connection.diagnostics.models.notListedByAccount.join(', ')}.</>}
                            </p>
                          )}
                          <p className="mt-1 text-muted-foreground">Una comprobación correcta no garantiza saldo ni permiso para generar.</p>
                        </div>
                      )}
                      {discovered?.connectionId === connection.id && (
                        <div className="mt-2 text-xs" data-testid="ai-discovered">
                          <p className="text-muted-foreground">{discovered.note}</p>
                          <label className="mt-1 flex flex-col gap-1">
                            Usar para los textos (no verificado por EstateForge)
                            <select
                              className="rounded-md border bg-background px-2 py-1.5"
                              defaultValue=""
                              onChange={event => {
                                const model = event.target.value
                                if (!model) return
                                void run('prefs', async () => {
                                  await saveAiPreferences({ text: { provider: provider.id, model, connectionId: connection.id }, poster: parse(prefs.poster), video: parse(prefs.video) })
                                  return `Modelo ${model} guardado para los textos. No está verificado por EstateForge: consulta su precio en ${provider.name}.`
                                })
                              }}
                            >
                              <option value="">Elige un modelo…</option>
                              {discovered.models.map(model => (
                                <option key={model.id} value={model.id}>
                                  {model.label} · {model.maker} ({model.id})
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                  )
                })}

                <form
                  className="mt-3 flex flex-col gap-2"
                  onSubmit={event => {
                    event.preventDefault()
                    if (!adding) return
                    const label = (labels[provider.id] ?? '').trim()
                    void run(`save:${provider.id}`, async () => {
                      await createAiConnection(provider.id, adding, label)
                      setInputs(state => ({ ...state, [provider.id]: '' }))
                      setLabels(state => ({ ...state, [provider.id]: '' }))
                      return `API key de ${provider.name} guardada. Comprueba la conexión antes de usarla.`
                    })
                  }}
                >
                  {own.length > 0 && (
                    <>
                      <label className="text-xs font-medium" htmlFor={`ai-label-${provider.id}`}>
                        Añadir otra cuenta de {provider.name}: etiqueta (por ejemplo, «profesional»)
                      </label>
                      <input
                        id={`ai-label-${provider.id}`}
                        type="text"
                        maxLength={40}
                        value={labels[provider.id] ?? ''}
                        onChange={event => setLabels(state => ({ ...state, [provider.id]: event.target.value }))}
                        placeholder="Etiqueta de la cuenta"
                        className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm"
                        data-testid={`ai-label-input-${provider.id}`}
                      />
                    </>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="sr-only" htmlFor={`ai-key-${provider.id}`}>
                      API key de {provider.name}
                    </label>
                    <input
                      id={`ai-key-${provider.id}`}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={inputs[provider.id] ?? ''}
                      onChange={event => setInputs(state => ({ ...state, [provider.id]: event.target.value }))}
                      placeholder={provider.keyHelp}
                      className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                      data-testid={`ai-key-input-${provider.id}`}
                    />
                    <button type="submit" disabled={busy !== null || !adding || (own.length > 0 && !(labels[provider.id] ?? '').trim())} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                      {own.length > 0 ? 'Añadir cuenta' : 'Guardar'}
                    </button>
                  </div>
                </form>
              </article>
            )
          })}
        </div>

        {data && (
          <form
            className="rounded-xl border p-4"
            onSubmit={event => {
              event.preventDefault()
              void run('prefs', async () => {
                const [moderationProvider, moderationConnection] = moderation.split('|')
                await saveAiPreferences({ text: parse(prefs.text), poster: parse(prefs.poster), video: parse(prefs.video), moderation: moderation ? { provider: moderationProvider, connectionId: moderationConnection } : null })
                return 'Preferencias guardadas.'
              })
            }}
          >
            <h3 className="font-semibold">Proveedor y modelo predeterminados</h3>
            <p className="mt-1 text-xs text-muted-foreground">Cada lista solo muestra modelos que generan ese tipo de contenido y cuentas que has conectado. En cada generación puedes elegir otro sin cambiar esta preferencia.</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {(['text', 'poster', 'video'] as const).map(purpose => (
                <label key={purpose} className="flex min-w-0 flex-col gap-1 text-sm">
                  {PURPOSES[purpose]}
                  <select value={prefs[purpose]} onChange={event => setPrefs(state => ({ ...state, [purpose]: event.target.value }))} className="min-w-0 rounded-md border bg-background px-2 py-2" data-testid={`ai-pref-${purpose}`}>
                    <option value="">Sin configurar</option>
                    {unavailable(purpose) && (
                      <option value={optionValue(unavailable(purpose)!.provider, unavailable(purpose)!.model, '')} disabled>
                        {unavailable(purpose)!.model} — ya no disponible
                      </option>
                    )}
                    {data.preferences[purpose] && data.preferences[purpose]!.available !== false && prefs[purpose] && !options(purpose).some(option => option.value === prefs[purpose]) && <option value={prefs[purpose]}>{data.preferences[purpose]!.model} — no verificado</option>}
                    {options(purpose).map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {unavailable(purpose) && (
                    <span className="text-xs text-amber-700" role="status" data-testid={`ai-pref-${purpose}-unavailable`}>
                      El modelo que tenías elegido ya no está disponible. Elige otro y guarda: EstateForge no lo sustituye por su cuenta.
                    </span>
                  )}
                </label>
              ))}
            </div>
            <label className="mt-3 flex min-w-0 flex-col gap-1 text-sm">
              Clasificador de seguridad para proveedores que no traen uno
              <select value={moderation} onChange={event => setModeration(event.target.value)} className="min-w-0 rounded-md border bg-background px-2 py-2 sm:max-w-md" data-testid="ai-pref-moderation">
                <option value="">Sin configurar</option>
                {moderators.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                Antes de aceptar un cartel o un vídeo generado con IA se clasifican los textos, las fotografías y el resultado. Algunos proveedores (Google Gemini) lo hacen con su propia clave; para el resto debes elegir aquí un clasificador con tu clave: su consumo se factura en tu cuenta de ese proveedor. Sin clasificador, esos proveedores no generan.
              </span>
            </label>
            <button type="submit" disabled={busy !== null} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Guardar preferencias
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              Los precios son los publicados por cada proveedor en la fecha indicada y sirven de referencia: la facturación definitiva depende del proveedor y de tu cuenta (plan, impuestos, descuentos y modalidad de proceso). Comprobar la conexión no genera contenido; generar sí consume. EstateForge no puede limitar el gasto de tu cuenta en el proveedor.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Uso registrado en EstateForge (no es la factura del proveedor): {data.usage.last24Hours} generaciones en 24 h. Límites: {data.usage.limits.concurrent} a la vez, {data.usage.limits.daily} al día y {data.usage.limits.monthly} en 30 días.
            </p>
          </form>
        )}
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-destructive' : 'text-emerald-700'}`}>
            {message.text}
          </p>
        )}
        {providers && data && <AiTrialPanel providers={providers} connections={data.connections} />}
      </div>
    </section>
  )
}
