import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Download, Film, Image as ImageIcon, RefreshCw, Sparkles } from 'lucide-react'

import { AI_POSTER_TEMPLATE_ID, AI_VIDEO_DEFAULT_DURATION, AI_VIDEO_DURATIONS, findAudioPreset, findPosterTemplate, POSTER_TEMPLATES, type AiVideoDuration, type PosterTemplateId } from '@estateforge/shared'

import { prepareSoundtrack } from '@/lib/regenerateListingMedia'
import { DEFAULT_AUDIO, type AudioChoice } from '@/lib/audioChoice'
import { fitWithin } from '@/lib/imagePrep'
import { defaultVideoSelection, describeMediaError, formatBytes, formatDuration, resolveVideoSelection } from '@/lib/mediaUi'
import { AI_POSTER_PHOTOS, photosForTemplate, renderAiPoster, renderPoster } from '@/lib/posterRenderer'
import { buildPromoContent, nextVariant, orderedPhotos, type MediaSourceData, type PromoContent } from '@/lib/promoContent'
import { AI_INTRO_SECONDS, AI_OUTRO_SECONDS, estimateDuration, renderAiVideo, renderVideo } from '@/lib/videoRenderer'
import { downloadPrivate, drawPosterTemplate, fileUrl, getMediaSource, listMedia, loadBitmap, MediaRequestError, mediaDownloadName, saveMedia, type ListingMediaItem, type SaveMediaMeta } from '@/services/mediaService'

import {
  ACTIVE_STATUSES,
  aiOptions,
  optionValue,
  cancelAiJob,
  createAiJob,
  fetchAiResult,
  getAiIntegrations,
  getAiProviders,
  listAiJobs,
  pollAiJob,
  rejectAiJob,
  type AiIntegrations,
  type AiJob,
  type AiProviderInfo,
} from '@/services/aiMediaService'

import { AiConfirmDialog, AiJobPanel, AiModelSelect, type AiChoice, type AiPreview } from './AiGeneration'
import { AudioPicker } from './AudioPicker'
import { ConfirmDialog } from './ConfirmDialog'
import { PosterTemplatePicker, type TemplateChoice } from './PosterTemplatePicker'
import { VideoPhotoPicker } from './VideoPhotoPicker'

// Cartel y vídeo del anuncio (DA-47, DA-52 a DA-56). Se componen en el navegador con los datos reales
// del anuncio y del inmueble y con sus fotografías; la API valida el archivo y sustituye el anterior
// solo cuando el nuevo ya está guardado. Cartel y vídeo son independientes: cada uno tiene sus
// opciones, su estado y su botón.

type Kind = 'poster' | 'video'

const LABELS: Record<Kind, { title: string; noun: string }> = {
  poster: { title: 'Cartel', noun: 'el cartel' },
  video: { title: 'Vídeo', noun: 'el vídeo' },
}

function describeItem(item: ListingMediaItem): string {
  if (item.kind === 'poster') {
    if (!item.templateId) return 'Diseño anterior a las plantillas'
    if (item.generationMode === 'ai') return `Generación con IA (${item.aiProvider ?? ''} · ${item.aiModel ?? ''}): fondo generado con IA, datos y fotografías reales`
    return `Plantilla ${item.templateName ?? item.templateId}${item.selectionMode === 'random' ? ' (elegida al azar)' : ''}`
  }
  const mode = item.generationMode === 'ai' ? `Generado con IA (${item.aiProvider ?? ''} · ${item.aiModel ?? ''}) · ` : ''
  if (!item.hasAudio) return `${mode}Sin sonido`
  const name = item.audioName ?? (item.audioSource === 'preset' ? findAudioPreset(item.audioTrackId)?.name : null) ?? 'pista'
  return `${mode}Sonido: ${name} (${item.audioVolume ?? 0} %)`
}

export function MediaCard({
  kind,
  item,
  busy,
  progress,
  error,
  propertyId,
  onGenerate,
  onCancel,
  outdated = false,
  children,
}: {
  kind: Kind
  item: ListingMediaItem | null
  busy: boolean
  progress: number | null
  error: { text: string; needsPhotos: boolean } | null
  propertyId: string
  onGenerate: () => void
  onCancel?: () => void
  outdated?: boolean
  children?: ReactNode
}) {
  const label = LABELS[kind]
  const Icon = kind === 'poster' ? ImageIcon : Film
  return (
    <article className="flex flex-col rounded-lg border bg-background p-4" aria-labelledby={`media-${kind}-title`} data-media-kind={kind}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`media-${kind}-title`} className="inline-flex items-center gap-2 font-semibold">
          <Icon className="h-4 w-4" aria-hidden="true" /> {label.title}
        </h3>
        {item && (
          <span className="text-xs text-muted-foreground">
            Versión {item.version} · {formatBytes(item.size)}
            {item.durationMs ? ` · ${Math.round(item.durationMs / 1000)} s` : ''} · {item.contentType === 'video/mp4' ? 'MP4' : item.contentType === 'video/webm' ? 'WebM' : 'JPEG'}
          </span>
        )}
      </div>
      {item && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid={`media-${kind}-details`}>
          {describeItem(item)}
        </p>
      )}

      <div className="mt-3 flex min-h-48 items-center justify-center overflow-hidden rounded-md bg-muted">
        {item && !outdated ? (
          kind === 'poster' ? (
            <img src={fileUrl(item.url)} alt={`Cartel del anuncio, versión ${item.version}`} className="max-h-96 w-auto object-contain" />
          ) : (
            <video src={fileUrl(item.url)} controls preload="metadata" className="max-h-96 w-full" aria-label={`Vídeo del anuncio, versión ${item.version}`} />
          )
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{outdated ? `El ${label.title.toLowerCase()} está desactualizado. Regénéralo para usar el idioma y los textos actuales, sin el pie anterior.` : `Todavía no se ha generado ${label.noun}.`}</p>
        )}
      </div>

      {busy && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {kind === 'video' && progress !== null ? `Grabando el vídeo… ${Math.round(progress * 100)} %. Mantén esta pestaña visible.` : `Generando ${label.noun}…`}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error.text}{' '}
          {error.needsPhotos && (
            <Link to={`/inmuebles/${propertyId}`} className="underline">
              Ir a la ficha del inmueble
            </Link>
          )}
        </p>
      )}

      {children && (
        <details className="mt-4 rounded-md border p-3" data-testid={`media-${kind}-options`}>
          <summary className="cursor-pointer text-sm font-medium">Opciones {kind === 'poster' ? 'del cartel' : 'del vídeo'}</summary>
          <div className="mt-3 space-y-4">{children}</div>
        </details>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onGenerate}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {item ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {item ? `Regenerar ${label.title.toLowerCase()}` : `Generar ${label.title.toLowerCase()}`}
        </button>
        {busy && onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
        )}
        {item && !outdated && !busy && (
          <a
            href={`${fileUrl(item.url)}&download=1`}
            onClick={event => {
              // Con JavaScript, la descarga se resuelve en el navegador (nombre propio con cualquier
              // almacenamiento); si falla, se sigue el enlace, que la API sirve como adjunto en local.
              event.preventDefault()
              const fallback = event.currentTarget.href
              void downloadPrivate(item.url, mediaDownloadName(item)).catch(() => window.location.assign(fallback))
            }}
            data-testid={`media-${kind}-download`}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Download className="h-4 w-4" aria-hidden="true" /> Descargar
          </a>
        )}
      </div>
    </article>
  )
}

const POSTER_SIDE = 1600
const PREVIEW_SIDE = 540

export function PromoMaterials({ generationId, propertyId }: { generationId: string; propertyId: string }) {
  const [media, setMedia] = useState<{ poster: ListingMediaItem | null; video: ListingMediaItem | null } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<Kind, boolean>>({ poster: false, video: false })
  const [errors, setErrors] = useState<Record<Kind, { text: string; needsPhotos: boolean } | null>>({ poster: null, video: null })
  const [progress, setProgress] = useState<number | null>(null)
  const [confirming, setConfirming] = useState<Kind | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [template, setTemplate] = useState<TemplateChoice>('random')
  const [audio, setAudio] = useState<AudioChoice>(DEFAULT_AUDIO)
  const [source, setSource] = useState<MediaSourceData | null>(null)
  const [content, setContent] = useState<PromoContent | null>(null)
  const [previews, setPreviews] = useState<ImageBitmap[]>([])
  const [videoPhotos, setVideoPhotos] = useState<string[]>([])
  const controllers = useRef<Partial<Record<Kind, AbortController>>>({})
  // Generación con IA (DA-71 a DA-75): catálogo y preferencias, modo del vídeo y trabajos por tipo.
  const [aiSetup, setAiSetup] = useState<{ providers: AiProviderInfo[]; integrations: AiIntegrations } | null>(null)
  const [videoMode, setVideoMode] = useState<'classic' | 'ai'>('classic')
  const [aiDuration, setAiDuration] = useState<AiVideoDuration>(AI_VIDEO_DEFAULT_DURATION)
  // Elección para esta generación (proveedor|modelo|conexión); null: la preferencia de Ajustes.
  const [aiOverride, setAiOverride] = useState<Record<Kind, string | null>>({ poster: null, video: null })
  const [aiJobs, setAiJobs] = useState<Record<Kind, AiJob | null>>({ poster: null, video: null })
  const [aiPreview, setAiPreview] = useState<Record<Kind, (AiPreview & { blob: Blob; meta: SaveMediaMeta }) | null>>({ poster: null, video: null })
  const [aiConfirm, setAiConfirm] = useState<Kind | null>(null)
  const [composing, setComposing] = useState<Kind | null>(null)
  const pollers = useRef<Partial<Record<Kind, AbortController>>>({})

  const load = useCallback(async () => {
    try {
      setMedia(await listMedia(generationId))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se ha podido cargar el material del anuncio.')
    }
  }, [generationId])

  useEffect(() => {
    void load()
  }, [load])

  // Datos y fotografías para las opciones: vistas previas de las plantillas y selección del vídeo.
  useEffect(() => {
    let cancelled = false
    const loaded: ImageBitmap[] = []
    void (async () => {
      try {
        const data = await getMediaSource(generationId)
        if (cancelled) return
        const ordered = orderedPhotos(data.photos)
        setSource(data)
        setContent(buildPromoContent(data))
        setVideoPhotos(defaultVideoSelection(ordered))
        for (const photo of ordered.slice(0, 4)) {
          loaded.push(await loadBitmap(photo.thumbUrl ?? photo.url, fitWithin(photo.width, photo.height, PREVIEW_SIDE)))
          if (cancelled) return
        }
        setPreviews([...loaded])
      } catch {
        // Sin vistas previas se puede generar igualmente; el error se verá al generar.
      }
    })()
    return () => {
      cancelled = true
      for (const bitmap of loaded) bitmap.close()
    }
  }, [generationId])

  const follow = useCallback((job: AiJob) => {
    setAiJobs(state => ({ ...state, [job.kind]: job }))
    if (!ACTIVE_STATUSES.includes(job.status)) return
    pollers.current[job.kind]?.abort()
    const controller = new AbortController()
    pollers.current[job.kind] = controller
    void pollAiJob(job.id, update => setAiJobs(state => ({ ...state, [update.kind]: update })), controller.signal).catch(() => undefined)
  }, [])

  // Catálogo de proveedores y preferencias del usuario, y trabajos de IA de este anuncio (al volver a la
  // ficha se recupera el estado: los trabajos siguen en la API aunque se cierre la página).
  useEffect(() => {
    void (async () => {
      try {
        const [providers, integrations] = await Promise.all([getAiProviders(), getAiIntegrations()])
        setAiSetup({ providers, integrations })
        for (const kind of ['poster', 'video'] as const) {
          const recent = (await listAiJobs(generationId)).find(job => job.kind === kind)
          if (recent && (ACTIVE_STATUSES.includes(recent.status) || recent.status === 'ready')) follow(recent)
        }
      } catch {
        // Sin IA disponible se sigue pudiendo generar de la forma clásica.
      }
    })()
    const current = pollers.current
    return () => {
      // Salir de la ficha deja de consultar, pero no cancela el trabajo.
      for (const controller of Object.values(current)) controller?.abort()
    }
  }, [generationId, follow])

  // Al salir de la página se cancela cualquier generación en curso: no se guarda nada a medias.
  useEffect(() => {
    const current = controllers.current
    return () => {
      for (const controller of Object.values(current)) controller?.abort()
    }
  }, [])

  async function generate(kind: Kind) {
    if (controllers.current[kind]) return // ya hay una en curso: nunca dos a la vez del mismo recurso
    const controller = new AbortController()
    controllers.current[kind] = controller
    setBusy(state => ({ ...state, [kind]: true }))
    setErrors(state => ({ ...state, [kind]: null }))
    setNotice(null)
    if (kind === 'video') setProgress(0)
    const bitmaps: ImageBitmap[] = []
    try {
      const fresh = await getMediaSource(generationId)
      if (fresh.photos.length === 0) throw new MediaRequestError('Sin fotografías.', 409, 'NO_PHOTOS')
      const photos = orderedPhotos(fresh.photos)
      const promo = buildPromoContent(fresh)
      const current = media?.[kind] ?? null
      if (kind === 'poster') {
        // Plantilla concreta, o sorteo de la API para «Aleatoria».
        const drawn = template === 'random' ? await drawPosterTemplate(generationId) : null
        const templateId = (drawn?.templateId ?? template) as PosterTemplateId
        if (!findPosterTemplate(templateId)) throw new Error('Plantilla desconocida.')
        const used = photos.slice(0, photosForTemplate(templateId, photos.length))
        for (const photo of used) bitmaps.push(await loadBitmap(photo.url, fitWithin(photo.width, photo.height, POSTER_SIDE), controller.signal))
        const result = await renderPoster(promo, bitmaps, templateId)
        if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError')
        const saved = await saveMedia(generationId, 'poster', result.blob, {
          sourceHash: fresh.sourceHash,
          expectedVersion: current?.version ?? 0,
          variant: POSTER_TEMPLATES.findIndex(item => item.id === templateId),
          photoIds: used.slice(0, result.photosUsed).map(photo => photo.id),
          poster: { templateId, selection: drawn ? 'random' : 'manual', drawId: drawn?.drawId },
        })
        setMedia(state => ({ poster: saved, video: state?.video ?? null }))
        setNotice(`Cartel ${current ? 'regenerado' : 'generado'} con la plantilla ${saved.templateName}${drawn ? ' (elegida al azar)' : ''} (versión ${saved.version}).`)
      } else {
        // Las fotografías elegidas, en el orden elegido; si la galería ha cambiado, no se adivina.
        const resolved = resolveVideoSelection(videoPhotos, photos)
        if (resolved.missing) {
          setVideoPhotos(current => resolveVideoSelection(current, photos).photos.map(photo => photo.id))
          throw new MediaRequestError('La galería ha cambiado: alguna fotografía elegida ya no existe. Revisa la selección y vuelve a generar.', 409, 'SOURCE_CHANGED')
        }
        const used = resolved.photos
        const seconds = estimateDuration(used.length)
        const soundtrack = await prepareSoundtrack(audio, seconds, controller.signal)
        const variant = nextVariant(current?.variant)
        const result = await renderVideo(promo, used.length, index => loadBitmap(used[index].url, fitWithin(used[index].width, used[index].height, POSTER_SIDE), controller.signal), variant, {
          signal: controller.signal,
          onProgress: setProgress,
          soundtrack,
        })
        if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError')
        const saved = await saveMedia(generationId, 'video', result.blob, {
          sourceHash: fresh.sourceHash,
          expectedVersion: current?.version ?? 0,
          variant,
          photoIds: used.map(photo => photo.id),
          durationMs: result.durationMs,
          codecs: result.mimeType,
          audio: soundtrack ? { source: audio.source, trackId: audio.trackId ?? undefined, volume: audio.volume, fadeInMs: audio.fadeInMs, fadeOutMs: audio.fadeOutMs } : { source: 'none' },
        })
        setMedia(state => ({ poster: state?.poster ?? null, video: saved }))
        setNotice(`Vídeo ${current ? 'regenerado' : 'generado'} (versión ${saved.version}, ${formatDuration(saved.durationMs ?? 0)}, ${saved.hasAudio ? `con ${saved.audioName}` : 'sin sonido'}).`)
      }
    } catch (error) {
      setErrors(state => ({ ...state, [kind]: describeMediaError(error) }))
      if (error instanceof MediaRequestError && error.code === 'VERSION_CONFLICT') await load()
    } finally {
      for (const bitmap of bitmaps) bitmap.close()
      if (controllers.current[kind] === controller) delete controllers.current[kind]
      setBusy(state => ({ ...state, [kind]: false }))
      if (kind === 'video') setProgress(null)
    }
  }

  /** Modelos compatibles con este material en las cuentas conectadas (solo los que generan imagen o vídeo). */
  const aiOptionList = (kind: Kind) => (aiSetup ? aiOptions(aiSetup.providers, aiSetup.integrations.connections, kind) : [])

  /** Clasificador de seguridad que usará la generación: el del proveedor o el externo elegido en Ajustes. */
  function moderationInfo(kind: Kind, provider: AiProviderInfo): AiChoice['moderation'] {
    const needed = kind === 'video' ? 'moderation-video' : 'moderation'
    if (provider.capabilities.includes(needed)) return { ok: true, text: `Clasificador de ${provider.name}, con la misma clave (consume de tu cuenta).` }
    const saved = aiSetup?.integrations.preferences.moderation
    const external = saved?.available ? aiSetup?.providers.find(item => item.id === saved.provider) : undefined
    if (external?.capabilities.includes(needed)) return { ok: true, text: `Filtros de ${provider.name} y, además, el clasificador de ${external.name} con tu clave de ${external.name} (su consumo se factura en esa cuenta).` }
    return { ok: false, text: `${provider.name} no trae un clasificador para ${kind === 'video' ? 'vídeo' : 'imágenes'}. Elige en Ajustes un clasificador de seguridad${kind === 'video' ? ' que analice vídeo (Google Gemini)' : ' (Google Gemini u OpenAI)'} con tu propia clave.` }
  }

  function aiChoice(kind: Kind): AiChoice | null {
    if (!aiSetup) return null
    const options = aiOptionList(kind)
    const preference = aiSetup.integrations.preferences[kind]
    // 1.º la elección de esta generación; 2.º la preferencia guardada (si sigue disponible). Nunca otra.
    const chosen =
      options.find(option => option.value === aiOverride[kind]) ??
      (preference && preference.available !== false
        ? (options.find(option => option.provider.id === preference.provider && option.model.id === preference.model && (!preference.connectionId || option.connection.id === preference.connectionId)) ?? null)
        : null)
    return chosen ? { provider: chosen.provider, model: chosen.model, connection: chosen.connection, moderation: moderationInfo(kind, chosen.provider) } : null
  }

  const aiValue = (kind: Kind) => {
    const choice = aiChoice(kind)
    return choice ? optionValue(choice.provider.id, choice.model.id, choice.connection.id) : ''
  }

  /** Duración del clip dentro de las que admite el modelo elegido. */
  const videoDuration = (choice: AiChoice): AiVideoDuration => {
    const allowed = (choice.model.video?.durations ?? AI_VIDEO_DURATIONS) as readonly number[]
    return (allowed.includes(aiDuration) ? aiDuration : (allowed.find(seconds => (AI_VIDEO_DURATIONS as readonly number[]).includes(seconds)) ?? AI_VIDEO_DEFAULT_DURATION)) as AiVideoDuration
  }

  const usesAi = (kind: Kind) => (kind === 'poster' ? template === AI_POSTER_TEMPLATE_ID : videoMode === 'ai')

  /** Fotografías que se enviarán al proveedor: propias, en orden y dentro del límite del modelo. */
  function aiPhotos(kind: Kind, choice: AiChoice) {
    const ordered = source ? orderedPhotos(source.photos) : []
    if (kind === 'poster') return ordered.slice(0, Math.min(AI_POSTER_PHOTOS, choice.model.maxReferenceImages))
    return resolveVideoSelection(videoPhotos, ordered).photos.slice(0, choice.model.maxReferenceImages)
  }

  function request(kind: Kind) {
    if (usesAi(kind)) {
      // La IA solo se ejecuta tras una confirmación expresa; nunca cambia de modo por su cuenta.
      if (!aiChoice(kind)) {
        setErrors(state => ({ ...state, [kind]: { text: aiOptionList(kind).length > 0 ? 'Elige un modelo de IA para esta generación.' : 'Configura un proveedor de IA y su API key en Ajustes para usar la generación con IA.', needsPhotos: false } }))
        return
      }
      setAiConfirm(kind)
      return
    }
    if (media?.[kind]) setConfirming(kind)
    else void generate(kind)
  }

  async function startAi(kind: Kind) {
    const choice = aiChoice(kind)
    if (!choice) return
    setErrors(state => ({ ...state, [kind]: null }))
    setNotice(null)
    try {
      const fresh = await getMediaSource(generationId)
      setSource(fresh)
      const job = await createAiJob(generationId, {
        kind,
        provider: choice.provider.id,
        model: choice.model.id,
        connectionId: choice.connection.id,
        photoIds: aiPhotos(kind, choice).map(photo => photo.id),
        ...(kind === 'video' && { durationSeconds: videoDuration(choice) }),
        sourceHash: fresh.sourceHash,
        expectedVersion: media?.[kind]?.version ?? 0,
        idempotencyKey: crypto.randomUUID(),
        consent: true,
      })
      setAiPreview(state => ({ ...state, [kind]: null }))
      follow(job)
    } catch (error) {
      setErrors(state => ({ ...state, [kind]: describeMediaError(error) }))
    }
  }

  /** Compone la propuesta final en el navegador: datos exactos y fotografías reales sobre el resultado. */
  async function composeAi(kind: Kind) {
    const job = aiJobs[kind]
    if (!job || job.status !== 'ready' || composing) return
    setComposing(kind)
    setErrors(state => ({ ...state, [kind]: null }))
    const bitmaps: ImageBitmap[] = []
    let clipUrl: string | null = null
    try {
      const fresh = await getMediaSource(generationId)
      const promo = buildPromoContent(fresh)
      const photos = orderedPhotos(fresh.photos)
      const expectedVersion = media?.[kind]?.version ?? 0
      const result = await fetchAiResult(job.id)
      if (kind === 'poster') {
        const background = await createImageBitmap(result)
        bitmaps.push(background)
        const used = job.photoIds.map(photoId => photos.find(photo => photo.id === photoId)).filter((photo): photo is (typeof photos)[number] => Boolean(photo)).slice(0, AI_POSTER_PHOTOS)
        if (used.length === 0) throw new MediaRequestError('Las fotografías de la propuesta ya no existen.', 409, 'SOURCE_CHANGED')
        for (const photo of used) bitmaps.push(await loadBitmap(photo.url, fitWithin(photo.width, photo.height, POSTER_SIDE)))
        const rendered = await renderAiPoster(promo, background, bitmaps.slice(1))
        const meta: SaveMediaMeta = { sourceHash: fresh.sourceHash, expectedVersion, variant: 0, photoIds: used.slice(0, rendered.photosUsed).map(photo => photo.id), poster: { templateId: AI_POSTER_TEMPLATE_ID, selection: 'manual' }, aiJobId: job.id }
        setAiPreview(state => ({ ...state, poster: { kind: 'poster', url: URL.createObjectURL(rendered.blob), blob: rendered.blob, meta } }))
      } else {
        clipUrl = URL.createObjectURL(result)
        const clip = document.createElement('video')
        clip.muted = true
        clip.playsInline = true
        clip.preload = 'auto'
        await new Promise<void>((resolve, reject) => {
          clip.onloadeddata = () => resolve()
          clip.onerror = () => reject(new MediaRequestError('El navegador no puede reproducir el clip generado.', 415, 'INVALID_FILE'))
          clip.src = clipUrl!
        })
        const seconds = AI_INTRO_SECONDS + Math.min(15, clip.duration) + AI_OUTRO_SECONDS
        const soundtrack = await prepareSoundtrack(audio, seconds, new AbortController().signal)
        setProgress(0)
        const rendered = await renderAiVideo(promo, clip, { soundtrack, onProgress: setProgress })
        const meta: SaveMediaMeta = {
          sourceHash: fresh.sourceHash,
          expectedVersion,
          variant: nextVariant(media?.video?.variant),
          photoIds: job.photoIds,
          durationMs: rendered.durationMs,
          codecs: rendered.mimeType,
          audio: soundtrack ? { source: audio.source, trackId: audio.trackId ?? undefined, volume: audio.volume, fadeInMs: audio.fadeInMs, fadeOutMs: audio.fadeOutMs } : { source: 'none' },
          aiJobId: job.id,
        }
        setAiPreview(state => ({ ...state, video: { kind: 'video', url: URL.createObjectURL(rendered.blob), blob: rendered.blob, meta } }))
      }
    } catch (error) {
      setErrors(state => ({ ...state, [kind]: describeMediaError(error) }))
    } finally {
      for (const bitmap of bitmaps) bitmap.close()
      if (clipUrl) URL.revokeObjectURL(clipUrl)
      setProgress(null)
      setComposing(null)
    }
  }

  async function acceptAi(kind: Kind) {
    const preview = aiPreview[kind]
    if (!preview) return
    setBusy(state => ({ ...state, [kind]: true }))
    try {
      const saved = await saveMedia(generationId, kind, preview.blob, preview.meta)
      setMedia(state => ({ poster: kind === 'poster' ? saved : (state?.poster ?? null), video: kind === 'video' ? saved : (state?.video ?? null) }))
      URL.revokeObjectURL(preview.url)
      setAiPreview(state => ({ ...state, [kind]: null }))
      setAiJobs(state => ({ ...state, [kind]: null }))
      setNotice(`${kind === 'poster' ? 'Cartel' : 'Vídeo'} con IA aceptado (versión ${saved.version}). El anterior se ha sustituido.`)
    } catch (error) {
      setErrors(state => ({ ...state, [kind]: describeMediaError(error) }))
      if (error instanceof MediaRequestError && error.code === 'VERSION_CONFLICT') await load()
    } finally {
      setBusy(state => ({ ...state, [kind]: false }))
    }
  }

  async function rejectAi(kind: Kind, then?: () => void) {
    const job = aiJobs[kind]
    const preview = aiPreview[kind]
    if (preview) URL.revokeObjectURL(preview.url)
    setAiPreview(state => ({ ...state, [kind]: null }))
    try {
      if (job?.status === 'ready') await rejectAiJob(job.id)
      setAiJobs(state => ({ ...state, [kind]: null }))
      then?.()
    } catch (error) {
      setErrors(state => ({ ...state, [kind]: describeMediaError(error) }))
    }
  }

  async function cancelAi(kind: Kind) {
    const job = aiJobs[kind]
    if (!job) return
    pollers.current[kind]?.abort()
    try {
      setAiJobs(state => ({ ...state, [kind]: null }))
      const cancelled = await cancelAiJob(job.id)
      setAiJobs(state => ({ ...state, [kind]: cancelled }))
    } catch (error) {
      setErrors(state => ({ ...state, [kind]: describeMediaError(error) }))
    }
  }

  const ordered = source ? orderedPhotos(source.photos) : []

  return (
    <section className="mt-6 rounded-lg border bg-card p-6" aria-labelledby="promo-title">
      <h2 id="promo-title" className="text-xl font-semibold">
        Cartel y vídeo
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Se crean en tu navegador con los datos de este anuncio, los del inmueble y sus fotografías (la principal primero). No se muestra la dirección exacta. El vídeo se graba en tiempo real: tarda lo que dura.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Usa fotografías originales sin carteles: las letras incrustadas en una imagen no se traducen ni eliminan al generar el material.</p>
      {loadError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {loadError}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm text-emerald-600">
          {notice}
        </p>
      )}
      {media === null && !loadError && <p className="mt-4 text-sm text-muted-foreground">Cargando…</p>}
      {media !== null && (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <MediaCard outdated={!!(source && media.poster?.sourceHash && media.poster.sourceHash !== source.sourceHash)} kind="poster" item={media.poster} busy={busy.poster} progress={null} error={errors.poster} propertyId={propertyId} onGenerate={() => request('poster')} onCancel={() => controllers.current.poster?.abort()}>
            <PosterTemplatePicker
              value={template}
              onChange={setTemplate}
              content={content}
              images={previews}
              loading={source === null}
              disabled={busy.poster}
              ai={(() => {
                const choice = aiChoice('poster')
                const hasOptions = aiOptionList('poster').length > 0
                return { available: Boolean(choice) || hasOptions, reason: choice || hasOptions ? null : 'Configura un proveedor y su API key para carteles con IA.', provider: choice ? `${choice.provider.name} · ${choice.model.label}` : null, model: choice?.model.id ?? null }
              })()}
            />
            {template === AI_POSTER_TEMPLATE_ID && aiOptionList('poster').length > 0 && (
              <div className="space-y-1" data-testid="poster-ai-options">
                <AiModelSelect kind="poster" options={[...(aiChoice('poster') ? [] : [{ value: '', label: 'Elige un modelo…' } as never]), ...aiOptionList('poster')]} value={aiValue('poster')} onChange={value => setAiOverride(state => ({ ...state, poster: value || null }))} disabled={busy.poster} />
                {(() => {
                  const choice = aiChoice('poster')
                  if (!choice) return null
                  return (
                    <p className="break-words text-xs text-muted-foreground">
                      Fabricante: {choice.model.maker ?? choice.provider.name} · API y factura: {choice.provider.name} · {choice.model.image?.resolution ?? '1K'} · {choice.model.maxReferenceImages > 0 ? `hasta ${Math.min(AI_POSTER_PHOTOS, choice.model.maxReferenceImages)} fotografías de referencia` : 'solo texto a imagen: no se envía ninguna fotografía'}. Vale solo para esta generación; la preferencia se cambia en Ajustes.
                    </p>
                  )
                })()}
              </div>
            )}
            {aiJobs.poster && (
              <AiJobPanel
                job={aiJobs.poster}
                preview={aiPreview.poster}
                composing={composing === 'poster'}
                onCompose={() => void composeAi('poster')}
                onAccept={() => void acceptAi('poster')}
                onReject={() => void rejectAi('poster')}
                onRegenerate={() => void rejectAi('poster', () => setAiConfirm('poster'))}
                onCancel={() => void cancelAi('poster')}
                onDismiss={() => setAiJobs(state => ({ ...state, poster: null }))}
              />
            )}
          </MediaCard>
          <MediaCard outdated={!!(source && media.video?.sourceHash && media.video.sourceHash !== source.sourceHash)} kind="video" item={media.video} busy={busy.video} progress={progress} error={errors.video} propertyId={propertyId} onGenerate={() => request('video')} onCancel={() => controllers.current.video?.abort()}>
            <fieldset className="min-w-0 space-y-2" data-testid="video-mode" disabled={busy.video}>
              <legend className="text-sm font-semibold">Modalidad</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="video-mode" checked={videoMode === 'classic'} onChange={() => setVideoMode('classic')} className="mt-1" />
                <span>
                  <span className="font-medium">Generación clásica</span> — en tu navegador con las fotografías y los datos; no necesita API key.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="video-mode" checked={videoMode === 'ai'} onChange={() => setVideoMode('ai')} className="mt-1" data-testid="video-mode-ai" />
                <span>
                  <span className="font-medium">Generación con IA</span> — clip creado por tu proveedor a partir de las fotografías elegidas, con los datos y el sonido de EstateForge. Puede tener coste en tu cuenta.
                </span>
              </label>
              {videoMode === 'ai' &&
                (() => {
                  const choice = aiChoice('video')
                  const videoOptions = aiOptionList('video')
                  if (!choice && videoOptions.length === 0)
                    return (
                      <p className="text-sm text-amber-700">
                        No hay un proveedor de vídeo con IA configurado.{' '}
                        <a href="/cuenta" className="underline">
                          Ir a Ajustes
                        </a>
                      </p>
                    )
                  if (!choice) return <AiModelSelect kind="video" options={[{ value: '', label: 'Elige un modelo…' } as never, ...videoOptions]} value="" onChange={value => setAiOverride(state => ({ ...state, video: value || null }))} disabled={busy.video} />
                  const sent = aiPhotos('video', choice)
                  return (
                    <div className="space-y-1 text-sm" data-testid="video-ai-options">
                      <AiModelSelect kind="video" options={videoOptions} value={aiValue('video')} onChange={value => setAiOverride(state => ({ ...state, video: value || null }))} disabled={busy.video} />
                      <p className="break-words">
                        Fabricante: {choice.model.maker ?? choice.provider.name} · API y factura: {choice.provider.name} · {choice.model.video?.resolution ?? '720p'} · {choice.model.video?.aspectRatio ?? '16:9'}. Se enviarán las {sent.length} primeras fotografías de tu selección (máximo {choice.model.maxReferenceImages} para este modelo), la principal primero.{' '}
                        {choice.model.video?.nativeAudio === 'discarded' ? 'Este modelo genera audio propio: EstateForge lo descarta y usa el sonido que elijas.' : 'El clip se pide sin audio: el sonido es el que elijas.'}
                      </p>
                      <label className="flex items-center gap-2">
                        Duración del clip
                        <select value={videoDuration(choice)} onChange={event => setAiDuration(Number(event.target.value) as AiVideoDuration)} className="rounded border bg-background px-2 py-1" data-testid="ai-duration">
                          {AI_VIDEO_DURATIONS.filter(seconds => (choice.model.video?.durations ?? AI_VIDEO_DURATIONS).includes(seconds)).map(seconds => (
                            <option key={seconds} value={seconds}>
                              {seconds} s
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-xs text-muted-foreground">El vídeo de IA es una recreación: sus movimientos no constituyen una representación fotográfica certificada y llevará un rótulo visible. Las fotografías originales no se sustituyen.</p>
                    </div>
                  )
                })()}
            </fieldset>
            {aiJobs.video && (
              <AiJobPanel
                job={aiJobs.video}
                preview={aiPreview.video}
                composing={composing === 'video'}
                onCompose={() => void composeAi('video')}
                onAccept={() => void acceptAi('video')}
                onReject={() => void rejectAi('video')}
                onRegenerate={() => void rejectAi('video', () => setAiConfirm('video'))}
                onCancel={() => void cancelAi('video')}
                onDismiss={() => setAiJobs(state => ({ ...state, video: null }))}
              />
            )}
            {ordered.length > 0 && <VideoPhotoPicker photos={ordered} selected={videoPhotos} onChange={setVideoPhotos} disabled={busy.video} />}
            <AudioPicker value={audio} onChange={setAudio} disabled={busy.video} />
          </MediaCard>
        </div>
      )}
      {aiConfirm && aiChoice(aiConfirm) && (
        <AiConfirmDialog
          kind={aiConfirm}
          choice={aiChoice(aiConfirm)!}
          photos={aiPhotos(aiConfirm, aiChoice(aiConfirm)!).map(photo => ({ id: photo.id, url: fileUrl(photo.thumbUrl ?? photo.url) }))}
          durationSeconds={aiConfirm === 'video' ? videoDuration(aiChoice(aiConfirm)!) : undefined}
          onCancel={() => setAiConfirm(null)}
          onConfirm={() => {
            const kind = aiConfirm
            setAiConfirm(null)
            void startAi(kind)
          }}
        />
      )}
      {confirming && (
        <ConfirmDialog
          id="promo-regenerate"
          title={`Regenerar ${LABELS[confirming].noun}`}
          description={`Se creará ${LABELS[confirming].noun} con las opciones elegidas (${confirming === 'poster' ? (template === 'random' ? 'plantilla al azar' : `plantilla ${findPosterTemplate(template)?.name}`) : audio.source === 'none' ? 'sin sonido' : 'con sonido'}) y los datos actuales. La versión actual se sustituye solo cuando la nueva se haya guardado correctamente; después ya no se podrá recuperar.`}
          confirmLabel="Regenerar"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const kind = confirming
            setConfirming(null)
            void generate(kind)
          }}
        />
      )}
    </section>
  )
}
