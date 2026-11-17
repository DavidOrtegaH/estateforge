import { useId, useState } from 'react'
import { Sparkles } from 'lucide-react'

import { AI_POSTER_LABEL, AI_VIDEO_LABEL } from '@estateforge/shared'

import { describeCost, type AiConnection, type AiJob, type AiModelInfo, type AiOption, type AiProviderInfo } from '@/services/aiMediaService'

// Interfaz de la generación con IA (DA-71 a DA-75): confirmación previa con consentimiento expreso,
// estado del trabajo (sin porcentajes inventados), revisión de la propuesta y decisión del usuario.

export interface AiChoice {
  provider: AiProviderInfo
  model: AiModelInfo
  /** Cuenta del usuario con la que se generará. */
  connection: AiConnection
  /** Clasificador de seguridad que se usará: el del propio proveedor o el externo elegido en Ajustes. */
  moderation: { ok: boolean; text: string }
}

/** Selector de modelo, proveedor y cuenta para esta generación (no cambia la preferencia de Ajustes). */
export function AiModelSelect({ kind, options, value, onChange, disabled }: { kind: 'poster' | 'video'; options: AiOption[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      Modelo de IA para {kind === 'poster' ? 'el cartel' : 'el vídeo'}
      <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="min-w-0 rounded-md border bg-background px-2 py-1.5" data-testid={`ai-model-select-${kind}`}>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function AiConfirmDialog({
  kind,
  choice,
  photos,
  durationSeconds,
  onCancel,
  onConfirm,
}: {
  kind: 'poster' | 'video'
  choice: AiChoice
  photos: { id: string; url: string }[]
  durationSeconds?: number
  onCancel: () => void
  onConfirm: () => void
}) {
  const [consent, setConsent] = useState(false)
  const titleId = useId()
  const what =
    kind === 'poster'
      ? `el fondo de un cartel (imagen ${choice.model.image?.aspectRatio ?? '4:5'}, ${choice.model.image?.resolution ?? '1K'})`
      : `un clip de vídeo de ${durationSeconds} s (${choice.model.video?.aspectRatio ?? '16:9'}, ${choice.model.video?.resolution ?? '720p'}${choice.model.video?.nativeAudio === 'disabled' ? '; se pide sin audio' : choice.model.video?.nativeAudio === 'discarded' ? '; el audio del modelo se descarta' : ''})`
  const aggregator = choice.provider.kind === 'aggregator'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-background p-5 shadow-xl" data-testid="ai-confirm">
        <h3 id={titleId} className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="h-5 w-5 text-violet-600" aria-hidden="true" /> Generar {kind === 'poster' ? 'el cartel' : 'el vídeo'} con IA
        </h3>
        <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-medium">Proveedor de la API</dt>
          <dd className="min-w-0 break-words">
            {choice.provider.name}
            {aggregator ? ' (agregador)' : ''}
          </dd>
          <dt className="font-medium">Fabricante</dt>
          <dd className="min-w-0 break-words" data-testid="ai-maker">{choice.model.maker ?? choice.provider.name}</dd>
          <dt className="font-medium">Modelo</dt>
          <dd className="min-w-0 break-words">{choice.model.label}</dd>
          <dt className="font-medium">Factura</dt>
          <dd className="min-w-0 break-words" data-testid="ai-billing-account">
            {choice.provider.billing ?? `tu cuenta de ${choice.provider.name}`}
            {choice.connection.label ? ` · cuenta «${choice.connection.label}»` : ''}
          </dd>
          <dt className="font-medium">Generación</dt>
          <dd className="min-w-0 break-words">{what}</dd>
          <dt className="font-medium">Fotografías</dt>
          <dd className="min-w-0">{photos.length > 0 ? `${photos.length} del inmueble (sin metadatos de ubicación)` : 'Ninguna: este modelo solo genera a partir de texto'}</dd>
          <dt className="font-medium">Seguridad</dt>
          <dd className={`min-w-0 break-words ${choice.moderation.ok ? '' : 'text-destructive'}`} data-testid="ai-moderation">{choice.moderation.text}</dd>
        </dl>
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Fotografías que se enviarán">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <img src={photo.url} alt={`Fotografía ${index + 1} que se enviará`} className="h-12 w-16 rounded object-cover" />
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>
            Se usará <strong>tu API key guardada</strong> de {choice.provider.name}{aggregator ? `, que sirve el modelo de ${choice.model.maker ?? 'otro fabricante'} con sus propias tarifas` : ''}. El proveedor recibirá {photos.length > 0 ? 'esas fotografías' : 'solo las instrucciones de generación'}; el clasificador de seguridad recibirá además el título, la descripción y los destacados del anuncio. No se envían la dirección exacta, datos de contacto ni identificadores internos.
          </p>
          <p data-testid="ai-cost">
            {choice.provider.simulated ? 'Simulador local: no usa ningún servicio externo ni genera cargos.' : describeCost(choice.model, durationSeconds)}
          </p>
          <p>{choice.provider.dataUse}</p>
          <p>
            La propuesta se comprueba automáticamente y después <strong>la revisas tú</strong>: {kind === 'poster' ? 'el cartel actual' : 'el vídeo actual'} solo se sustituye si la aceptas. Los datos (precio, superficie, ubicación…) los escribe EstateForge, no la IA, y el resultado llevará el rótulo «{kind === 'poster' ? AI_POSTER_LABEL : AI_VIDEO_LABEL}».
          </p>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1" data-testid="ai-consent" />
          <span>Acepto enviar estos datos a {choice.provider.name} y que la operación pueda generar cargos en mi cuenta del proveedor.</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border px-3 py-2 text-sm">
            Cancelar
          </button>
          <button type="button" disabled={!consent || !choice.moderation.ok} onClick={onConfirm} className="rounded-md bg-violet-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            Generar con IA
          </button>
        </div>
      </div>
    </div>
  )
}

export interface AiPreview {
  url: string
  kind: 'poster' | 'video'
}

export function AiJobPanel({
  job,
  preview,
  composing,
  onCompose,
  onAccept,
  onReject,
  onRegenerate,
  onCancel,
  onDismiss,
}: {
  job: AiJob
  preview: AiPreview | null
  composing: boolean
  onCompose: () => void
  onAccept: () => void
  onReject: () => void
  onRegenerate: () => void
  onCancel: () => void
  onDismiss: () => void
}) {
  const active = ['pending', 'submitted', 'processing', 'moderating'].includes(job.status)
  const closed = ['rejected', 'cancelled', 'failed', 'blocked', 'expired', 'accepted'].includes(job.status)
  return (
    <section className="rounded-md border border-violet-300 bg-violet-50/50 p-3 text-sm dark:bg-violet-950/20" aria-live="polite" data-testid={`ai-job-${job.kind}`} data-ai-status={job.status}>
      <p className="flex flex-wrap items-center gap-x-2 font-medium">
        <Sparkles className="h-4 w-4 text-violet-600" aria-hidden="true" /> Generación con IA: <span data-testid="ai-job-status">{job.statusLabel}</span>
      </p>
      <p className="mt-1 break-words text-xs text-muted-foreground">
        {job.provider} · {job.model}
        {job.durationSeconds ? ` · ${job.durationSeconds} s` : ''} · {job.photoIds.length} fotografías{job.estimatedCostUsd !== null ? ` · coste estimado ${job.estimatedCostUsd.toLocaleString('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 })}` : ''}
      </p>
      {active && <p className="mt-1 text-xs text-muted-foreground">El proveedor no informa del porcentaje; puedes salir y volver a la ficha: el trabajo continúa.</p>}
      {job.message && (
        <p role={job.status === 'blocked' || job.status === 'failed' ? 'alert' : undefined} className="mt-2 text-sm text-destructive" data-testid="ai-job-message">
          {job.message} {job.kind === 'poster' ? 'El cartel actual no ha cambiado.' : 'El vídeo actual no ha cambiado.'}
        </p>
      )}
      {job.status === 'ready' && !preview && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            La propuesta ha superado la comprobación automática. {job.kind === 'video' ? 'Para revisarla se compone el vídeo final (clip, datos del anuncio y el sonido elegido); se graba en tiempo real con la pestaña visible.' : 'Para revisarla se compone el cartel final con los datos y fotografías reales.'}
          </p>
          <button type="button" disabled={composing} onClick={onCompose} className="rounded-md bg-violet-700 px-3 py-1.5 text-white disabled:opacity-50">
            {composing ? 'Componiendo la vista previa…' : 'Ver la propuesta'}
          </button>
        </div>
      )}
      {preview && (
        <div className="mt-2 space-y-2" data-testid="ai-preview">
          {preview.kind === 'poster' ? <img src={preview.url} alt="Propuesta de cartel con IA" className="mx-auto max-h-96 w-auto rounded border" /> : <video src={preview.url} controls className="max-h-96 w-full rounded border" aria-label="Propuesta de vídeo con IA" />}
          <p className="text-xs text-muted-foreground">Revisa que el resultado represente el inmueble con fidelidad. Si lo aceptas, sustituirá al material actual.</p>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {preview && job.status === 'ready' && (
          <button type="button" onClick={onAccept} className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground">
            Aceptar y sustituir
          </button>
        )}
        {job.status === 'ready' && (
          <>
            <button type="button" onClick={onReject} className="rounded-md border px-3 py-1.5">
              Rechazar
            </button>
            <button type="button" onClick={onRegenerate} className="rounded-md border px-3 py-1.5">
              Regenerar
            </button>
          </>
        )}
        {active && job.status !== 'moderating' && (
          <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1.5">
            Cancelar generación
          </button>
        )}
        {closed && (
          <button type="button" onClick={onDismiss} className="rounded-md border px-3 py-1.5">
            Cerrar
          </button>
        )}
      </div>
    </section>
  )
}
