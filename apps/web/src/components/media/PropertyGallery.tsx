import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ImagePlus, Maximize2, RefreshCw, Star, Trash2, X } from 'lucide-react'

import { MAX_PROPERTY_PHOTOS } from '@estateforge/shared'

import { useModalDialog } from '@/hooks/useModalDialog'
import { makeThumbnail, prepareForUpload, runPool, UPLOAD_CONCURRENCY, validatePhotoFile } from '@/lib/imagePrep'
import { formatBytes, moveId, moveTo, planUploads, type UploadState } from '@/lib/mediaUi'
import { deletePhoto, fetchPrivate, fileUrl, listPhotos, replacePhoto, reorderPhotos, setPrimaryPhoto, uploadPhoto, uploadThumbnail, type GalleryResponse, type PropertyPhoto } from '@/services/mediaService'

import { ConfirmDialog } from './ConfirmDialog'

// Galería del inmueble: hasta 50 fotografías (DA-46, DA-51). Todas las operaciones las vuelve a
// comprobar la API; aquí solo se evita lo que se sabe que va a fallar y se informa del resultado.
// Las subidas van de tres en tres; cada fotografía lleva su miniatura, que es lo que se muestra en la
// rejilla (con 50 fotografías, mostrar las originales ocuparía cientos de megas de memoria).

export function PhotoGrid({
  photos,
  busy,
  onView,
  onMove,
  onPrimary,
  onReplace,
  onDelete,
}: {
  photos: PropertyPhoto[]
  busy: boolean
  onView: (index: number) => void
  onMove: (index: number, delta: -1 | 1) => void
  onPrimary: (photo: PropertyPhoto) => void
  onReplace: (photo: PropertyPhoto) => void
  onDelete: (photo: PropertyPhoto) => void
}) {
  return (
    <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label="Fotografías del inmueble">
      {photos.map((photo, index) => (
        <li key={photo.id} className="overflow-hidden rounded-lg border bg-background" data-photo-id={photo.id}>
          <button type="button" onClick={() => onView(index)} className="group relative block aspect-[4/3] w-full bg-muted" aria-label={`Ver la fotografía ${index + 1} de ${photos.length} a tamaño grande`}>
            <img src={fileUrl(photo.thumbUrl ?? photo.url)} alt={photo.originalName ?? `Fotografía ${index + 1}`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
              {index + 1}/{photos.length}
            </span>
            {photo.isPrimary && (
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold text-black">
                <Star className="h-3 w-3" aria-hidden="true" /> Principal
              </span>
            )}
            <Maximize2 className="absolute bottom-2 right-2 h-4 w-4 text-white opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
          </button>
          <div className="flex flex-wrap items-center justify-between gap-1 p-2">
            <div className="flex gap-1">
              <button type="button" disabled={busy || index === 0} onClick={() => onMove(index, -1)} className="rounded border p-1.5 hover:bg-muted disabled:opacity-40" aria-label="Mover a la izquierda" title="Mover a la izquierda">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" disabled={busy || index === photos.length - 1} onClick={() => onMove(index, 1)} className="rounded border p-1.5 hover:bg-muted disabled:opacity-40" aria-label="Mover a la derecha" title="Mover a la derecha">
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex gap-1">
              <button type="button" disabled={busy || photo.isPrimary} onClick={() => onPrimary(photo)} className="rounded border p-1.5 hover:bg-muted disabled:opacity-40" aria-label="Usar como principal" title="Usar como principal">
                <Star className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" disabled={busy} onClick={() => onReplace(photo)} className="rounded border p-1.5 hover:bg-muted disabled:opacity-40" aria-label="Sustituir fotografía" title="Sustituir">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" disabled={busy} onClick={() => onDelete(photo)} className="rounded border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-40" aria-label="Eliminar fotografía" title="Eliminar">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Lightbox({
  photos,
  index,
  busy,
  onIndex,
  onMoveTo,
  onClose,
}: {
  photos: PropertyPhoto[]
  index: number
  busy: boolean
  onIndex: (index: number) => void
  onMoveTo: (from: number, to: number) => void
  onClose: () => void
}) {
  const dialogRef = useModalDialog<HTMLElement>({ open: true, onClose })
  const photo = photos[index]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Fotografía ${index + 1} de ${photos.length}`}
        className="relative flex max-h-full w-full max-w-5xl flex-col items-center"
        onKeyDown={event => {
          if (event.target instanceof HTMLSelectElement) return
          if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
          if (event.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1)
        }}
      >
        <img src={fileUrl(photo.url)} alt={photo.originalName ?? `Fotografía ${index + 1}`} className="max-h-[78vh] w-auto rounded-md object-contain" />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-sm text-white">
          <button type="button" disabled={index === 0} onClick={() => onIndex(index - 1)} className="rounded border border-white/40 px-3 py-1 disabled:opacity-40">
            Anterior
          </button>
          <span>
            {index + 1} de {photos.length}
            {photo.isPrimary ? ' · Principal' : ''}
          </span>
          <button type="button" disabled={index === photos.length - 1} onClick={() => onIndex(index + 1)} className="rounded border border-white/40 px-3 py-1 disabled:opacity-40">
            Siguiente
          </button>
          <label className="inline-flex items-center gap-2">
            Mover a la posición
            <select
              value={index}
              disabled={busy}
              onChange={event => onMoveTo(index, Number(event.target.value))}
              className="rounded border border-white/40 bg-black px-2 py-1 text-white"
              aria-label="Mover a la posición"
            >
              {photos.map((_, position) => (
                <option key={position} value={position}>
                  {position + 1}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onClose} className="ml-2 rounded border border-white/40 p-1" aria-label="Cerrar">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  )
}

export function PropertyGallery({ propertyId }: { propertyId: string }) {
  const [gallery, setGallery] = useState<GalleryResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [uploads, setUploads] = useState<UploadState[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<PropertyPhoto | null>(null)
  const replacing = useRef<PropertyPhoto | null>(null)
  const addInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const backfilling = useRef(new Set<string>())
  const uploadController = useRef<AbortController | null>(null)
  const photos = gallery?.photos ?? null

  const setPhotos = (update: (current: PropertyPhoto[]) => PropertyPhoto[]) => setGallery(current => (current ? { ...current, photos: update(current.photos) } : current))

  const load = useCallback(async () => {
    try {
      setGallery(await listPhotos(propertyId))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se han podido cargar las fotografías.')
    }
  }, [propertyId])

  useEffect(() => {
    void load()
  }, [load])

  // Fotografías antiguas sin miniatura: se genera en segundo plano, de dos en dos, una vez por sesión.
  useEffect(() => {
    if (!photos || busy) return
    const missing = photos.filter(photo => !photo.thumbUrl && !backfilling.current.has(photo.id))
    if (missing.length === 0) return
    for (const photo of missing) backfilling.current.add(photo.id)
    void runPool(missing, 2, async photo => {
      try {
        const thumbnail = await makeThumbnail(await fetchPrivate(photo.url))
        if (!thumbnail) return
        const updated = await uploadThumbnail(propertyId, photo.id, thumbnail)
        setPhotos(current => current.map(item => (item.id === updated.id ? { ...item, thumbUrl: updated.thumbUrl } : item)))
      } catch {
        // Sin miniatura se sigue mostrando la original: no es un error para el usuario.
      }
    })
  }, [photos, busy, propertyId])

  const count = photos?.length ?? 0
  const free = MAX_PROPERTY_PHOTOS - count

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      setMessage({ tone: 'success', text: success })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se ha podido completar la operación.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function addFiles(files: File[]) {
    if (files.length === 0) return
    const controller = new AbortController()
    uploadController.current = controller
    const plan = planUploads(files, Math.max(0, free), MAX_PROPERTY_PHOTOS)
    setUploads(plan.states)
    setBusy(true)
    setMessage(null)
    const update = (i: number, patch: Partial<UploadState>) => setUploads(current => current.map((state, j) => (j === i ? { ...state, ...patch } : state)))
    await runPool(plan.accepted, UPLOAD_CONCURRENCY, async ({ file, index }) => {
      const invalid = validatePhotoFile(file)
      if (invalid) return update(index, { status: 'error', message: invalid })
      if (controller.signal.aborted) return update(index, { status: 'error', message: 'Cancelada.' })
      update(index, { status: 'uploading', progress: 0 })
      try {
        const prepared = await prepareForUpload(file)
        let photo = await uploadPhoto(propertyId, prepared.file, file.name, { signal: controller.signal, onProgress: fraction => update(index, { progress: fraction }) })
        if (prepared.thumbnail) photo = await uploadThumbnail(propertyId, photo.id, prepared.thumbnail).catch(() => photo)
        setPhotos(current => [...current.filter(item => item.id !== photo.id), photo].sort((a, b) => a.position - b.position))
        update(index, { status: 'done' })
      } catch (error) {
        const cancelled = error instanceof DOMException && error.name === 'AbortError'
        update(index, { status: 'error', message: cancelled ? 'Cancelada.' : error instanceof Error ? error.message : 'No se ha podido subir.' })
      }
    })
    uploadController.current = null
    setBusy(false)
    await load()
  }

  async function onReplaceFile(file: File | undefined) {
    const target = replacing.current
    replacing.current = null
    if (!file || !target) return
    const invalid = validatePhotoFile(file)
    if (invalid) {
      setMessage({ tone: 'error', text: invalid })
      return
    }
    await run(async () => {
      const prepared = await prepareForUpload(file)
      let photo = await replacePhoto(propertyId, target.id, prepared.file, file.name)
      if (prepared.thumbnail) photo = await uploadThumbnail(propertyId, photo.id, prepared.thumbnail).catch(() => photo)
      setPhotos(current => current.map(item => (item.id === photo.id ? photo : item)))
    }, 'Fotografía sustituida.')
  }

  const reorder = (ids: string[]) =>
    run(async () => {
      const { photos: ordered } = await reorderPhotos(propertyId, ids)
      setPhotos(() => ordered)
    }, 'Orden actualizado.')

  const done = uploads.filter(state => state.status === 'done').length
  const failed = uploads.filter(state => state.status === 'error').length
  const pending = uploads.length - done - failed

  return (
    <section className="mt-6 rounded-lg border bg-card p-6" aria-labelledby="gallery-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="gallery-title" className="text-xl font-semibold">
            Fotografías
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {count} de {MAX_PROPERTY_PHOTOS}
            {gallery ? ` · ${formatBytes(gallery.totalBytes)} de ${formatBytes(gallery.maxTotalBytes)}` : ''}. JPEG, PNG o WebP; las grandes se reducen a 2400 px antes de subirlas. La principal se usa como portada del cartel y del vídeo.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || photos === null || free <= 0}
          onClick={() => addInput.current?.click()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" aria-hidden="true" /> Añadir fotografías
        </button>
        <input
          ref={addInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          data-testid="gallery-add-input"
          onChange={event => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            void addFiles(files)
          }}
        />
        <input
          ref={replaceInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          data-testid="gallery-replace-input"
          onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void onReplaceFile(file)
          }}
        />
      </div>

      {free <= 0 && photos !== null && <p className="mt-3 text-sm text-muted-foreground">La galería está completa. Elimina o sustituye una fotografía para cambiarla.</p>}

      {uploads.length > 0 && (
        <div className="mt-4 text-sm" aria-live="polite">
          <p className="font-medium" data-testid="upload-summary">
            {pending > 0 ? `Subiendo: ${done} de ${uploads.length} completadas` : `Subida terminada: ${done} correctas${failed ? `, ${failed} con error` : ''}`}.
            {pending > 0 && (
              <button type="button" onClick={() => uploadController.current?.abort()} className="ml-3 rounded border px-2 py-0.5 text-xs font-medium hover:bg-muted">
                Cancelar subidas
              </button>
            )}
          </p>
          <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
            {uploads.map((state, i) => (
              <li key={`${state.name}-${i}`} className={state.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                {state.name}: {state.status === 'pending' ? 'en espera' : state.status === 'uploading' ? `subiendo… ${Math.round((state.progress ?? 0) * 100)} %` : state.status === 'done' ? 'subida' : state.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${message.tone === 'error' ? 'text-destructive' : 'text-emerald-600'}`}>
          {message.text}
        </p>
      )}

      {loadError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {loadError}
        </p>
      )}

      {photos === null && !loadError && <p className="mt-4 text-sm text-muted-foreground">Cargando fotografías…</p>}

      {photos !== null && photos.length === 0 && (
        <p className="mt-4 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Este inmueble todavía no tiene fotografías. Añade al menos una para poder generar el cartel y el vídeo de sus anuncios.
        </p>
      )}

      {photos !== null && photos.length > 0 && (
        <PhotoGrid
          photos={photos}
          busy={busy}
          onView={setViewing}
          onMove={(index, delta) => void reorder(moveId(photos.map(photo => photo.id), index, delta))}
          onPrimary={photo =>
            void run(async () => {
              const { photos: updated } = await setPrimaryPhoto(propertyId, photo.id)
              setPhotos(() => updated)
            }, 'Fotografía principal actualizada.')
          }
          onReplace={photo => {
            replacing.current = photo
            replaceInput.current?.click()
          }}
          onDelete={setDeleting}
        />
      )}

      {viewing !== null && photos && photos[viewing] && (
        <Lightbox
          photos={photos}
          index={viewing}
          busy={busy}
          onIndex={setViewing}
          onMoveTo={(from, to) => {
            void reorder(moveTo(photos.map(photo => photo.id), from, to))
            setViewing(to)
          }}
          onClose={() => setViewing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          id="gallery-delete"
          title="Eliminar fotografía"
          description="La fotografía se eliminará de la galería. El cartel y el vídeo ya generados no cambian hasta que los regeneres."
          confirmLabel="Eliminar"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const photo = deleting
            setDeleting(null)
            void run(async () => {
              await deletePhoto(propertyId, photo.id)
              await load()
            }, 'Fotografía eliminada.')
          }}
        />
      )}
    </section>
  )
}
