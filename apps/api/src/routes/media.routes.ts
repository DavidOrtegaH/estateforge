import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import {
  AI_POSTER_TEMPLATE_ID,
  AUDIO_DECLARED_TYPES,
  AUDIO_MAX_BYTES,
  AUDIO_MAX_DURATION_MS,
  AUDIO_SOURCES,
  MAX_AUDIO_TRACKS_PER_USER,
  MAX_PROPERTY_PHOTOS,
  MEDIA_KINDS,
  PHOTO_MAX_BYTES,
  POSTER_MAX_BYTES,
  PROPERTY_PHOTOS_MAX_TOTAL_BYTES,
  TEMPLATE_SELECTION_MODES,
  THUMBNAIL_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_PHOTOS,
  findPosterTemplate,
  type MediaKind,
} from '@estateforge/shared'

import { requireAuth } from '../middleware/auth.middleware.js'
import { addTrack, listTracks, locateTrack, readTrack, removeTrack, type AudioTrackRow } from '../media/audio.service.js'
import { MediaError } from '../media/media-errors.js'
import { addPhoto, listPhotos, locatePhoto, readPhoto, removePhoto, reorderPhotos, replacePhoto, setPhotoThumbnail, setPrimaryPhoto, type PhotoRow } from '../media/photo.service.js'
import { drawPosterTemplate, getMediaSource, listMedia, locateMedia, readMedia, saveMedia, type MediaRow } from '../media/listing-media.service.js'
import { cancelUpload, completeUpload, prepareUpload, readExpiry, UPLOAD_KINDS, type CompletedUpload } from '../media/upload.service.js'
import { LocalStorage } from '../storage/local-storage.js'
import { LOCAL_BLOB_PREFIX } from '../storage/local-signer.js'
import { getStorage, StorageConfigError } from '../storage/object-storage.js'

// Galería de fotografías de un inmueble, material publicitario de un anuncio y biblioteca de audio
// personal (DA-46, DA-47, DA-51 a DA-55). Todas las rutas exigen sesión y comprueban la propiedad en el
// servicio (404 si el recurso no es del usuario). Los cuerpos binarios solo se aceptan en estas rutas:
// el parser y los límites de tamaño viven en este plugin encapsulado y no afectan al resto de la API.

const ID = z.string().regex(/^[a-z0-9]{20,40}$/, 'Identificador no válido.')
const PropertyParams = z.object({ id: ID }).strict()
const PhotoParams = z.object({ id: ID, photoId: ID }).strict()
const MediaParams = z.object({ id: ID, kind: z.enum(MEDIA_KINDS) }).strict()
const TrackParams = z.object({ id: ID }).strict()
const OrderBody = z.object({ photoIds: z.array(ID).min(1).max(MAX_PROPERTY_PHOTOS) }).strict()
const optionalInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional()
const MediaHeaders = z.object({
  'x-source-hash': z.string().regex(/^[0-9a-f]{64}$/),
  'x-expected-version': z.coerce.number().int().min(0),
  'x-media-variant': z.coerce.number().int().min(0).max(1_000_000),
  'x-photo-ids': z.string().max(MAX_PROPERTY_PHOTOS * 41).transform(value => value.split(',').filter(Boolean)).pipe(z.array(ID).min(1).max(MAX_PROPERTY_PHOTOS)),
  'x-media-duration-ms': z.coerce.number().int().optional(),
  'x-template-id': z.string().max(40).optional(),
  'x-template-selection': z.enum(TEMPLATE_SELECTION_MODES).optional(),
  'x-template-draw': ID.optional(),
  'x-audio-source': z.enum(AUDIO_SOURCES).optional(),
  'x-audio-track': z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
  'x-audio-volume': optionalInt(0, 100),
  'x-audio-fade-in-ms': optionalInt(0, 5000),
  'x-audio-fade-out-ms': optionalInt(0, 5000),
  'x-media-codecs': z.string().max(80).optional(),
})

const PrepareBody = z
  .object({
    kind: z.enum(UPLOAD_KINDS),
    contentType: z.string().min(3).max(100),
    size: z.number().int().positive().max(64 * 1024 * 1024),
    fileName: z.string().max(255).optional(),
    propertyId: ID.optional(),
    photoId: ID.optional(),
    generationId: ID.optional(),
    rightsConfirmed: z.boolean().optional(),
    media: z
      .object({
        sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
        expectedVersion: z.number().int().min(0),
        variant: z.number().int().min(0).max(1_000_000),
        photoIds: z.array(ID).min(1).max(MAX_PROPERTY_PHOTOS),
        durationMs: z.number().int().nullable().optional(),
        poster: z.object({ templateId: z.string().max(40), selection: z.enum(TEMPLATE_SELECTION_MODES), drawId: ID.nullable() }).strict().optional(),
        audio: z
          .object({
            source: z.enum(AUDIO_SOURCES),
            trackId: z.string().regex(/^[a-z0-9-]{3,40}$/).nullable(),
            volume: z.number().int().min(0).max(100).nullable(),
            fadeInMs: z.number().int().min(0).max(5000).nullable(),
            fadeOutMs: z.number().int().min(0).max(5000).nullable(),
          })
          .strict()
          .optional(),
        codecs: z.string().max(80).nullable().optional(),
        // Material con IA (DA-72): trabajo listo para revisión que el usuario acepta al guardar.
        aiJobId: ID.optional(),
      })
      .strict()
      .optional(),
  })
  // strict: no se admite ninguna ruta ni clave de almacenamiento enviada por el navegador.
  .strict()
const UploadParams = z.object({ id: ID }).strict()
const AccessQuery = z.object({ as: z.literal('url').optional(), download: z.literal('1').optional(), size: z.literal('thumb').optional(), v: z.string().max(64).optional() }).passthrough()

const PHOTO_WRITE_LIMIT = { rateLimit: { max: 300, timeWindow: '15 minutes' } }
const UPLOAD_LIMIT = { rateLimit: { max: 400, timeWindow: '15 minutes' } }
const MEDIA_WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 hour' } }
const DRAW_LIMIT = { rateLimit: { max: 60, timeWindow: '1 hour' } }
const AUDIO_WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 hour' } }

const BINARY_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/webm', 'video/mp4', ...AUDIO_DECLARED_TYPES.filter(type => type !== 'video/mp4')]

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof MediaError) return reply.code(error.status).send({ code: error.code, message: error.message })
  if (error instanceof StorageConfigError) {
    reply.log.error({ errorName: error.name }, 'Almacenamiento no configurado')
    return reply.code(503).send({ code: 'STORAGE_UNAVAILABLE', message: 'El almacenamiento de archivos no está disponible.' })
  }
  throw error
}

function badRequest(reply: FastifyReply, message = 'Datos de entrada no válidos') {
  return reply.code(400).send({ code: 'INVALID_REQUEST', message })
}

function userOf(request: FastifyRequest): string {
  if (!request.userId) throw new Error('requireAuth no ha fijado el usuario')
  return request.userId
}

export function photoDto(propertyId: string, photo: PhotoRow) {
  // El hash parcial cambia al sustituir la imagen: la URL es nueva y la caché nunca sirve la anterior.
  const url = `/api/properties/${propertyId}/photos/${photo.id}/file?v=${photo.sha256.slice(0, 12)}`
  return {
    id: photo.id,
    position: photo.position,
    isPrimary: photo.isPrimary,
    contentType: photo.contentType,
    size: photo.size,
    width: photo.width,
    height: photo.height,
    originalName: photo.originalName,
    createdAt: photo.createdAt,
    updatedAt: photo.updatedAt,
    url,
    thumbUrl: photo.thumbSize === null ? null : `${url}-${photo.thumbSize}&size=thumb`,
  }
}

export function mediaDto(generationId: string, media: MediaRow) {
  return {
    kind: media.kind,
    contentType: media.contentType,
    size: media.size,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
    variant: media.variant,
    version: media.version,
    photoCount: (JSON.parse(media.photoIds) as unknown[]).length,
    photoIds: JSON.parse(media.photoIds) as string[],
    sourceHash: media.sourceHash,
    templateId: media.templateId,
    templateName: media.templateId === AI_POSTER_TEMPLATE_ID ? 'Generación con IA' : media.templateId ? (findPosterTemplate(media.templateId)?.name ?? media.templateId) : null,
    generationMode: media.generationMode,
    aiProvider: media.aiProvider,
    aiModel: media.aiModel,
    templateVersion: media.templateVersion,
    selectionMode: media.selectionMode,
    codecs: media.codecs,
    hasAudio: media.hasAudio,
    audioSource: media.audioSource,
    audioTrackId: media.audioTrackId,
    audioName: media.audioName,
    audioVolume: media.audioVolume,
    audioFadeInMs: media.audioFadeInMs,
    audioFadeOutMs: media.audioFadeOutMs,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    url: `/api/generations/${generationId}/media/${media.kind}/file?v=${media.version}`,
  }
}

export function trackDto(track: AudioTrackRow) {
  return {
    id: track.id,
    name: track.name,
    format: track.format,
    contentType: track.contentType,
    size: track.size,
    durationMs: track.durationMs,
    createdAt: track.createdAt,
    url: `/api/audio-tracks/${track.id}/file?v=${track.sha256.slice(0, 12)}`,
  }
}

export function completedDto(result: CompletedUpload) {
  if (result.kind === 'audio') return { kind: result.kind, track: trackDto(result.track) }
  if ('media' in result) return { kind: result.kind, media: mediaDto(result.generationId, result.media) }
  return { kind: result.kind, photo: photoDto(result.propertyId, result.photo) }
}

/**
 * Acceso directo a un archivo privado (DA-58): tras autorizar, la API firma una URL de lectura para
 * esa clave y redirige a ella (etiquetas img, video, enlaces de descarga) o la devuelve en JSON
 * (?as=url, para fetch). Ninguna de las dos respuestas se guarda en caché: cada acceso vuelve a
 * comprobar la sesión. La URL firmada es una capacidad temporal: no se guarda ni se registra.
 */
export async function sendAccess(reply: FastifyReply, key: string, kind: 'photo' | 'thumb' | 'poster' | 'video' | 'audio', asJson: boolean, downloadName?: string) {
  const expiresAt = readExpiry(kind)
  const url = await (await getStorage()).presignGet(key, { expiresAt, ...(downloadName && { downloadName }) })
  reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie').header('Referrer-Policy', 'no-referrer')
  if (asJson) return reply.send({ url, expiresAt })
  return reply.code(302).header('Location', url).send()
}

/** En modo de transferencias directas la API no recibe archivos: hay que usar /api/uploads. */
async function rejectBinaryWrite(reply: FastifyReply): Promise<boolean> {
  if (!(await getStorage()).directTransfers) return false
  reply.code(409).send({ code: 'DIRECT_UPLOAD_REQUIRED', message: 'Los archivos se suben directamente al almacenamiento: usa /api/uploads.' })
  return true
}

// Archivos privados: el navegador puede guardarlos, pero debe revalidar cada vez (no-cache). Así
// la comprobación de sesión y propiedad se repite siempre (tras cerrar sesión, otra cuenta en el
// mismo navegador no ve la copia guardada) y, si la versión no ha cambiado, se responde 304 sin
// volver a leer ni enviar el archivo.
function sendFile(reply: FastifyReply, file: { stream: NodeJS.ReadableStream; size: number } | null, contentType: string, disposition: string, etag: string) {
  reply.header('Cache-Control', 'private, no-cache').header('ETag', etag).header('Vary', 'Cookie')
  if (!file) return reply.code(304).send()
  return reply
    .header('Content-Type', contentType)
    .header('Content-Length', String(file.size))
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Disposition', disposition)
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .send(file.stream)
}

export async function mediaRoutes(app: FastifyInstance) {
  // Cuerpos binarios: solo los tipos admitidos; el contenido real se comprueba en los servicios.
  app.addContentTypeParser(BINARY_TYPES, { parseAs: 'buffer', bodyLimit: Math.max(PHOTO_MAX_BYTES, POSTER_MAX_BYTES, VIDEO_MAX_BYTES, AUDIO_MAX_BYTES) }, (_request, body, done) => done(null, body))

  const declared = (request: FastifyRequest) => request.headers['content-type']?.split(';')[0].trim().toLowerCase()
  const body = (request: FastifyRequest) => (Buffer.isBuffer(request.body) ? request.body : null)

  // ------------------------------------------------------------------ Galería
  app.get('/api/properties/:id/photos', { preHandler: requireAuth }, async (request, reply) => {
    const params = PropertyParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      const photos = await listPhotos(params.data.id, userOf(request))
      return {
        photos: photos.map(photo => photoDto(params.data.id, photo)),
        limit: MAX_PROPERTY_PHOTOS,
        maxBytes: PHOTO_MAX_BYTES,
        maxTotalBytes: PROPERTY_PHOTOS_MAX_TOTAL_BYTES,
        totalBytes: photos.reduce((sum, photo) => sum + photo.size, 0),
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/properties/:id/photos', { preHandler: requireAuth, bodyLimit: PHOTO_MAX_BYTES, config: PHOTO_WRITE_LIMIT }, async (request, reply) => {
    const params = PropertyParams.safeParse(request.params)
    const file = body(request)
    if (!params.success) return badRequest(reply)
    if (await rejectBinaryWrite(reply)) return reply
    if (!file) return reply.code(415).send({ code: 'TYPE_MISMATCH', message: 'Envía la imagen como JPEG, PNG o WebP.' })
    try {
      const photo = await addPhoto(request.log, userOf(request), params.data.id, { body: file, declaredType: declared(request), originalName: request.headers['x-file-name'] })
      return reply.code(201).send(photoDto(params.data.id, photo))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.put('/api/properties/:id/photos/order', { preHandler: requireAuth, config: PHOTO_WRITE_LIMIT }, async (request, reply) => {
    const params = PropertyParams.safeParse(request.params)
    const order = OrderBody.safeParse(request.body)
    if (!params.success || !order.success) return badRequest(reply)
    try {
      const photos = await reorderPhotos(userOf(request), params.data.id, order.data.photoIds)
      return { photos: photos.map(photo => photoDto(params.data.id, photo)) }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.put('/api/properties/:id/photos/:photoId/primary', { preHandler: requireAuth, config: PHOTO_WRITE_LIMIT }, async (request, reply) => {
    const params = PhotoParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      const photos = await setPrimaryPhoto(userOf(request), params.data.id, params.data.photoId)
      return { photos: photos.map(photo => photoDto(params.data.id, photo)) }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.put('/api/properties/:id/photos/:photoId/file', { preHandler: requireAuth, bodyLimit: PHOTO_MAX_BYTES, config: PHOTO_WRITE_LIMIT }, async (request, reply) => {
    const params = PhotoParams.safeParse(request.params)
    const file = body(request)
    if (!params.success) return badRequest(reply)
    if (await rejectBinaryWrite(reply)) return reply
    if (!file) return reply.code(415).send({ code: 'TYPE_MISMATCH', message: 'Envía la imagen como JPEG, PNG o WebP.' })
    try {
      const photo = await replacePhoto(request.log, userOf(request), params.data.id, params.data.photoId, { body: file, declaredType: declared(request), originalName: request.headers['x-file-name'] })
      return photoDto(params.data.id, photo)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.put('/api/properties/:id/photos/:photoId/thumbnail', { preHandler: requireAuth, bodyLimit: THUMBNAIL_MAX_BYTES, config: PHOTO_WRITE_LIMIT }, async (request, reply) => {
    const params = PhotoParams.safeParse(request.params)
    const file = body(request)
    if (!params.success) return badRequest(reply)
    if (await rejectBinaryWrite(reply)) return reply
    if (!file) return reply.code(415).send({ code: 'TYPE_MISMATCH', message: 'Envía la miniatura como JPEG.' })
    try {
      const photo = await setPhotoThumbnail(request.log, userOf(request), params.data.id, params.data.photoId, { body: file, declaredType: declared(request) })
      return photoDto(params.data.id, photo)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/properties/:id/photos/:photoId', { preHandler: requireAuth, config: PHOTO_WRITE_LIMIT }, async (request, reply) => {
    const params = PhotoParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      await removePhoto(request.log, userOf(request), params.data.id, params.data.photoId)
      return reply.code(204).send()
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/properties/:id/photos/:photoId/file', { preHandler: requireAuth }, async (request, reply) => {
    const params = PhotoParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      const size = (request.query as { size?: string } | undefined)?.size === 'thumb' ? 'thumb' : 'full'
      const query = AccessQuery.safeParse(request.query ?? {})
      const asJson = query.success && query.data.as === 'url'
      if (asJson || (await getStorage()).directTransfers) {
        const { key } = await locatePhoto(userOf(request), params.data.id, params.data.photoId, size)
        return await sendAccess(reply, key, size === 'thumb' ? 'thumb' : 'photo', asJson)
      }
      const { file, etag, contentType } = await readPhoto(userOf(request), params.data.id, params.data.photoId, request.headers['if-none-match'], size)
      return sendFile(reply, file, contentType, 'inline', etag)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  // ------------------------------------------------------------------ Cartel y vídeo
  app.get('/api/generations/:id/media', { preHandler: requireAuth }, async (request, reply) => {
    const params = PropertyParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      const rows = await listMedia(params.data.id, userOf(request))
      const byKind = Object.fromEntries(rows.map(row => [row.kind, mediaDto(params.data.id, row)]))
      return { poster: byKind.poster ?? null, video: byKind.video ?? null }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/generations/:id/media/source', { preHandler: requireAuth }, async (request, reply) => {
    const params = PropertyParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      const source = await getMediaSource(params.data.id, userOf(request))
      return {
        ...source,
        photos: source.photos.map(({ sha256, thumbSize, ...photo }) => {
          const url = `/api/properties/${source.property.id}/photos/${photo.id}/file?v=${sha256.slice(0, 12)}`
          return { ...photo, url, thumbUrl: thumbSize === null ? null : `${url}-${thumbSize}&size=thumb` }
        }),
        limits: { videoMaxPhotos: VIDEO_MAX_PHOTOS },
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/generations/:id/media/poster/template-draw', { preHandler: requireAuth, config: DRAW_LIMIT }, async (request, reply) => {
    const params = PropertyParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      return await drawPosterTemplate(userOf(request), params.data.id)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.put('/api/generations/:id/media/:kind', { preHandler: requireAuth, bodyLimit: Math.max(POSTER_MAX_BYTES, VIDEO_MAX_BYTES), config: MEDIA_WRITE_LIMIT }, async (request, reply) => {
    const params = MediaParams.safeParse(request.params)
    const headers = MediaHeaders.safeParse(request.headers)
    const file = body(request)
    if (!params.success || !headers.success) return badRequest(reply)
    if (await rejectBinaryWrite(reply)) return reply
    if (!file) return reply.code(415).send({ code: 'TYPE_MISMATCH', message: 'Tipo de archivo no admitido.' })
    const h = headers.data
    const kind = params.data.kind as MediaKind
    try {
      const media = await saveMedia(request.log, userOf(request), params.data.id, {
        kind,
        body: file,
        declaredType: declared(request),
        sourceHash: h['x-source-hash'],
        expectedVersion: h['x-expected-version'],
        variant: h['x-media-variant'],
        durationMs: h['x-media-duration-ms'] ?? null,
        photoIds: h['x-photo-ids'],
        ...(kind === 'poster' || h['x-template-id'] !== undefined
          ? { poster: { templateId: h['x-template-id'] ?? '', selection: h['x-template-selection'] ?? 'manual', drawId: h['x-template-draw'] ?? null } }
          : {}),
        ...(kind === 'video' || h['x-audio-source'] !== undefined
          ? {
              audio: {
                source: h['x-audio-source'] ?? 'none',
                trackId: h['x-audio-track'] ?? null,
                volume: h['x-audio-volume'] ?? null,
                fadeInMs: h['x-audio-fade-in-ms'] ?? null,
                fadeOutMs: h['x-audio-fade-out-ms'] ?? null,
              },
              codecs: h['x-media-codecs'] ?? null,
            }
          : {}),
      })
      return mediaDto(params.data.id, media)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/generations/:id/media/:kind/file', { preHandler: requireAuth }, async (request, reply) => {
    const params = MediaParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      const download = (request.query as { download?: string } | undefined)?.download === '1'
      const query = AccessQuery.safeParse(request.query ?? {})
      const asJson = query.success && query.data.as === 'url'
      const nameOf = (contentType: string) => `estateforge-${params.data.kind === 'poster' ? 'cartel' : 'video'}-${params.data.id}.${{ 'image/jpeg': 'jpg', 'image/png': 'png', 'video/webm': 'webm', 'video/mp4': 'mp4' }[contentType] ?? 'bin'}`
      if (asJson || (await getStorage()).directTransfers) {
        const { key, contentType } = await locateMedia(userOf(request), params.data.id, params.data.kind as MediaKind)
        return await sendAccess(reply, key, params.data.kind === 'video' ? 'video' : 'poster', asJson, download ? nameOf(contentType) : undefined)
      }
      const { media, file, etag } = await readMedia(userOf(request), params.data.id, params.data.kind as MediaKind, request.headers['if-none-match'])
      const name = nameOf(media.contentType)
      return sendFile(reply, file, media.contentType, download ? `attachment; filename="${name}"` : 'inline', etag)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  // ------------------------------------------------------------------ Biblioteca de audio
  app.get('/api/audio-tracks', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const tracks = await listTracks(userOf(request))
      return { tracks: tracks.map(trackDto), limits: { maxTracks: MAX_AUDIO_TRACKS_PER_USER, maxBytes: AUDIO_MAX_BYTES, maxDurationMs: AUDIO_MAX_DURATION_MS } }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/audio-tracks', { preHandler: requireAuth, bodyLimit: AUDIO_MAX_BYTES, config: AUDIO_WRITE_LIMIT }, async (request, reply) => {
    const file = body(request)
    if (await rejectBinaryWrite(reply)) return reply
    if (!file) return reply.code(415).send({ code: 'TYPE_MISMATCH', message: 'Formato de audio no admitido. Usa MP3, WAV, OGG o M4A.' })
    try {
      const track = await addTrack(request.log, userOf(request), {
        body: file,
        declaredType: request.headers['content-type'],
        originalName: request.headers['x-file-name'],
        rightsConfirmed: request.headers['x-rights-confirmed'] === 'yes',
      })
      return reply.code(201).send(trackDto(track))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/audio-tracks/:id', { preHandler: requireAuth, config: AUDIO_WRITE_LIMIT }, async (request, reply) => {
    const params = TrackParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      await removeTrack(request.log, userOf(request), params.data.id)
      return reply.code(204).send()
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/audio-tracks/:id/file', { preHandler: requireAuth }, async (request, reply) => {
    const params = TrackParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      const query = AccessQuery.safeParse(request.query ?? {})
      const asJson = query.success && query.data.as === 'url'
      if (asJson || (await getStorage()).directTransfers) {
        const { key } = await locateTrack(userOf(request), params.data.id)
        return await sendAccess(reply, key, 'audio', asJson)
      }
      const { track, file, etag } = await readTrack(userOf(request), params.data.id, request.headers['if-none-match'])
      return sendFile(reply, file, track.contentType, 'inline', etag)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  // ------------------------------------------------------------------ Subidas directas (DA-58)
  app.post('/api/uploads', { preHandler: requireAuth, config: UPLOAD_LIMIT }, async (request, reply) => {
    const body = PrepareBody.safeParse(request.body)
    if (!body.success) return badRequest(reply)
    try {
      const prepared = await prepareUpload(request.log, userOf(request), body.data)
      reply.header('Cache-Control', 'private, no-store')
      return reply.code(201).send({ attemptId: prepared.attemptId, expiresAt: prepared.expiresAt, upload: prepared.upload })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/uploads/:id/complete', { preHandler: requireAuth, config: UPLOAD_LIMIT }, async (request, reply) => {
    const params = UploadParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      return completedDto(await completeUpload(request.log, userOf(request), params.data.id))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/uploads/:id', { preHandler: requireAuth, config: UPLOAD_LIMIT }, async (request, reply) => {
    const params = UploadParams.safeParse(request.params)
    if (!params.success) return badRequest(reply)
    try {
      await cancelUpload(request.log, userOf(request), params.data.id)
      return reply.code(204).send()
    } catch (error) {
      return sendError(reply, error)
    }
  })

  // ------------------------------------------------------------------ Simulador local de Blob (DA-58)
  // Solo con STORAGE_DRIVER=local (desarrollo y pruebas); con Vercel Blob responde 404. La firma de la
  // URL es la autorización: no se usa la sesión, igual que en las URLs firmadas de Vercel Blob.
  const localBlob = async (request: FastifyRequest) => {
    const storage = await getStorage()
    if (!(storage instanceof LocalStorage)) return null
    const key = decodeURIComponent((request.raw.url ?? '').slice(LOCAL_BLOB_PREFIX.length).split('?')[0])
    return { storage, key }
  }

  const serveLocal = async (request: FastifyRequest, reply: FastifyReply, operation: 'get' | 'head') => {
    const target = await localBlob(request)
    if (!target) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No existe.' })
    const grant = target.storage.signer?.verify(target.key, request.query as Record<string, string>, operation)
    if (!grant || grant === 'invalid') return reply.code(403).send({ code: 'FORBIDDEN', message: 'Firma no válida.' })
    if (grant === 'expired') return reply.code(403).send({ code: 'EXPIRED', message: 'La URL ha caducado.' })
    const info = await target.storage.head(target.key)
    if (!info) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No existe.' })
    // Un solo rango «inicio-[fin]» o «-sufijo» (RFC 9110, 14.1.2). «bytes=-» no es válido: como cualquier
    // otra cabecera no reconocida o con varios rangos, se ignora y se envía el archivo completo (200).
    const range = /^bytes=(?:(\d+)-(\d*)|()-(\d+))$/.exec(String(request.headers.range ?? ''))?.filter(part => part !== undefined) ?? null
    let start = 0
    let end = info.size - 1
    if (range) {
      if (range[1] === '' && range[2] !== '') start = Math.max(0, info.size - Number(range[2]))
      else {
        start = Number(range[1])
        end = range[2] === '' ? info.size - 1 : Math.min(Number(range[2]), info.size - 1)
      }
      if (start > end || start >= info.size) return reply.code(416).header('Content-Range', `bytes */${info.size}`).send()
    }
    reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', info.contentType)
      .header('Content-Length', String(end - start + 1))
      .header('Cache-Control', `private, max-age=${Math.max(0, Math.floor((grant.exp - Date.now()) / 1000))}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Content-Disposition', grant.dl ? `attachment; filename="${grant.dl.replace(/[^A-Za-z0-9._-]/g, '_')}"` : 'inline')
    if (range) reply.code(206).header('Content-Range', `bytes ${start}-${end}/${info.size}`)
    if (operation === 'head') return reply.send()
    const object = await target.storage.get(target.key, range ? { start, end } : undefined)
    if (!object) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No existe.' })
    return reply.send(object.stream)
  }

  app.get(`${LOCAL_BLOB_PREFIX}*`, async (request, reply) => serveLocal(request, reply, request.method === 'HEAD' ? 'head' : 'get'))

  app.put(`${LOCAL_BLOB_PREFIX}*`, { bodyLimit: Math.max(PHOTO_MAX_BYTES, POSTER_MAX_BYTES, VIDEO_MAX_BYTES, AUDIO_MAX_BYTES) }, async (request, reply) => {
    const target = await localBlob(request)
    if (!target) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No existe.' })
    const grant = target.storage.signer?.verify(target.key, request.query as Record<string, string>, 'put')
    if (!grant || grant === 'invalid') return reply.code(403).send({ code: 'FORBIDDEN', message: 'Firma no válida.' })
    if (grant === 'expired') return reply.code(403).send({ code: 'EXPIRED', message: 'La URL ha caducado.' })
    const file = body(request)
    if (!file) return reply.code(415).send({ code: 'TYPE_MISMATCH', message: 'Tipo de archivo no admitido.' })
    if (declared(request) !== grant.ct) return reply.code(400).send({ code: 'TYPE_MISMATCH', message: 'El tipo no coincide con el autorizado.' })
    if (file.length > (grant.max ?? 0)) return reply.code(413).send({ code: 'TOO_LARGE', message: 'El archivo supera el tamaño autorizado.' })
    try {
      await target.storage.put(target.key, file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return reply.code(409).send({ code: 'EXISTS', message: 'El archivo ya existe.' })
      throw error
    }
    return reply.code(200).send({ pathname: target.key, size: file.length })
  })

}
