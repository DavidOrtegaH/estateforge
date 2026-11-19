import type { FastifyBaseLogger } from 'fastify'

import {
  AUDIO_MAX_BYTES,
  MAX_AUDIO_TRACKS_PER_USER,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  POSTER_MAX_BYTES,
  POSTER_TYPES,
  THUMBNAIL_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VIDEO_TYPES,
  audioFormatOfType,
  audioTypeOf,
  type AudioSource,
  type MediaKind,
  type TemplateSelectionMode,
} from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import { audioKey, getStorage, mediaKey, photoKey, thumbKey, type SignedTransfer } from '../storage/object-storage.js'
import { addTrack, type AudioTrackRow } from './audio.service.js'
import { precheckMedia, saveMedia, type MediaRow } from './listing-media.service.js'
import { assertDraftSnapshot, readLanguageDraft } from './language-draft.js'
import { MediaError, notFound } from './media-errors.js'
import { addPhoto, assertPropertyCapacity, replacePhoto, setPhotoThumbnail, type PhotoRow } from './photo.service.js'
import { assertUserQuota, lockUser } from './quota.js'
import { drainStorageCleanup } from './storage-cleanup.js'

// Subidas directas al almacenamiento (DA-58). Los bytes nunca pasan por la API:
// 1. Preparar: la API autentica, comprueba la propiedad, los límites y la cuota (contando lo que ya
//    está reservado), elige una clave nueva e impredecible, registra el intento con una caducidad y
//    firma una URL de PUT solo para esa clave, ese tipo y ese tamaño.
// 2. El navegador sube el archivo a esa URL (Vercel Blob o el simulador local).
// 3. Confirmar: la API toma el intento, lee el objeto real del almacenamiento (como mucho el tamaño
//    declarado más un byte), lo valida con las mismas reglas que una subida normal y crea o actualiza
//    el recurso en una transacción que también completa el intento. Repetir la confirmación devuelve
//    el mismo resultado. Si falla la validación, el intento queda «failed» y su archivo se borra.
// Los intentos no confirmados caducan: dejan de reservar cuota y su archivo pasa a la cola de limpieza.

export const UPLOAD_KINDS = ['photo', 'photo-replace', 'thumbnail', 'audio', 'poster', 'video'] as const
export type UploadKind = (typeof UPLOAD_KINDS)[number]

/** Validez de la URL de subida y del intento. */
export const UPLOAD_TTL_MS = 15 * 60 * 1000
/**
 * Margen antes de caducar un intento que ya se está confirmando («processing»). La confirmación
 * reclama el intento solo si está vigente, pero leer y validar el archivo lleva tiempo: sin margen, la
 * caducidad lanzada por otra petición del usuario (o el mantenimiento) borraba el archivo a mitad de
 * la validación. Supera la duración máxima de una función de Vercel Hobby (300 s), así que solo
 * caducan por aquí las confirmaciones que quedaron colgadas.
 */
export const UPLOAD_PROCESSING_GRACE_MS = 10 * 60 * 1000
/** Intentos pendientes a la vez por usuario (evita reservar cuota sin límite). */
export const MAX_PENDING_UPLOADS = 60

export interface MediaUploadMeta {
  sourceHash: string
  expectedVersion: number
  variant: number
  photoIds: string[]
  durationMs?: number | null
  poster?: { templateId: string; selection: TemplateSelectionMode; drawId: string | null }
  audio?: { source: AudioSource; trackId: string | null; volume: number | null; fadeInMs: number | null; fadeOutMs: number | null }
  codecs?: string | null
  aiJobId?: string
}

export interface PrepareInput {
  languageDraftId?: string
  kind: UploadKind
  contentType: string
  size: number
  fileName?: string | null
  propertyId?: string | null
  photoId?: string | null
  generationId?: string | null
  rightsConfirmed?: boolean
  media?: MediaUploadMeta
}

export interface PreparedUpload {
  attemptId: string
  expiresAt: Date
  upload: SignedTransfer
}

export type CompletedUpload =
  | { kind: 'photo' | 'photo-replace' | 'thumbnail'; propertyId: string; photo: PhotoRow }
  | { kind: 'audio'; track: AudioTrackRow }
  | { kind: 'poster' | 'video'; generationId: string; media: MediaRow }

function limitsFor(kind: UploadKind): { types: readonly string[]; max: number } {
  switch (kind) {
    case 'photo':
    case 'photo-replace':
      return { types: PHOTO_TYPES, max: PHOTO_MAX_BYTES }
    case 'thumbnail':
      return { types: ['image/jpeg'], max: THUMBNAIL_MAX_BYTES }
    case 'audio':
      return { types: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'], max: AUDIO_MAX_BYTES }
    case 'poster':
      return { types: POSTER_TYPES, max: POSTER_MAX_BYTES }
    case 'video':
      return { types: VIDEO_TYPES, max: VIDEO_MAX_BYTES }
  }
}

/** Tipo canónico (los alias de audio se normalizan) o error si el tipo no está permitido para el recurso. */
function canonicalType(kind: UploadKind, declared: string): string {
  const clean = declared.split(';')[0].trim().toLowerCase()
  const type = kind === 'audio' ? (audioFormatOfType(clean) ? audioTypeOf(audioFormatOfType(clean)!) : clean) : clean
  if (!limitsFor(kind).types.includes(type)) throw new MediaError('TYPE_MISMATCH', 'Tipo de archivo no admitido para este recurso.')
  return type
}

async function assertProperty(userId: string, propertyId: string, photoId?: string | null) {
  const property = await prisma.property.count({ where: { id: propertyId, userId } })
  if (property !== 1) throw notFound('El inmueble')
  if (photoId) {
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { id: true } })
    if (!photo) throw notFound('La fotografía')
  }
}

/** Caduca los intentos vencidos (todos, o los de un usuario): dejan de reservar y su archivo se limpia. */
export async function expireUploads(log: FastifyBaseLogger | null, userId?: string): Promise<number> {
  const staleWhere = () => {
    const now = Date.now()
    return {
      OR: [
        { status: 'pending', expiresAt: { lte: new Date(now) } },
        { status: 'processing', expiresAt: { lte: new Date(now - UPLOAD_PROCESSING_GRACE_MS) } },
      ],
    }
  }
  const stale = await prisma.uploadAttempt.findMany({
    where: { ...(userId && { userId }), ...staleWhere() },
    select: { id: true, storageKey: true },
    take: 200,
  })
  if (stale.length === 0) return 0
  // La condición se repite en el UPDATE: una confirmación que acaba de completar el intento no se toca.
  const result = await prisma.uploadAttempt.updateMany({ where: { id: { in: stale.map(item => item.id) }, ...staleWhere() }, data: { status: 'expired' } })
  await drainStorageCleanup(log, stale.map(item => item.storageKey))
  return result.count
}

export async function prepareUpload(log: FastifyBaseLogger | null, userId: string, input: PrepareInput): Promise<PreparedUpload> {
  if (!(UPLOAD_KINDS as readonly string[]).includes(input.kind)) throw new MediaError('INVALID_REQUEST', 'Tipo de subida no válido.')
  const contentType = canonicalType(input.kind, input.contentType)
  const { max } = limitsFor(input.kind)
  if (!Number.isInteger(input.size) || input.size <= 0) throw new MediaError('INVALID_REQUEST', 'Tamaño de archivo no válido.')
  if (input.size > max) throw new MediaError('TOO_LARGE', `El archivo supera el tamaño máximo de ${Math.round(max / 1024 / 1024) || 1} MB.`)

  if (input.languageDraftId && input.kind !== 'poster' && input.kind !== 'video') throw new MediaError('INVALID_REQUEST', 'La preparación de idioma solo admite cartel y vídeo.')

  // Destino del recurso: solo identificadores, comprobados contra el propietario.
  let propertyId: string | null = null
  let photoId: string | null = null
  let generationId: string | null = null
  let metadata: Record<string, unknown> = {}
  if (input.kind === 'photo' || input.kind === 'photo-replace' || input.kind === 'thumbnail') {
    if (!input.propertyId || (input.kind !== 'photo' && !input.photoId)) throw new MediaError('INVALID_REQUEST', 'Falta el inmueble o la fotografía.')
    propertyId = input.propertyId
    photoId = input.kind === 'photo' ? null : input.photoId!
    await assertProperty(userId, propertyId, photoId)
    metadata = { originalName: input.fileName ?? null }
  } else if (input.kind === 'audio') {
    if (!input.rightsConfirmed) throw new MediaError('INVALID_REQUEST', 'Confirma que tienes derecho a usar esta pista en tus vídeos.')
    metadata = { originalName: input.fileName ?? null, rightsConfirmed: true }
  } else {
    if (!input.generationId || !input.media) throw new MediaError('INVALID_REQUEST', 'Faltan el anuncio o los datos del material.')
    generationId = input.generationId
    const media = input.media
    const draft = input.languageDraftId ? await readLanguageDraft(userId, generationId, input.languageDraftId) : null
    if (draft) {
      if (draft.status !== 'pending' || draft.data.mediaVersions[input.kind] === undefined || draft.data.mediaVersions[input.kind] !== media.expectedVersion || media.aiJobId) throw new MediaError('INVALID_REQUEST', 'El material no corresponde a esta preparación.')
      await assertDraftSnapshot(userId, generationId, draft.data)
    }
    await precheckMedia(userId, generationId, {
      kind: input.kind as MediaKind,
      declaredType: contentType,
      sourceHash: media.sourceHash,
      expectedVersion: media.expectedVersion,
      variant: media.variant,
      durationMs: media.durationMs ?? null,
      photoIds: media.photoIds,
      ...(media.poster && { poster: media.poster }),
      ...(media.audio && { audio: media.audio }),
      codecs: media.codecs ?? null,
      ...(media.aiJobId && { ai: { jobId: media.aiJobId } }),
    }, draft?.data.source)
    metadata = { ...media }
  }

  await expireUploads(log, userId)
  const key =
    input.kind === 'photo' || input.kind === 'photo-replace'
      ? photoKey(userId, propertyId!, contentType)
      : input.kind === 'thumbnail'
        ? thumbKey(userId, propertyId!)
        : input.kind === 'audio'
          ? audioKey(userId, contentType)
          : mediaKey(userId, generationId!, input.kind, contentType)
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS)

  const attempt = await prisma.$transaction(async tx => {
    // Mismo orden de bloqueos que el resto de escrituras: usuario y, si hay, inmueble.
    await lockUser(tx, userId)
    if (input.languageDraftId) {
      const draft = await readLanguageDraft(userId, generationId!, input.languageDraftId, tx)
      if (draft.status !== 'pending') throw new MediaError('UPLOAD_CLOSED', 'La preparación ya ha terminado.')
      await assertDraftSnapshot(userId, generationId!, draft.data, tx)
    }
    if (propertyId) {
      const locked = await tx.$executeRaw`UPDATE "Property" SET "userId" = "userId" WHERE "id" = ${propertyId} AND "userId" = ${userId}`
      if (locked !== 1) throw notFound('El inmueble')
    }
    const pending = await tx.uploadAttempt.count({ where: { userId, status: { in: ['pending', 'processing'] }, expiresAt: { gt: new Date() } } })
    if (pending >= MAX_PENDING_UPLOADS) throw new MediaError('LIMIT_REACHED', 'Hay demasiadas subidas pendientes. Espera a que terminen.')
    if (input.kind === 'photo') await assertPropertyCapacity(tx, propertyId!, { size: input.size, adds: true })
    if (input.kind === 'audio') {
      const tracks = await tx.audioTrack.count({ where: { userId } })
      const reserved = await tx.uploadAttempt.count({ where: { userId, kind: 'audio', status: { in: ['pending', 'processing'] }, expiresAt: { gt: new Date() } } })
      if (tracks + reserved >= MAX_AUDIO_TRACKS_PER_USER) throw new MediaError('LIMIT_REACHED', `Tu biblioteca ya tiene ${MAX_AUDIO_TRACKS_PER_USER} pistas. Elimina alguna para subir otra.`)
    }
    await assertUserQuota(tx, userId, input.size)
    return tx.uploadAttempt.create({
      data: { userId, kind: input.kind, storageKey: key, contentType, size: input.size, propertyId, photoId, generationId, metadata: JSON.stringify(metadata), expiresAt, languageDraftId: input.languageDraftId ?? null },
      select: { id: true },
    })
  })

  try {
    const upload = await (await getStorage()).presignPut(key, { contentType, maxBytes: input.size, expiresAt })
    return { attemptId: attempt.id, expiresAt, upload }
  } catch (error) {
    // Sin URL no hay subida posible: el intento se cancela y libera su reserva.
    await prisma.uploadAttempt.updateMany({ where: { id: attempt.id, status: 'pending' }, data: { status: 'cancelled' } }).catch(() => {})
    throw error
  }
}

export async function readExactly(key: string, size: number): Promise<Buffer | null> {
  const object = await (await getStorage()).get(key)
  if (!object) return null
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of object.stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += buffer.length
    if (total > size) {
      ;(object.stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.()
      throw new MediaError('INVALID_FILE', 'El archivo subido no coincide con el tamaño declarado.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function resultOf(attempt: { kind: string; userId: string; resultId: string | null; propertyId: string | null; generationId: string | null }): Promise<CompletedUpload> {
  const { listPhotos } = await import('./photo.service.js')
  if (attempt.kind === 'photo' || attempt.kind === 'photo-replace' || attempt.kind === 'thumbnail') {
    const photo = (await listPhotos(attempt.propertyId!, attempt.userId)).find(item => item.id === attempt.resultId)
    if (!photo) throw notFound('La fotografía')
    return { kind: attempt.kind, propertyId: attempt.propertyId!, photo }
  }
  if (attempt.kind === 'audio') {
    const { listTracks } = await import('./audio.service.js')
    const track = (await listTracks(attempt.userId)).find(item => item.id === attempt.resultId)
    if (!track) throw notFound('La pista')
    return { kind: 'audio', track }
  }
  const { listMedia } = await import('./listing-media.service.js')
  const media = (await listMedia(attempt.generationId!, attempt.userId)).find(item => item.kind === attempt.kind)
  if (!media) throw notFound('El material')
  return { kind: attempt.kind as 'poster' | 'video', generationId: attempt.generationId!, media }
}

/** Confirma una subida directa. Idempotente: si ya se confirmó, devuelve el mismo recurso. */
export async function completeUpload(log: FastifyBaseLogger | null, userId: string, attemptId: string): Promise<CompletedUpload> {
  const claimed = await prisma.uploadAttempt.updateMany({ where: { id: attemptId, userId, languageDraftId: null, status: 'pending', expiresAt: { gt: new Date() } }, data: { status: 'processing' } })
  const attempt = await prisma.uploadAttempt.findFirst({ where: { id: attemptId, userId } })
  if (!attempt) throw notFound('La subida')
  if (attempt.languageDraftId) throw new MediaError('INVALID_REQUEST', 'Esta subida solo se confirma con el cambio completo de idioma.')
  if (claimed.count !== 1) {
    if (attempt.status === 'completed') return resultOf(attempt)
    if (attempt.status === 'processing') throw new MediaError('VERSION_CONFLICT', 'La subida ya se está confirmando.')
    if (attempt.status === 'pending' || attempt.status === 'expired') {
      await expireUploads(log, userId)
      throw new MediaError('UPLOAD_EXPIRED', 'La subida ha caducado. Vuelve a intentarlo.')
    }
    throw new MediaError('UPLOAD_CLOSED', 'Esta subida se canceló o falló. Vuelve a intentarlo.')
  }

  const direct = { key: attempt.storageKey, attemptId: attempt.id }
  let body: Buffer | null
  try {
    body = await readExactly(attempt.storageKey, attempt.size)
  } catch (error) {
    if (error instanceof MediaError) return fail(log, attempt, error)
    await prisma.uploadAttempt.updateMany({ where: { id: attempt.id, status: 'processing' }, data: { status: 'pending' } })
    throw error
  }
  if (!body) {
    // Todavía no se ha subido (o la subida no terminó): puede reintentarse mientras no caduque.
    await prisma.uploadAttempt.updateMany({ where: { id: attempt.id, status: 'processing' }, data: { status: 'pending' } })
    throw new MediaError('UPLOAD_MISSING', 'El archivo no ha llegado al almacenamiento. Vuelve a subirlo.')
  }
  if (body.length !== attempt.size) return fail(log, attempt, new MediaError('INVALID_FILE', 'El archivo subido no coincide con el tamaño declarado.'))

  const metadata = JSON.parse(attempt.metadata) as Record<string, unknown> & Partial<MediaUploadMeta>
  try {
    switch (attempt.kind) {
      case 'photo':
        return { kind: 'photo', propertyId: attempt.propertyId!, photo: await addPhoto(log, userId, attempt.propertyId!, { body, declaredType: attempt.contentType, originalName: metadata.originalName }, direct) }
      case 'photo-replace':
        return { kind: 'photo-replace', propertyId: attempt.propertyId!, photo: await replacePhoto(log, userId, attempt.propertyId!, attempt.photoId!, { body, declaredType: attempt.contentType, originalName: metadata.originalName }, direct) }
      case 'thumbnail':
        return { kind: 'thumbnail', propertyId: attempt.propertyId!, photo: await setPhotoThumbnail(log, userId, attempt.propertyId!, attempt.photoId!, { body, declaredType: attempt.contentType }, direct) }
      case 'audio':
        return { kind: 'audio', track: await addTrack(log, userId, { body, declaredType: attempt.contentType, originalName: metadata.originalName, rightsConfirmed: metadata.rightsConfirmed === true }, direct) }
      default: {
        const media = await saveMedia(
          log,
          userId,
          attempt.generationId!,
          {
            kind: attempt.kind as MediaKind,
            body,
            declaredType: attempt.contentType,
            sourceHash: metadata.sourceHash!,
            expectedVersion: metadata.expectedVersion!,
            variant: metadata.variant!,
            durationMs: metadata.durationMs ?? null,
            photoIds: metadata.photoIds!,
            ...(metadata.poster && { poster: metadata.poster }),
            ...(metadata.audio && { audio: metadata.audio }),
            codecs: metadata.codecs ?? null,
            ...(typeof metadata.aiJobId === 'string' && { ai: { jobId: metadata.aiJobId } }),
          },
          direct,
        )
        return { kind: attempt.kind as 'poster' | 'video', generationId: attempt.generationId!, media }
      }
    }
  } catch (error) {
    if (error instanceof MediaError) return fail(log, attempt, error)
    // Error inesperado (por ejemplo, base de datos no disponible): se puede reintentar la confirmación.
    await prisma.uploadAttempt.updateMany({ where: { id: attempt.id, status: 'processing' }, data: { status: 'pending' } }).catch(() => {})
    throw error
  }
}

async function fail(log: FastifyBaseLogger | null, attempt: { id: string; storageKey: string }, error: MediaError): Promise<never> {
  await prisma.uploadAttempt.updateMany({ where: { id: attempt.id, status: 'processing' }, data: { status: 'failed', failure: error.code } })
  await drainStorageCleanup(log, [attempt.storageKey])
  throw error
}

/** Cancela una subida pendiente: deja de reservar y su archivo, si llegó a subirse, se borra. */
export async function cancelUpload(log: FastifyBaseLogger | null, userId: string, attemptId: string): Promise<void> {
  const attempt = await prisma.uploadAttempt.findFirst({ where: { id: attemptId, userId }, select: { status: true, storageKey: true } })
  if (!attempt) throw notFound('La subida')
  if (attempt.status !== 'pending') return
  await prisma.uploadAttempt.updateMany({ where: { id: attemptId, status: 'pending' }, data: { status: 'cancelled' } })
  await drainStorageCleanup(log, [attempt.storageKey])
}

/** Fecha de expiración de las URLs de lectura según el recurso (DA-58). */
export function readExpiry(kind: 'photo' | 'thumb' | 'poster' | 'video' | 'audio', now = Date.now()): Date {
  // Ventanas alineadas: dentro de la misma ventana la URL es idéntica y el navegador puede reutilizar
  // su copia; al cambiar de ventana se emite otra. El margen mínimo garantiza tiempo para usarla.
  // Tramos de 5 min para todos: imágenes 10-15 min, audio 30-35 min y vídeo 60-65 min.
  const window = 5 * 60_000
  const margin = kind === 'video' ? 60 * 60_000 : kind === 'audio' ? 30 * 60_000 : 10 * 60_000
  return new Date(Math.ceil((now + margin) / window) * window)
}
