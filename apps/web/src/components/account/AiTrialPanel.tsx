import { useEffect, useMemo, useRef, useState } from 'react'

import { AI_COST_NOT_VERIFIABLE, type AiTrialKind } from '@estateforge/shared'

import { trialSummary } from '@/lib/aiTrials'
import { AiTrialPresets } from '@/components/account/AiTrialPresets'
import { cancelAiTrial, createAiTrial, getAiTrialPresets, listAiTrials, planAiTrial, pollAiTrial, type AiConnection, type AiProviderInfo, type AiTrial, type AiTrialPlan, type AiTrialPreset, type AiTrialTarget } from '@/services/aiMediaService'

// Pruebas reales controladas (DA-89). El usuario elige una de sus conexiones, un tipo de prueba y un modelo;
// EstateForge le muestra el plan (proveedor, fabricante, modelo, cuenta que factura, datos sintéticos que se
// envían y coste, o «Coste no verificable») y solo la ejecuta si lo confirma expresamente. Una sola operación,
// sin fotografías reales ni datos personales; el resultado se valida y se descarta. La clave nunca se escribe
// aquí: solo se usan las conexiones guardadas en Ajustes.

const KIND_LABEL: Record<AiTrialKind, string> = { text: 'Texto', poster: 'Imagen (fondo de cartel)', video: 'Vídeo' }
const CAPABILITY: Record<AiTrialKind, string> = { text: 'text', poster: 'image', video: 'video' }
const FINAL_TONE: Record<string, string> = { passed: 'text-emerald-700', failed: 'text-destructive', blocked: 'text-destructive', uncertain: 'text-amber-700', cancelled: 'text-muted-foreground', expired: 'text-muted-foreground' }

const when = (value: string | null) => (value ? new Date(value).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-trial`)

export function AiTrialPanel({ providers, connections }: { providers: AiProviderInfo[]; connections: AiConnection[] }) {
  const usable = useMemo(() => connections.filter(connection => providers.some(provider => provider.id === connection.provider)), [connections, providers])
  const [connectionId, setConnectionId] = useState('')
  const [kind, setKind] = useState<AiTrialKind>('text')
  const [model, setModel] = useState('')
  const [duration, setDuration] = useState<number | null>(null)
  const [plan, setPlan] = useState<AiTrialPlan | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trial, setTrial] = useState<AiTrial | null>(null)
  const [history, setHistory] = useState<AiTrial[]>([])
  const [presets, setPresets] = useState<AiTrialPreset[]>([])
  // Objetivo del plan en pantalla (de una prueba propuesta o de la prueba libre): es el que se ejecuta.
  const [active, setActive] = useState<{ target: AiTrialTarget; title: string } | null>(null)
  const idempotency = useRef(newKey())
  const abort = useRef<AbortController | null>(null)

  const connection = usable.find(item => item.id === connectionId) ?? null
  const provider = providers.find(item => item.id === connection?.provider) ?? null
  const kinds = (Object.keys(KIND_LABEL) as AiTrialKind[]).filter(item => provider?.capabilities.includes(CAPABILITY[item] as never))
  const models = provider?.models.filter(item => item.purpose === kind && item.selectable !== false) ?? []
  const selected = models.find(item => item.id === model) ?? null

  useEffect(() => {
    void listAiTrials()
      .then(setHistory)
      .catch(() => setHistory([]))
    void getAiTrialPresets()
      .then(setPresets)
      .catch(() => setPresets([]))
    return () => abort.current?.abort()
  }, [])

  // Cualquier cambio de la selección invalida el plan y la confirmación: hay que volver a revisarlo.
  function reset() {
    setPlan(null)
    setActive(null)
    setAccepted(false)
    setError(null)
    idempotency.current = newKey()
  }

  useEffect(() => {
    if (provider && !kinds.includes(kind)) setKind(kinds[0] ?? 'text')
  }, [provider, kinds, kind])
  useEffect(() => {
    setModel(models.find(item => item.tier === 'recommended')?.id ?? models[0]?.id ?? '')
  }, [connectionId, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDuration(kind === 'video' && selected?.video ? Math.min(...selected.video.durations) : null)
  }, [kind, selected])

  const target = (): AiTrialTarget | null => (connection && model ? { connectionId: connection.id, kind, model, ...(kind === 'video' && duration ? { durationSeconds: duration } : {}) } : null)

  async function prepare(given?: AiTrialTarget, title = 'Prueba libre') {
    const t = given ?? target()
    if (!t) return
    setBusy(true)
    setError(null)
    setPlan(null)
    try {
      setPlan(await planAiTrial(t))
      setActive({ target: t, title })
      setAccepted(false)
      idempotency.current = newKey()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se ha podido preparar la prueba.')
    } finally {
      setBusy(false)
    }
  }

  async function execute() {
    const t = active?.target
    if (!t || !plan || !accepted) return
    setBusy(true)
    setError(null)
    try {
      const created = await createAiTrial(t, plan, idempotency.current)
      setTrial(created)
      setPlan(null)
      setAccepted(false)
      idempotency.current = newKey()
      if (created.active) {
        abort.current?.abort()
        abort.current = new AbortController()
        await pollAiTrial(created.id, setTrial, abort.current.signal)
      }
      setActive(null)
      setHistory(await listAiTrials())
      setPresets(await getAiTrialPresets())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se ha podido ejecutar la prueba.')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!trial) return
    abort.current?.abort()
    try {
      setTrial(await cancelAiTrial(trial.id))
      setHistory(await listAiTrials())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se ha podido cancelar la prueba.')
    }
  }

  return (
    <section className="rounded-xl border p-4" aria-labelledby="ai-trial-title" data-testid="ai-trial-panel">
      <h3 id="ai-trial-title" className="font-semibold">
        Prueba real controlada de un proveedor
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Comprueba con una de tus conexiones que un proveedor funciona de verdad: EstateForge envía <strong>una sola</strong> petición con un inmueble ficticio e imágenes sintéticas (nunca tus fotografías ni datos personales), valida la respuesta y la descarta. Puede generar cargos en tu cuenta del proveedor: antes verás el proveedor, el modelo, la cuenta que factura y el coste, y tendrás que confirmarlo. Comprobar la conexión no demuestra que puedas generar; esta prueba sí lo hace, pero solo para el modelo elegido.
      </p>
      <AiTrialPresets presets={presets} busy={busy || Boolean(trial?.active)} onPrepare={(t, title) => void prepare(t, title)} />
      <details className="mt-4 text-sm" data-testid="ai-trial-free">
        <summary className="cursor-pointer font-medium">Prueba libre: otro proveedor, modelo o duración</summary>
      {usable.length === 0 ? (
        <p className="mt-3 text-sm" data-testid="ai-trial-empty">
          Conecta primero una API key en este apartado. Nunca escribas una clave en otro sitio.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block font-medium">Conexión</span>
            <select value={connectionId} onChange={event => { setConnectionId(event.target.value); reset() }} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5" data-testid="ai-trial-connection">
              <option value="">Elige una conexión</option>
              {usable.map(item => (
                <option key={item.id} value={item.id}>
                  {(providers.find(p => p.id === item.provider)?.name ?? item.provider) + (item.label ? ` · ${item.label}` : ' · principal')}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium">Tipo de prueba</span>
            <select value={kind} disabled={!provider} onChange={event => { setKind(event.target.value as AiTrialKind); reset() }} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5" data-testid="ai-trial-kind">
              {kinds.map(item => (
                <option key={item} value={item}>
                  {KIND_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium">Modelo</span>
            <select value={model} disabled={!provider} onChange={event => { setModel(event.target.value); reset() }} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5" data-testid="ai-trial-model">
              {models.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.maker && provider?.kind === 'aggregator' ? ` (${item.maker} vía ${provider.name})` : ''}
                </option>
              ))}
            </select>
          </label>
          {kind === 'video' && selected?.video && (
            <label className="text-sm">
              <span className="block font-medium">Duración</span>
              <select value={duration ?? ''} onChange={event => { setDuration(Number(event.target.value)); reset() }} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5" data-testid="ai-trial-duration">
                {selected.video.durations.map(value => (
                  <option key={value} value={value}>
                    {value} s{value === Math.min(...selected.video!.durations) ? ' (la mínima: la más barata)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="sm:col-span-2">
            <button type="button" disabled={busy || !connection || !model || Boolean(trial?.active)} onClick={() => void prepare()} className="rounded-md border px-3 py-1.5 text-sm" data-testid="ai-trial-prepare">
              Preparar la prueba
            </button>
          </div>
        </div>
      )}
      </details>

      {plan && (
        <div className="mt-4 rounded-lg border bg-muted/20 p-3 text-sm" data-testid="ai-trial-plan" role="region" aria-label="Confirmación de la prueba real">
          <p className="mb-2 font-semibold" data-testid="ai-trial-plan-title">
            Confirmación individual: {active?.title ?? 'Prueba'}
          </p>
          <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="font-medium">Proveedor de la API</dt>
            <dd>
              {plan.provider.name} ({plan.provider.kind === 'aggregator' ? 'agregador' : 'API directa'})
            </dd>
            <dt className="font-medium">Fabricante del modelo</dt>
            <dd>{plan.model.maker}</dd>
            <dt className="font-medium">Modelo</dt>
            <dd className="break-all font-mono text-xs">{plan.model.id}</dd>
            <dt className="font-medium">Cuenta que factura</dt>
            <dd>
              {plan.provider.billing} · conexión «{plan.connection.label || 'principal'}»
            </dd>
            <dt className="font-medium">Datos enviados</dt>
            <dd>
              <ul className="list-disc pl-4">
                {plan.dataSent.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </dd>
            {plan.resolutionLabel && (
              <>
                <dt className="font-medium">{plan.kind === 'video' ? 'Duración y resolución' : 'Resolución'}</dt>
                <dd>
                  {plan.durationSeconds ? `${plan.durationSeconds} s · ` : ''}
                  {plan.resolutionLabel}
                </dd>
              </>
            )}
            <dt className="font-medium">Referencias</dt>
            <dd>{plan.referenceImages === 0 ? 'Ninguna' : `${plan.referenceImages} imagen sintética`}</dd>
            <dt className="font-medium">Coste</dt>
            <dd data-testid="ai-trial-cost" className={plan.costVerifiable ? '' : 'font-medium text-amber-800'}>
              {plan.cost}
              <ul className="mt-1 space-y-0.5 text-xs font-normal text-foreground" data-testid="ai-trial-cost-lines">
                {plan.costLines.map(line => (
                  <li key={line.concept}>
                    {line.concept}: <strong>{line.usd === null ? 'no estimable' : line.usd.toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })}</strong> — {line.detail}
                  </li>
                ))}
              </ul>
              <span className="mt-1 block text-xs font-normal text-foreground">
                Total calculable: {plan.costKnownUsd.toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                {plan.costComplete ? '' : ', más las partes no estimables'}. Precio consultado el {plan.priceConsultedAt ? plan.priceConsultedAt.split('-').reverse().join('/') : '—'}.
              </span>
            </dd>
            {plan.moderationRequired && (
              <>
                <dt className="font-medium">Clasificador de seguridad</dt>
                <dd data-testid="ai-trial-moderation">{plan.moderation ? `${plan.moderation.name}${plan.moderation.external ? ' (externo, con tu clave; también puede generar cargos)' : ' (el del propio proveedor)'}` : 'No hay ninguno disponible: elige uno en «Clasificador de seguridad» antes de la prueba.'}</dd>
              </>
            )}
          </dl>
          <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
            {plan.warnings.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {!plan.costVerifiable && <p className="mt-2 text-xs font-medium">{AI_COST_NOT_VERIFIABLE}: autoriza la prueba solo si conoces la tarifa del proveedor.</p>}
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" checked={accepted} disabled={plan.moderationRequired && !plan.moderation} onChange={event => setAccepted(event.target.checked)} className="mt-1" data-testid="ai-trial-accept" />
            <span>
              Acepto que esta prueba envíe estos datos sintéticos a {plan.provider.name} y que pueda generar cargos en mi cuenta{plan.moderation?.external ? ` y en la de ${plan.moderation.name}` : ''}.
            </span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !accepted} onClick={() => void execute()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50" data-testid="ai-trial-run">
              Ejecutar la prueba real
            </button>
            <button type="button" disabled={busy} onClick={reset} className="rounded-md border px-3 py-1.5 text-sm">
              Descartar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert" data-testid="ai-trial-error">
          {error}
        </p>
      )}

      {trial && (
        <div className="mt-4 rounded-lg border p-3 text-sm" data-testid="ai-trial-result" data-status={trial.status}>
          <p>
            <span className="font-medium">{trial.providerName}</span> · <span className="font-mono text-xs">{trial.model}</span> · {KIND_LABEL[trial.kind]} —{' '}
            <span className={`font-medium ${FINAL_TONE[trial.status] ?? ''}`} data-testid="ai-trial-status">
              {trial.statusLabel}
            </span>
          </p>
          {trial.message && <p className="mt-1">{trial.message}</p>}
          <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground" data-testid="ai-trial-report">
            {trialSummary(trial).map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {trial.active && (
            <button type="button" onClick={() => void cancel()} className="mt-2 rounded-md border px-3 py-1.5 text-sm" data-testid="ai-trial-cancel">
              Cancelar la prueba
            </button>
          )}
        </div>
      )}

      {history.length > 0 && (
        <details className="mt-4 text-sm" data-testid="ai-trial-history">
          <summary className="cursor-pointer font-medium">Tus pruebas anteriores ({history.length})</summary>
          <ul className="mt-2 space-y-1">
            {history.map(item => (
              <li key={item.id} className="break-words text-xs">
                {when(item.createdAt)} · {item.providerName} · <span className="font-mono">{item.model}</span> · {KIND_LABEL[item.kind]} · <span className={FINAL_TONE[item.status] ?? ''}>{item.statusLabel}</span> · contrato {item.contractVersion}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
