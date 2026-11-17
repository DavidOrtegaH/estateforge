import { useState } from 'react'

import type { AiTrialKind } from '@estateforge/shared'

import { ProviderLogo } from '@/components/ai/ProviderLogo'
import type { AiTrialPreset, AiTrialTarget } from '@/services/aiMediaService'

// Las seis pruebas reales propuestas (DA-93), agrupadas por modalidad. Cada tarjeta muestra el proveedor que
// recibe la clave y factura (con su logotipo), el fabricante del modelo, el modelo, la capacidad, resolución o
// duración, referencias, el desglose del coste y el clasificador. La conexión se elige expresamente: nunca se
// toma una por el usuario. «Preparar» solo calcula el plan; la ejecución exige su confirmación individual.

const GROUPS: { kind: AiTrialKind; title: string }[] = [
  { kind: 'text', title: 'Texto' },
  { kind: 'poster', title: 'Imagen' },
  { kind: 'video', title: 'Vídeo' },
]
const STATUS: Record<string, string> = { verified: 'verificada', unverified: 'sin comprobar', invalid: 'clave rechazada', error: 'con error' }
const money = (usd: number) => usd.toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const day = (value: string | null) => (value ? value.split('-').reverse().join('/') : '—')

export function AiTrialPresets({ presets, busy, onPrepare }: { presets: AiTrialPreset[]; busy: boolean; onPrepare: (target: AiTrialTarget, title: string) => void }) {
  const [chosen, setChosen] = useState<Record<string, string>>({})
  return (
    <div className="mt-4 space-y-4" data-testid="ai-trial-presets">
      <h4 className="text-sm font-semibold">Pruebas propuestas: una API directa y un agregador por modalidad</h4>
      {GROUPS.map(group => (
        <section key={group.kind} aria-label={`Pruebas de ${group.title.toLowerCase()}`}>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h5>
          <div className="mt-2 grid gap-3 @container lg:grid-cols-2">
            {presets
              .filter(preset => preset.kind === group.kind)
              .map(preset => {
                const connectionId = chosen[preset.id] ?? ''
                const connection = preset.connections.find(item => item.id === connectionId) ?? null
                const blocked = !preset.available || preset.connections.length === 0 || (preset.moderationRequired && preset.moderationMissing)
                return (
                  <article key={preset.id} className="min-w-0 rounded-lg border p-3 text-sm" data-testid="ai-trial-preset" data-preset={preset.id} data-preset-state={!preset.available ? 'no-disponible' : preset.connections.length === 0 ? 'pendiente-credenciales' : preset.moderationRequired && preset.moderationMissing ? 'sin-clasificador' : 'lista'}>
                    <div className="flex min-w-0 items-start gap-3">
                      <ProviderLogo providerId={preset.provider} name={preset.providerName} />
                      <div className="min-w-0">
                        <p className="font-semibold">{preset.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Proveedor de la API y factura: <strong className="text-foreground">{preset.providerName}</strong> ({preset.providerKind === 'aggregator' ? 'agregador' : 'API directa'})
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Fabricante del modelo: {preset.maker ?? '—'} · <span className="break-all font-mono">{preset.model}</span>
                        </p>
                      </div>
                    </div>
                    <dl className="mt-2 grid gap-x-3 gap-y-0.5 text-xs @sm:grid-cols-[max-content_1fr]">
                      <dt className="font-medium">Capacidad</dt>
                      <dd>{preset.capability}</dd>
                      {preset.durationSeconds !== undefined && (
                        <>
                          <dt className="font-medium">Duración y resolución</dt>
                          <dd>
                            {preset.durationSeconds} s · {preset.resolution ?? 'la del catálogo'}
                          </dd>
                        </>
                      )}
                      <dt className="font-medium">Referencias</dt>
                      <dd>{preset.references === 0 ? 'Ninguna' : `${preset.references} imagen sintética`}</dd>
                      <dt className="font-medium">Clasificador</dt>
                      <dd data-testid="ai-trial-preset-moderation">
                        {!preset.moderationRequired ? 'No hace falta (texto)' : preset.moderation ? `${preset.moderation.name}${preset.moderation.external ? ' (con tu clave)' : ' (el propio)'}` : 'Falta: elige en «Clasificador de seguridad» una conexión de Google Gemini. Sin él, la prueba está bloqueada.'}
                      </dd>
                      <dt className="font-medium">Coste</dt>
                      <dd data-testid="ai-trial-preset-cost">
                        {preset.cost ? (
                          <>
                            <ul className="space-y-0.5">
                              {preset.cost.lines.map(line => (
                                <li key={line.concept}>
                                  {line.concept}: <strong>{line.usd === null ? 'no estimable' : money(line.usd)}</strong> <span className="text-muted-foreground">— {line.detail}</span>
                                </li>
                              ))}
                            </ul>
                            <p className="mt-0.5">
                              Total calculable: <strong>{money(preset.cost.knownUsd)}</strong>
                              {preset.cost.complete ? '' : ' más lo no estimable'} · precio consultado el {day(preset.cost.priceConsultedAt)}
                              {preset.cost.priceStale && <span className="font-medium text-amber-800"> (hace más de 7 días: compruébalo)</span>}
                            </p>
                          </>
                        ) : (
                          'Consultar tarifa del proveedor'
                        )}
                      </dd>
                    </dl>
                    <p className="mt-1 text-xs text-muted-foreground">{preset.notes}</p>
                    {!preset.available && (
                      <p className="mt-2 text-xs font-medium text-destructive" data-testid="ai-trial-preset-unavailable">
                        {preset.unavailableReason}
                      </p>
                    )}
                    {preset.connections.length === 0 ? (
                      <p className="mt-2 text-xs" data-testid="ai-trial-preset-pending">
                        <span className="font-medium text-amber-800">Pendiente de credenciales.</span>{' '}
                        <a className="underline" href={`#ai-provider-${preset.provider}`}>
                          Añade tu API key de {preset.providerName}
                        </a>{' '}
                        en su tarjeta, más arriba.
                      </p>
                    ) : (
                      <label className="mt-2 block text-xs">
                        <span className="font-medium">Cuenta que se usará</span>
                        <select value={connectionId} onChange={event => setChosen(state => ({ ...state, [preset.id]: event.target.value }))} className="mt-1 box-border w-full min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5" data-testid="ai-trial-preset-connection">
                          <option value="">Elige una de tus conexiones de {preset.providerName}</option>
                          {preset.connections.map(item => (
                            <option key={item.id} value={item.id}>
                              {(item.label || 'Conexión principal') + ` · ${STATUS[item.status] ?? item.status}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {connection?.modelNotListed && <p className="mt-1 text-xs text-amber-800">La última comprobación de esta cuenta no lista este modelo: puede que no tengas acceso.</p>}
                    {preset.lastTrial && (
                      <p className="mt-1 text-xs" data-testid="ai-trial-preset-last">
                        Última prueba: {preset.lastTrial.statusLabel} ({new Date(preset.lastTrial.createdAt).toLocaleDateString('es-ES')})
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={busy || blocked || !connection}
                      onClick={() => connection && onPrepare({ connectionId: connection.id, kind: preset.kind, model: preset.model, references: preset.references, ...(preset.durationSeconds !== undefined && { durationSeconds: preset.durationSeconds }), ...(preset.resolution && { resolution: preset.resolution }) }, preset.title)}
                      className="mt-2 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                      data-testid="ai-trial-preset-prepare"
                    >
                      Preparar esta prueba
                    </button>
                  </article>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}
