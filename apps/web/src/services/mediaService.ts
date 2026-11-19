import { API_URL } from '@/lib/api'
import type { MediaSourceData } from '@/lib/promoContent'
import type { AudioSource, TemplateSelectionMode } from '@estateforge/shared'

// Cliente de la galería, del material publicitario y de la biblioteca de audio. Todas las peticiones
// llevan la cookie de sesión; la API comprueba la propiedad de cada recurso.

export interface PropertyPhoto {
  id: string
  position: number
  isPrimary: boolean
  contentType: string
  size: number
  width: number
  height: number
  originalName: string | null
  createdAt: string
  url: string
  /** Miniatura (480 px); null si todavía no se ha generado. */
  thumbUrl: string | null
}

export interface GalleryResponse {
  photos: PropertyPhoto[]
  limit: number
  maxBytes: number
  maxTotalBytes: number
  totalBytes: number
}

export interface ListingMediaItem {
  photoIds?: string[]
  sourceHash?: string
  kind: 'poster' | 'video'
  contentType: string
  size: number
  width: number
  height: number
  durationMs: number | null
  variant: number
  version: number
  photoCount: number
  templateId: string | null
  templateName: string | null
  templateVersion: number | null
  selectionMode: TemplateSelectionMode | null
  codecs: string | null
  hasAudio: boolean
  audioSource: AudioSource
  audioTrackId: string | null
  audioName: string | null
  audioVolume: number | null
  audioFadeInMs: number | null
  audioFadeOutMs: number | null
  /** «classic» o «ai» (DA-72), con el proveedor y el modelo del trabajo aceptado. */
  generationMode?: 'classic' | 'ai'
  aiProvider?: string | null
  aiModel?: string | null
  createdAt: string
  updatedAt: string
  url: string
}

export interface AudioTrack {
  id: string
  name: string
  format: string
  contentType: string
  size: number
  durationMs: number
  createdAt: string
  url: string
}

export class MediaRequestError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = 'MediaRequestError'
    this.status = status
    this.code = code
  }
}

/** URL absoluta de un archivo servido por la API. */
export const fileUrl = (url: string) => `${API_URL}${url}`

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    // Sin caché: las respuestas pueden llevar URLs firmadas, que no deben guardarse.
    response = await fetch(`${API_URL}${path}`, { credentials: 'include', cache: 'no-store', ...init })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new MediaRequestError('No se ha podido conectar con el servidor.', 0, null)
  }
  if (response.status === 204) return undefined as T
  const body = (await response.json().catch(() => null)) as { message?: string; code?: string } | null
  if (!response.ok) {
    const fallback = response.status === 413 ? 'El archivo es demasiado grande.' : response.status === 429 ? 'Demasiadas operaciones seguidas. Espera un poco.' : 'No se ha podido completar la operación.'
    throw new MediaRequestError(body?.message ?? fallback, response.status, body?.code ?? null)
  }
  return body as T
}

// ------------------------------------------------------------------ Subidas directas (DA-58)
// Ningún archivo pasa por la API: se pide permiso (JSON pequeño), el navegador envía el archivo
// directamente al almacenamiento con la URL firmada y después se confirma (JSON pequeño). La API
// valida el archivo real antes de asociarlo. La URL firmada no se guarda en ningún sitio.

export type UploadKind = 'photo' | 'photo-replace' | 'thumbnail' | 'audio' | 'poster' | 'video'

export interface SignedTransfer {
  method: 'PUT'
  url: string
  headers: Record<string, string>
}

export interface PrepareRequest {
  languageDraftId?: string
  kind: UploadKind
  contentType: string
  size: number
  fileName?: string
  propertyId?: string
  photoId?: string
  generationId?: string
  rightsConfirmed?: boolean
  media?: {
    sourceHash: string
    expectedVersion: number
    variant: number
    photoIds: string[]
    durationMs?: number | null
    poster?: { templateId: string; selection: TemplateSelectionMode; drawId: string | null }
    audio?: { source: AudioSource; trackId: string | null; volume: number | null; fadeInMs: number | null; fadeOutMs: number | null }
    codecs?: string | null
  }
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

export const prepareUpload = (body: PrepareRequest, signal?: AbortSignal) => request<{ attemptId: string; expiresAt: string; upload: SignedTransfer }>('/api/uploads', { ...json(body), signal })
export const completeUpload = <T>(attemptId: string) => request<T>(`/api/uploads/${attemptId}/complete`, { method: 'POST' })
export const cancelUpload = (attemptId: string) => request<void>(`/api/uploads/${attemptId}`, { method: 'DELETE' })

/** Reintentos del envío: solo ante errores de red o del servicio (5xx), con espera creciente. */
export const TRANSFER_RETRIES = 2

/** Progreso máximo mientras el almacenamiento no ha respondido al envío. */
export const UPLOAD_PROGRESS_CAP = 0.99

/**
 * Envía el archivo a la URL firmada. XMLHttpRequest permite medir el progreso y cancelar. No envía
 * cookies: la URL firmada es la autorización.
 */
export function transferFile(upload: SignedTransfer, file: Blob, options: UploadOptions = {}): Promise<void> {
  const attempt = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (options.signal?.aborted) return reject(new DOMException('Cancelado', 'AbortError'))
      const xhr = new XMLHttpRequest()
      xhr.open(upload.method, upload.url)
      xhr.withCredentials = false
      for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value)
      xhr.upload.onprogress = event => {
        // Un evento de progreso solo dice que el navegador ha entregado los bytes a la red (Firefox lo
        // cuenta al llenar el búfer del socket): hasta la respuesta del almacenamiento no se pasa del 99 %.
        if (event.lengthComputable) options.onProgress?.(Math.min(UPLOAD_PROGRESS_CAP, event.loaded / event.total))
      }
      const onAbort = () => xhr.abort()
      options.signal?.addEventListener('abort', onAbort, { once: true })
      xhr.onload = () => {
        options.signal?.removeEventListener('abort', onAbort)
        if (xhr.status >= 200 && xhr.status < 300) {
          options.onProgress?.(1)
          return resolve()
        }
        reject(new MediaRequestError(xhr.status === 403 ? 'El permiso de subida ha caducado o no es válido.' : xhr.status === 413 ? 'El archivo supera el tamaño autorizado.' : 'El almacenamiento ha rechazado el archivo.', xhr.status, 'TRANSFER_FAILED'))
      }
      xhr.onerror = () => {
        options.signal?.removeEventListener('abort', onAbort)
        reject(new MediaRequestError('Se ha perdido la conexión al subir el archivo.', 0, 'TRANSFER_NETWORK'))
      }
      xhr.onabort = () => reject(new DOMException('Cancelado', 'AbortError'))
      xhr.send(file)
    })
  return (async () => {
    for (let retry = 0; ; retry += 1) {
      try {
        return await attempt()
      } catch (error) {
        const retryable = error instanceof MediaRequestError && (error.status === 0 || error.status >= 500)
        if (!retryable || retry >= TRANSFER_RETRIES) throw error
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** retry))
      }
    }
  })()
}

/** Prepara, envía y confirma. Si algo falla tras preparar, el intento se cancela (libera la reserva). */
export async function directUpload<T>(prepare: PrepareRequest, file: Blob, options: UploadOptions = {}): Promise<T> {
  const prepared = await prepareUpload(prepare)
  try {
    await transferFile(prepared.upload, file, options)
    return await completeUpload<T>(prepared.attemptId)
  } catch (error) {
    // Un fallo de validación ya ha cerrado el intento en la API; en otro caso se cancela aquí.
    const closed = error instanceof MediaRequestError && ['INVALID_FILE', 'TYPE_MISMATCH', 'TOO_LARGE', 'LIMIT_REACHED', 'DUPLICATE', 'QUOTA_EXCEEDED', 'SOURCE_CHANGED', 'VERSION_CONFLICT', 'UPLOAD_EXPIRED', 'UPLOAD_CLOSED'].includes(error.code ?? '')
    if (!closed) await cancelUpload(prepared.attemptId).catch(() => undefined)
    throw error
  }
}

// ------------------------------------------------------------------ Galería
export const listPhotos = (propertyId: string) => request<GalleryResponse>(`/api/properties/${propertyId}/photos`)

export const uploadPhoto = async (propertyId: string, file: Blob, name: string, options?: UploadOptions) =>
  (await directUpload<{ photo: PropertyPhoto }>({ kind: 'photo', contentType: file.type, size: file.size, fileName: name, propertyId }, file, options)).photo

export const replacePhoto = async (propertyId: string, photoId: string, file: Blob, name: string, options?: UploadOptions) =>
  (await directUpload<{ photo: PropertyPhoto }>({ kind: 'photo-replace', contentType: file.type, size: file.size, fileName: name, propertyId, photoId }, file, options)).photo

export const uploadThumbnail = async (propertyId: string, photoId: string, file: Blob) =>
  (await directUpload<{ photo: PropertyPhoto }>({ kind: 'thumbnail', contentType: 'image/jpeg', size: file.size, propertyId, photoId }, file)).photo

export const deletePhoto = (propertyId: string, photoId: string) => request<void>(`/api/properties/${propertyId}/photos/${photoId}`, { method: 'DELETE' })

export const reorderPhotos = (propertyId: string, photoIds: string[]) =>
  request<{ photos: PropertyPhoto[] }>(`/api/properties/${propertyId}/photos/order`, { method: 'PUT', body: JSON.stringify({ photoIds }), headers: { 'Content-Type': 'application/json' } })

export const setPrimaryPhoto = (propertyId: string, photoId: string) =>
  request<{ photos: PropertyPhoto[] }>(`/api/properties/${propertyId}/photos/${photoId}/primary`, { method: 'PUT' })

// ------------------------------------------------------------------ Cartel y vídeo
export const listMedia = (generationId: string) => request<{ poster: ListingMediaItem | null; video: ListingMediaItem | null }>(`/api/generations/${generationId}/media`)

export const getMediaSource = (generationId: string) => request<MediaSourceData>(`/api/generations/${generationId}/media/source`)

/** Sorteo de plantilla para «Aleatoria»: lo hace la API. */
export const drawPosterTemplate = (generationId: string) =>
  request<{ drawId: string; templateId: string; templateVersion: number }>(`/api/generations/${generationId}/media/poster/template-draw`, { method: 'POST' })

export interface SaveMediaMeta {
  sourceHash: string
  expectedVersion: number
  variant: number
  photoIds: string[]
  durationMs?: number
  poster?: { templateId: string; selection: TemplateSelectionMode; drawId?: string }
  audio?: { source: AudioSource; trackId?: string; volume?: number; fadeInMs?: number; fadeOutMs?: number }
  codecs?: string
  /** Material con IA (DA-72): trabajo listo para revisión que el usuario acepta al guardarlo. */
  aiJobId?: string
}

/** Datos del material que se envían al preparar la subida (no viaja ningún archivo). */
export function mediaPrepare(generationId: string, kind: 'poster' | 'video', file: Blob, meta: SaveMediaMeta): PrepareRequest {
  return {
    kind,
    contentType: file.type,
    size: file.size,
    generationId,
    media: {
      sourceHash: meta.sourceHash,
      expectedVersion: meta.expectedVersion,
      variant: meta.variant,
      photoIds: meta.photoIds,
      ...(meta.durationMs !== undefined && { durationMs: meta.durationMs }),
      ...(meta.poster && { poster: { templateId: meta.poster.templateId, selection: meta.poster.selection, drawId: meta.poster.drawId ?? null } }),
      ...(meta.audio && {
        audio:
          meta.audio.source === 'none'
            ? { source: 'none', trackId: null, volume: null, fadeInMs: null, fadeOutMs: null }
            : { source: meta.audio.source, trackId: meta.audio.trackId ?? null, volume: meta.audio.volume ?? 80, fadeInMs: meta.audio.fadeInMs ?? 0, fadeOutMs: meta.audio.fadeOutMs ?? 0 },
      }),
      ...(meta.codecs && { codecs: meta.codecs }),
      ...(meta.aiJobId && { aiJobId: meta.aiJobId }),
    },
  }
}

/** Cabeceras de la ruta binaria anterior (solo almacenamiento local sin transferencias directas). */
export function mediaHeaders(file: Blob, meta: SaveMediaMeta): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': file.type,
    'X-Source-Hash': meta.sourceHash,
    'X-Expected-Version': String(meta.expectedVersion),
    'X-Media-Variant': String(meta.variant),
    'X-Photo-Ids': meta.photoIds.join(','),
  }
  if (meta.durationMs !== undefined) headers['X-Media-Duration-Ms'] = String(meta.durationMs)
  if (meta.poster) {
    headers['X-Template-Id'] = meta.poster.templateId
    headers['X-Template-Selection'] = meta.poster.selection
    if (meta.poster.drawId) headers['X-Template-Draw'] = meta.poster.drawId
  }
  if (meta.audio) {
    headers['X-Audio-Source'] = meta.audio.source
    if (meta.audio.source !== 'none') {
      headers['X-Audio-Track'] = meta.audio.trackId ?? ''
      headers['X-Audio-Volume'] = String(meta.audio.volume ?? 80)
      headers['X-Audio-Fade-In-Ms'] = String(meta.audio.fadeInMs ?? 0)
      headers['X-Audio-Fade-Out-Ms'] = String(meta.audio.fadeOutMs ?? 0)
    }
  }
  if (meta.codecs) headers['X-Media-Codecs'] = meta.codecs
  return headers
}

export async function saveMedia(generationId: string, kind: 'poster' | 'video', file: Blob, meta: SaveMediaMeta, options?: UploadOptions) {
  return (await directUpload<{ media: ListingMediaItem }>(mediaPrepare(generationId, kind, file, meta), file, options)).media
}

// ------------------------------------------------------------------ Biblioteca de audio
export const listAudioTracks = () => request<{ tracks: AudioTrack[]; limits: { maxTracks: number; maxBytes: number; maxDurationMs: number } }>('/api/audio-tracks')

/** Sube una pista. rightsConfirmed: el usuario declara que tiene derecho a usarla en sus vídeos. */
export const uploadAudioTrack = async (file: Blob, name: string, contentType: string, rightsConfirmed: boolean, options?: UploadOptions) =>
  (await directUpload<{ track: AudioTrack }>({ kind: 'audio', contentType, size: file.size, fileName: name, rightsConfirmed }, file, options)).track

export const deleteAudioTrack = (trackId: string) => request<void>(`/api/audio-tracks/${trackId}`, { method: 'DELETE' })

/** Añade ?as=url (o &as=url) a la URL de un archivo de la API. */
export const accessUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}as=url`

/**
 * Bytes de un archivo privado. Se pide a la API una URL firmada de lectura (con la sesión) y se
 * descarga directamente del almacenamiento, sin cookies: los bytes no pasan por la API (DA-58).
 */
export async function fetchPrivate(url: string, signal?: AbortSignal): Promise<Blob> {
  const { url: signed } = await request<{ url: string; expiresAt: string }>(accessUrl(url), { signal })
  const response = await fetch(signed, { credentials: 'omit', signal })
  if (!response.ok) throw new MediaRequestError('No se ha podido descargar un archivo necesario.', response.status, null)
  return response.blob()
}

const DOWNLOAD_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/webm': 'webm', 'video/mp4': 'mp4' }

/** Nombre del archivo descargado: el mismo que propone la API (estateforge-cartel-<anuncio>.jpg). */
export function mediaDownloadName(item: Pick<ListingMediaItem, 'kind' | 'contentType' | 'url'>): string {
  const generationId = /\/api\/generations\/([^/]+)\//.exec(item.url)?.[1] ?? 'anuncio'
  return `estateforge-${item.kind === 'poster' ? 'cartel' : 'video'}-${generationId}.${DOWNLOAD_EXTENSIONS[item.contentType] ?? 'bin'}`
}

/**
 * Descarga con nombre propio sin depender del almacenamiento: los bytes llegan por la URL firmada y el
 * navegador guarda el Blob local con el atributo download. Vercel Blob no documenta Content-Disposition
 * en las URLs prefirmadas de lectura, y un enlace a otro origen ignora el atributo download.
 */
export async function downloadPrivate(url: string, name: string): Promise<void> {
  const blob = await fetchPrivate(url)
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}

/**
 * Descarga una fotografía con la sesión y la decodifica directamente al tamaño indicado (si se indica),
 * sin contaminar el lienzo. Con 50 fotografías, decodificarlas a tamaño completo ocuparía cientos de megas.
 */
export async function loadBitmap(url: string, size?: { width: number; height: number }, signal?: AbortSignal): Promise<ImageBitmap> {
  const blob = await fetchPrivate(url, signal)
  if (!size) return createImageBitmap(blob)
  return createImageBitmap(blob, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' })
}
