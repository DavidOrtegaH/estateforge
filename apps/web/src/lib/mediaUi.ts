import { VIDEO_MAX_PHOTOS } from '@estateforge/shared'

import { fileKey } from '@/lib/imagePrep'
import { VideoRenderError } from '@/lib/videoRenderer'
import { MediaRequestError } from '@/services/mediaService'

// Lógica de presentación de la galería y del material del anuncio, separada de los componentes.

export type UploadState = { name: string; status: 'pending' | 'uploading' | 'done' | 'error'; message?: string; progress?: number }

/** Intercambia una fotografía con su vecina; si ya está en el extremo, devuelve el mismo orden. */
export function moveId(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** Lleva una fotografía a otra posición desplazando las demás (útil con 50 fotografías). */
export function moveTo(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Reparte una selección de archivos: los repetidos en la misma selección y los que exceden el hueco
 * libre se marcan con su motivo; el resto se sube. Cada archivo conserva su línea de estado.
 */
export function planUploads<T extends { name: string; size: number; lastModified?: number }>(files: T[], free: number, max: number) {
  const seen = new Set<string>()
  const states: UploadState[] = []
  const accepted: { file: T; index: number }[] = []
  for (const [index, file] of files.entries()) {
    const key = fileKey(file)
    if (seen.has(key)) {
      states.push({ name: file.name, status: 'error', message: 'Está repetido en la selección.' })
      continue
    }
    seen.add(key)
    if (accepted.length >= free) {
      states.push({ name: file.name, status: 'error', message: `Supera el límite de ${max} fotografías.` })
      continue
    }
    states.push({ name: file.name, status: 'pending' })
    accepted.push({ file, index })
  }
  return { states, accepted }
}

export function formatBytes(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`
}

export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`
}

/**
 * Fotografías del vídeo por defecto: todas en el orden de la galería (la principal primero) hasta el
 * máximo que admite un vídeo.
 */
export function defaultVideoSelection<T extends { id: string }>(ordered: T[]): string[] {
  return ordered.slice(0, VIDEO_MAX_PHOTOS).map(photo => photo.id)
}

/** Mensaje claro para cada fallo de generación; needsPhotos enlaza a la ficha del inmueble. */
export function describeMediaError(error: unknown): { text: string; needsPhotos: boolean } {
  if (error instanceof MediaRequestError) {
    if (error.code === 'NO_PHOTOS') return { text: 'El inmueble no tiene fotografías. Añade al menos una en su ficha.', needsPhotos: true }
    if (error.code === 'SOURCE_CHANGED') return { text: 'Los datos o las fotografías han cambiado mientras se generaba. Vuelve a intentarlo para usar la versión actual.', needsPhotos: false }
    if (error.code === 'VERSION_CONFLICT') return { text: 'Se ha guardado otra versión al mismo tiempo (quizá en otra pestaña). Se muestra la más reciente.', needsPhotos: false }
    if (error.code === 'QUOTA_EXCEEDED') return { text: `${error.message} Se conserva la versión anterior.`, needsPhotos: false }
    return { text: error.message, needsPhotos: false }
  }
  if (error instanceof DOMException && error.name === 'AbortError') return { text: 'Generación cancelada. Se conserva la versión anterior.', needsPhotos: false }
  if (error instanceof VideoRenderError) return { text: `${error.message} Se conserva la versión anterior.`, needsPhotos: false }
  return { text: error instanceof Error ? error.message : 'No se ha podido generar.', needsPhotos: false }
}

/**
 * Selección de fotografías del vídeo (DA-53) a partir de la elegida por el usuario: la principal
 * siempre primero; las demás en el orden elegido. Si alguna ya no existe en la galería, se indica
 * (missing) para no generar el vídeo con una selección distinta de la que el usuario ve.
 */
export function resolveVideoSelection<T extends { id: string; isPrimary: boolean }>(selected: string[], photos: T[]): { photos: T[]; missing: boolean } {
  const byId = new Map(photos.map(photo => [photo.id, photo]))
  const primary = photos.find(photo => photo.isPrimary) ?? photos[0]
  const missing = selected.some(id => !byId.has(id))
  const rest = selected.filter(id => byId.has(id) && id !== primary?.id).map(id => byId.get(id)!)
  return { photos: primary ? [primary, ...rest].slice(0, VIDEO_MAX_PHOTOS) : [], missing }
}

/** Mueve una fotografía de la selección; la principal (posición 0) no se mueve ni se desplaza. */
export function moveInSelection(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta
  if (index <= 0 || target <= 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
