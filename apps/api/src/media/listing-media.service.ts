import { createHash, randomInt } from 'node:crypto'

import type { FastifyBaseLogger } from 'fastify'

import {
  AI_POSTER_MAX_REFERENCE_PHOTOS,
  AI_POSTER_TEMPLATE_ID,
  AUDIO_FADE_MAX_MS,
  findAudioPreset,
  findPosterTemplate,
  inspectVideoContainer,
  pickUniform,
  POSTER_MAX_BYTES,
  POSTER_TEMPLATES,
  POSTER_TYPES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_MS,
  VIDEO_MAX_PHOTOS,
  VIDEO_TYPES,
  type AudioSource,
  type PosterTemplateInfo,
  type MediaKind,
  type TemplateSelectionMode,
} from '@estateforge/shared'
import { DEFAULT_LISTING_LANGUAGE, listingLanguageOf, type ListingLanguage } from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { getStorage, mediaKey, type StoredObject } from '../storage/object-storage.js'
import { findOwnTrack } from './audio.service.js'
import { sniffImage, sniffVideo } from './file-signatures.js'
import { completeAttempt, type DirectCommit } from './direct.js'
import { MediaError, notFound } from './media-errors.js'
import { etagMatches } from './photo.service.js'
import { assertUserQuota, lockUser } from './quota.js'
import { discardUnreferenced, drainStorageCleanup } from './storage-cleanup.js'
import { isAiMediaError } from '../ai-media/errors.js'
import { consumeReadyJob } from '../ai-media/jobs.service.js'

/** «Plantilla» del cartel IA (DA-72): no está en POSTER_TEMPLATES, así que «Aleatoria» nunca la sortea. */
const AI_POSTER_TEMPLATE: PosterTemplateInfo = { id: AI_POSTER_TEMPLATE_ID, name: 'Generación con IA', description: 'Fondo generado con IA y datos y fotografías reales del anuncio.', version: 1, photos: AI_POSTER_MAX_REFERENCE_PHOTOS }

// Cartel y vídeo de un anuncio (DA-46, DA-47, DA-52 a DA-56). El navegador los compone a partir de la
// «fuente» que entrega la API: textos del anuncio, datos del inmueble y sus fotografías en orden, con
// un hash. Al subir el resultado, la API recalcula el hash con el inmueble y el anuncio bloqueados: si
// los datos o las fotografías han cambiado, o el material no corresponde a este anuncio, lo rechaza.
//
// Cartel: plantilla del catálogo elegida a mano o, en «Aleatoria», sorteada por la API (crypto.randomInt)
// con un sorteo de un solo uso. Vídeo: la API abre el contenedor y comprueba que lleva vídeo, que lleva
// audio si y solo si se ha elegido una pista, y que su duración real coincide con la declarada.
//
// Sustitución segura: el archivo nuevo se guarda con una clave única; la referencia cambia en una
// transacción con control de versión (expectedVersion); el archivo anterior se borra solo tras el
// commit, mediante la cola de limpieza. Si algo falla antes del commit, el anterior sigue intacto.

type Tx = Prisma.TransactionClient

const MEDIA_SELECT = {
  kind: true,
  contentType: true,
  size: true,
  width: true,
  height: true,
  durationMs: true,
  variant: true,
  version: true,
  photoIds: true,
  templateId: true,
  templateVersion: true,
  selectionMode: true,
  codecs: true,
  hasAudio: true,
  audioSource: true,
  audioTrackId: true,
  audioName: true,
  audioVolume: true,
  audioFadeInMs: true,
  audioFadeOutMs: true,
  generationMode: true,
  aiProvider: true,
  aiModel: true,
  createdAt: true,
  updatedAt: true,
} as const

export type MediaRow = Prisma.ListingMediaGetPayload<{ select: typeof MEDIA_SELECT }>

const PROPERTY_FIELDS = {
  id: true,
  title: true,
  operation: true,
  type: true,
  price: true,
  city: true,
  neighborhood: true,
  area: true,
  bedrooms: true,
  bathrooms: true,
  floor: true,
  condition: true,
  commercialStatus: true,
  elevator: true,
  terrace: true,
  balcony: true,
  garage: true,
  storageRoom: true,
  pool: true,
  garden: true,
  airConditioning: true,
  heating: true,
} as const

export interface MediaSource {
  sourceHash: string
  /** Idioma del contenido del anuncio («español» o «english»): decide las etiquetas del cartel y del vídeo. */
  generation: { id: string; title: string; description: string; highlights: string[]; callToAction: string | null; language: ListingLanguage }
  property: Omit<Prisma.PropertyGetPayload<{ select: typeof PROPERTY_FIELDS }>, 'price'> & { price: string }
  photos: { id: string; position: number; isPrimary: boolean; width: number; height: number; sha256: string; thumbSize: number | null }[]
}

function parseHighlights(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

async function readSource(db: Tx | typeof prisma, generationId: string, userId: string): Promise<MediaSource | null> {
  const generation = await db.generation.findFirst({
    where: { id: generationId, property: { userId } },
    select: {
      id: true,
      title: true,
      description: true,
      highlights: true,
      callToAction: true,
      language: true,
      property: { select: { ...PROPERTY_FIELDS, photos: { orderBy: { position: 'asc' }, select: { id: true, position: true, isPrimary: true, width: true, height: true, sha256: true, thumbSize: true } } } },
    },
  })
  if (!generation) return null
  const { photos, price, ...property } = generation.property
  const language = listingLanguageOf(generation.language)
  const text = { id: generation.id, title: generation.title, description: generation.description, highlights: parseHighlights(generation.highlights), callToAction: generation.callToAction }
  const source = {
    // El idioma cambia las etiquetas que se dibujan, así que entra en la huella. Solo se añade cuando no es
    // el español por defecto: los anuncios en español (todos los anteriores) conservan su huella, y su
    // material y sus trabajos de IA siguen siendo válidos porque su contenido no ha cambiado.
    generation: language === DEFAULT_LISTING_LANGUAGE ? text : { ...text, language },
    property: { ...property, price: price.toFixed(2) },
    // La miniatura no cambia el contenido: queda fuera de la huella, que solo cubre lo que se dibuja.
    photos: photos.map(({ thumbSize: _thumb, ...photo }) => photo),
  }
  return { sourceHash: createHash('sha256').update(JSON.stringify(source)).digest('hex'), ...source, generation: { ...text, language }, photos }
}

export async function getMediaSource(generationId: string, userId: string): Promise<MediaSource> {
  const source = await readSource(prisma, generationId, userId)
  if (!source) throw notFound('El anuncio')
  return source
}

export async function listMedia(generationId: string, userId: string): Promise<MediaRow[]> {
  const owned = await prisma.generation.count({ where: { id: generationId, property: { userId } } })
  if (owned !== 1) throw notFound('El anuncio')
  return prisma.listingMedia.findMany({ where: { generationId }, orderBy: { kind: 'asc' }, select: MEDIA_SELECT })
}

// --------------------------------------------------------------------------- Sorteo de plantilla

const DRAW_TTL_MS = 60 * 60 * 1000

/**
 * «Aleatoria» (DA-52): la API elige una plantilla con distribución uniforme entre todas las del
 * catálogo y guarda el sorteo. El cartel solo se acepta como aleatorio con un sorteo propio, sin usar
 * y de la última hora, y con la plantilla sorteada: el navegador no puede elegirla.
 */
export async function drawPosterTemplate(userId: string, generationId: string, random: (n: number) => number = n => randomInt(n)) {
  const owned = await prisma.generation.count({ where: { id: generationId, property: { userId } } })
  if (owned !== 1) throw notFound('El anuncio')
  const template = pickUniform(POSTER_TEMPLATES, random)
  // Los sorteos viejos de este anuncio ya no sirven: se retiran para no acumular filas.
  await prisma.mediaTemplateDraw.deleteMany({ where: { generationId, createdAt: { lt: new Date(Date.now() - DRAW_TTL_MS) } } })
  const draw = await prisma.mediaTemplateDraw.create({ data: { generationId, templateId: template.id, templateVersion: template.version }, select: { id: true } })
  return { drawId: draw.id, templateId: template.id, templateVersion: template.version }
}

// --------------------------------------------------------------------------------- Guardado

export interface PosterOptions {
  templateId: string
  selection: TemplateSelectionMode
  drawId: string | null
}

export interface VideoAudioOptions {
  source: AudioSource
  trackId: string | null
  volume: number | null
  fadeInMs: number | null
  fadeOutMs: number | null
}

export interface MediaUpload {
  kind: MediaKind
  body: Buffer
  declaredType: string | undefined
  sourceHash: string
  expectedVersion: number
  variant: number
  durationMs: number | null
  photoIds: string[]
  poster?: PosterOptions
  audio?: VideoAudioOptions
  codecs?: string | null
  /** Material generado con IA (DA-72): trabajo listo para revisión que el usuario acepta al guardarlo. */
  ai?: { jobId: string }
}

/** Diferencia admitida entre la duración declarada y la medida en el contenedor. */
const DURATION_TOLERANCE_MS = 2_000

function inspectMedia(upload: MediaUpload) {
  const { kind, body } = upload
  if (body.length === 0) throw new MediaError('INVALID_FILE', 'El archivo está vacío.')
  if (kind === 'poster') {
    if (body.length > POSTER_MAX_BYTES) throw new MediaError('TOO_LARGE', 'El cartel supera el tamaño máximo de 3 MB.')
    const image = sniffImage(body)
    if (!image || !(POSTER_TYPES as readonly string[]).includes(image.type)) throw new MediaError('INVALID_FILE', 'El cartel debe ser una imagen JPEG o PNG válida.')
    if (upload.declaredType !== image.type) throw new MediaError('TYPE_MISMATCH', 'El tipo del archivo no coincide con su contenido.')
    if (image.width > 4096 || image.height > 4096) throw new MediaError('INVALID_FILE', 'El cartel tiene unas dimensiones no admitidas.')
    return { contentType: image.type, width: image.width, height: image.height, durationMs: null as number | null }
  }
  if (body.length > VIDEO_MAX_BYTES) throw new MediaError('TOO_LARGE', 'El vídeo supera el tamaño máximo de 4 MB.')
  const type = sniffVideo(body)
  if (!type || !(VIDEO_TYPES as readonly string[]).includes(type)) throw new MediaError('INVALID_FILE', 'El vídeo debe ser WebM o MP4.')
  if (upload.declaredType !== type) throw new MediaError('TYPE_MISMATCH', 'El tipo del archivo no coincide con su contenido.')
  const declared = upload.durationMs
  if (declared === null || !Number.isInteger(declared) || declared < 1000 || declared > VIDEO_MAX_DURATION_MS) {
    throw new MediaError('INVALID_REQUEST', 'La duración del vídeo no es válida.')
  }
  // Contenido real: pista de vídeo, audio solo si se ha elegido y duración medida.
  const container = inspectVideoContainer(body)
  if (!container || container.container !== type || !container.hasVideo) throw new MediaError('INVALID_FILE', 'El vídeo está dañado o no contiene una pista de vídeo.')
  const wantsAudio = (upload.audio?.source ?? 'none') !== 'none'
  if (wantsAudio && !container.hasAudio) throw new MediaError('INVALID_FILE', 'El vídeo no contiene la pista de audio elegida. No se ha guardado.')
  if (!wantsAudio && container.hasAudio) throw new MediaError('INVALID_FILE', 'El vídeo contiene audio, pero se ha indicado que no lleva sonido.')
  const measured = container.durationMs
  if (measured !== null && Math.abs(measured - declared) > DURATION_TOLERANCE_MS) throw new MediaError('INVALID_FILE', 'La duración del vídeo no coincide con la declarada.')
  return { contentType: type, width: 1280, height: 720, durationMs: measured ?? declared }
}

function assertSourceUse(source: MediaSource, upload: MediaUpload): void {
  if (source.photos.length === 0) throw new MediaError('NO_PHOTOS', 'El inmueble no tiene fotografías. Añade al menos una antes de generar el material.')
  if (source.sourceHash !== upload.sourceHash) {
    throw new MediaError('SOURCE_CHANGED', 'Los datos del anuncio o las fotografías han cambiado durante la generación. Vuelve a generarlo.')
  }
  const owned = new Set(source.photos.map(photo => photo.id))
  if (upload.photoIds.length === 0 || new Set(upload.photoIds).size !== upload.photoIds.length || upload.photoIds.some(id => !owned.has(id))) {
    throw new MediaError('INVALID_REQUEST', 'El material solo puede usar fotografías de este inmueble.')
  }
  // Vídeo (DA-53): la principal es obligatoria y abre el vídeo; el resto, en el orden elegido.
  const primary = source.photos.find(photo => photo.isPrimary)
  if (upload.kind === 'video' && primary && upload.photoIds[0] !== primary.id) {
    throw new MediaError('INVALID_REQUEST', 'El vídeo debe empezar por la fotografía principal del inmueble.')
  }
}

/** Plantilla y audio declarados: comprobaciones que no dependen de la base de datos. */
type CheckedOptions = { kind: 'poster'; template: PosterTemplateInfo } | { kind: 'video'; audio: VideoAudioOptions }

function assertOptions(upload: MediaUpload): CheckedOptions {
  if (upload.kind === 'poster') {
    const poster = upload.poster
    // Cartel IA (DA-72): solo con su trabajo, elegido a mano y nunca por sorteo.
    const isAi = poster?.templateId === AI_POSTER_TEMPLATE_ID
    if (isAi !== Boolean(upload.ai)) throw new MediaError('INVALID_REQUEST', 'El cartel con IA necesita una propuesta de IA aceptada.')
    const template = poster ? (isAi ? AI_POSTER_TEMPLATE : findPosterTemplate(poster.templateId)) : undefined
    if (!poster || !template) throw new MediaError('INVALID_REQUEST', 'Elige una plantilla de cartel del catálogo.')
    if (isAi && (poster.selection !== 'manual' || poster.drawId)) throw new MediaError('INVALID_REQUEST', 'La generación con IA se elige expresamente; nunca forma parte de «Aleatoria».')
    if (poster.selection === 'random' && !poster.drawId) throw new MediaError('INVALID_REQUEST', 'La selección aleatoria necesita un sorteo de la API.')
    if (poster.selection === 'manual' && poster.drawId) throw new MediaError('INVALID_REQUEST', 'Una plantilla elegida a mano no lleva sorteo.')
    if (upload.photoIds.length > template.photos) throw new MediaError('INVALID_REQUEST', 'El cartel usa más fotografías de las que admite su plantilla.')
    if (upload.audio && upload.audio.source !== 'none') throw new MediaError('INVALID_REQUEST', 'El cartel no lleva audio.')
    return { kind: 'poster', template }
  }
  if (upload.poster) throw new MediaError('INVALID_REQUEST', 'El vídeo no usa plantillas de cartel.')
  if (upload.photoIds.length > VIDEO_MAX_PHOTOS) throw new MediaError('INVALID_REQUEST', `El vídeo admite como máximo ${VIDEO_MAX_PHOTOS} fotografías.`)
  const audio: VideoAudioOptions = upload.audio ?? { source: 'none', trackId: null, volume: null, fadeInMs: null, fadeOutMs: null }
  if (audio.source === 'none') {
    if (audio.trackId || audio.volume !== null || audio.fadeInMs !== null || audio.fadeOutMs !== null) throw new MediaError('INVALID_REQUEST', 'Sin sonido no se indican pista, volumen ni fundidos.')
  } else {
    if (!audio.trackId || audio.volume === null || audio.volume < 0 || audio.volume > 100) throw new MediaError('INVALID_REQUEST', 'Indica la pista y un volumen entre 0 y 100.')
    for (const fade of [audio.fadeInMs, audio.fadeOutMs]) {
      if (fade === null || fade < 0 || fade > AUDIO_FADE_MAX_MS) throw new MediaError('INVALID_REQUEST', 'Los fundidos deben estar entre 0 y 5 segundos.')
    }
    if (audio.source === 'preset' && !findAudioPreset(audio.trackId)) throw new MediaError('INVALID_REQUEST', 'La pista predeterminada no existe.')
  }
  if (upload.codecs !== undefined && upload.codecs !== null && !/^video\/(webm|mp4)(;\s*codecs="?[a-z0-9.,\s]+"?)?$/i.test(upload.codecs)) {
    throw new MediaError('INVALID_REQUEST', 'Códecs no válidos.')
  }
  return { kind: 'video', audio }
}

/**
 * Comprobaciones previas de una subida directa de cartel o vídeo (DA-58), antes de firmar la URL:
 * opciones, propiedad, huella de la fuente, versión esperada y pista de audio propia. Se repiten al
 * confirmar, con los bloqueos.
 */
export async function precheckMedia(userId: string, generationId: string, upload: Omit<MediaUpload, 'body'>): Promise<void> {
  if (upload.kind === 'video' && (upload.durationMs === null || !Number.isInteger(upload.durationMs) || upload.durationMs < 1000 || upload.durationMs > VIDEO_MAX_DURATION_MS)) {
    throw new MediaError('INVALID_REQUEST', 'La duración del vídeo no es válida.')
  }
  const options = assertOptions({ ...upload, body: Buffer.alloc(0) })
  if (!Number.isInteger(upload.variant) || upload.variant < 0 || upload.variant > 1_000_000) throw new MediaError('INVALID_REQUEST', 'Variante no válida.')
  if (!Number.isInteger(upload.expectedVersion) || upload.expectedVersion < 0) throw new MediaError('INVALID_REQUEST', 'Versión esperada no válida.')
  const source = await readSource(prisma, generationId, userId)
  if (!source) throw notFound('El anuncio')
  assertSourceUse(source, { ...upload, body: Buffer.alloc(0) })
  const current = await prisma.listingMedia.findUnique({ where: { generationId_kind: { generationId, kind: upload.kind } }, select: { version: true } })
  if ((current?.version ?? 0) !== upload.expectedVersion) throw new MediaError('VERSION_CONFLICT', 'El material se ha actualizado desde otra pestaña o petición. Recarga la página.')
  if (options.kind === 'video' && options.audio.source === 'library' && !(await findOwnTrack(userId, options.audio.trackId!))) throw notFound('La pista de audio')
}

export async function saveMedia(log: FastifyBaseLogger | null, userId: string, generationId: string, upload: MediaUpload, direct?: DirectCommit): Promise<MediaRow> {
  const file = inspectMedia(upload)
  if (direct && !direct.key.endsWith(file.contentType === 'image/png' ? '.png' : file.contentType === 'image/jpeg' ? '.jpg' : file.contentType === 'video/mp4' ? '.mp4' : '.webm')) {
    throw new MediaError('TYPE_MISMATCH', 'El tipo del archivo no coincide con su contenido.')
  }
  const options = assertOptions(upload)
  if (!Number.isInteger(upload.variant) || upload.variant < 0 || upload.variant > 1_000_000) throw new MediaError('INVALID_REQUEST', 'Variante no válida.')
  if (!Number.isInteger(upload.expectedVersion) || upload.expectedVersion < 0) throw new MediaError('INVALID_REQUEST', 'Versión esperada no válida.')

  // Comprobaciones previas para no almacenar un archivo que se va a rechazar.
  const before = await readSource(prisma, generationId, userId)
  if (!before) throw notFound('El anuncio')
  assertSourceUse(before, upload)
  const current = await prisma.listingMedia.findUnique({ where: { generationId_kind: { generationId, kind: upload.kind } }, select: { version: true } })
  if ((current?.version ?? 0) !== upload.expectedVersion) {
    throw new MediaError('VERSION_CONFLICT', 'El material se ha actualizado desde otra pestaña o petición. Recarga la página.')
  }
  // Pista personal: solo una del propio usuario (una ajena responde igual que una inexistente).
  let audioName: string | null = null
  if (options.kind === 'video' && options.audio.source === 'library') {
    const track = await findOwnTrack(userId, options.audio.trackId!)
    if (!track) throw notFound('La pista de audio')
    audioName = track.name
  }
  if (options.kind === 'video' && options.audio.source === 'preset') audioName = findAudioPreset(options.audio.trackId)!.name

  const key = direct?.key ?? mediaKey(userId, generationId, upload.kind, file.contentType)
  if (!direct) await (await getStorage()).put(key, upload.body, file.contentType)
  let oldKey: string | null = null
  let aiResultKeyToDrain: string | null = null
  let saved: MediaRow
  try {
    ;({ oldKey, saved } = await prisma.$transaction(async tx => {
      // Orden fijo de bloqueos: usuario, inmueble y anuncio. Excluye cambios de fotografías y de datos.
      await lockUser(tx, userId)
      const propertyId = before.property.id
      const lockedProperty = await tx.$executeRaw`UPDATE "Property" SET "userId" = "userId" WHERE "id" = ${propertyId} AND "userId" = ${userId}`
      const lockedGeneration = await tx.$executeRaw`UPDATE "Generation" SET "title" = "title" WHERE "id" = ${generationId} AND "propertyId" = ${propertyId}`
      if (lockedProperty !== 1 || lockedGeneration !== 1) throw notFound('El anuncio')
      const source = await readSource(tx, generationId, userId)
      if (!source) throw notFound('El anuncio')
      assertSourceUse(source, upload)
      const existing = await tx.listingMedia.findUnique({ where: { generationId_kind: { generationId, kind: upload.kind } }, select: { storageKey: true, version: true, size: true } })
      if ((existing?.version ?? 0) !== upload.expectedVersion) {
        throw new MediaError('VERSION_CONFLICT', 'El material se ha actualizado desde otra pestaña o petición. Recarga la página.')
      }
      await assertUserQuota(tx, userId, upload.body.length, existing?.size ?? 0, direct?.attemptId ?? null)

      let posterData = {}
      if (options.kind === 'poster') {
        const { template } = options
        if (upload.poster!.selection === 'random') {
          // Sorteo propio, de este anuncio, sin usar, reciente y con la plantilla sorteada.
          const used = await tx.mediaTemplateDraw.updateMany({
            where: { id: upload.poster!.drawId!, generationId, templateId: template.id, usedAt: null, createdAt: { gt: new Date(Date.now() - DRAW_TTL_MS) } },
            data: { usedAt: new Date() },
          })
          if (used.count !== 1) throw new MediaError('INVALID_REQUEST', 'El sorteo de plantilla no es válido o ya se ha usado. Vuelve a generar el cartel.')
        }
        posterData = { templateId: template.id, templateVersion: template.version, selectionMode: upload.poster!.selection }
      }
      // Revisión humana: el trabajo de IA se acepta en esta misma transacción.
      let aiData: { generationMode: string; aiJobId: string | null; aiProvider: string | null; aiModel: string | null } = { generationMode: 'classic', aiJobId: null, aiProvider: null, aiModel: null }
      if (upload.ai) {
        const accepted = await consumeReadyJob(tx, { jobId: upload.ai.jobId, userId, generationId, kind: upload.kind, sourceHash: source.sourceHash }).catch((error: unknown) => {
          if (isAiMediaError(error)) throw new MediaError(error.code === 'AI_JOB_NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_REQUEST', error.message)
          throw error
        })
        aiData = { generationMode: 'ai', aiJobId: upload.ai.jobId, aiProvider: accepted.provider, aiModel: accepted.model }
        aiResultKeyToDrain = accepted.resultKey
      }
      let videoData = {}
      if (options.kind === 'video') {
        const audio = options.audio
        videoData = {
          codecs: upload.codecs ?? null,
          hasAudio: audio.source !== 'none',
          audioSource: audio.source,
          audioTrackId: audio.source === 'none' ? null : audio.trackId,
          audioName: audio.source === 'none' ? null : audioName,
          audioVolume: audio.source === 'none' ? null : audio.volume,
          audioFadeInMs: audio.source === 'none' ? null : audio.fadeInMs,
          audioFadeOutMs: audio.source === 'none' ? null : audio.fadeOutMs,
        }
      }
      const data = {
        storageKey: key,
        contentType: file.contentType,
        size: upload.body.length,
        width: file.width,
        height: file.height,
        durationMs: file.durationMs,
        variant: upload.variant,
        sourceHash: source.sourceHash,
        photoIds: JSON.stringify(upload.photoIds),
        ...posterData,
        ...videoData,
        ...aiData,
      }
      const row = existing
        ? await tx.listingMedia.update({ where: { generationId_kind: { generationId, kind: upload.kind } }, data: { ...data, version: existing.version + 1 }, select: MEDIA_SELECT })
        : await tx.listingMedia.create({ data: { ...data, generationId, kind: upload.kind }, select: MEDIA_SELECT })
      if (direct) await completeAttempt(tx, direct, `${generationId}:${upload.kind}:${row.version}`)
      return { oldKey: existing?.storageKey ?? null, saved: row }
    }))
  } catch (error) {
    if (!direct) await discardUnreferenced(log, key, `${upload.kind}:save-failed`)
    if ((error as { code?: unknown } | null)?.code === 'P2002') {
      throw new MediaError('VERSION_CONFLICT', 'El material se ha actualizado desde otra pestaña o petición. Recarga la página.')
    }
    throw error
  }
  const drain = [oldKey, aiResultKeyToDrain].filter((key): key is string => Boolean(key))
  if (drain.length) await drainStorageCleanup(log, drain)
  return saved
}

/** Archivo del cartel o del vídeo propio; file = null si el navegador ya tiene esta versión. */
export async function readMedia(userId: string, generationId: string, kind: MediaKind, ifNoneMatch?: string): Promise<{ media: MediaRow; file: StoredObject | null; etag: string }> {
  const media = await prisma.listingMedia.findFirst({
    where: { generationId, kind, generation: { property: { userId } } },
    select: { ...MEDIA_SELECT, storageKey: true },
  })
  if (!media) throw notFound('El material')
  // Cada versión tiene una clave única; la etiqueta deriva de ella sin exponerla.
  const etag = `"m-${createHash('sha256').update(media.storageKey).digest('hex').slice(0, 32)}"`
  const { storageKey, ...row } = media
  if (etagMatches(ifNoneMatch, etag)) return { media: row, file: null, etag }
  const file = await (await getStorage()).get(storageKey)
  if (!file) throw new MediaError('STORAGE_UNAVAILABLE', 'El archivo no está disponible en este momento.')
  return { media: row, file, etag }
}

/** Clave y tipo del cartel o del vídeo propio, sin leerlo (DA-58). */
export async function locateMedia(userId: string, generationId: string, kind: MediaKind): Promise<{ key: string; contentType: string }> {
  const media = await prisma.listingMedia.findFirst({ where: { generationId, kind, generation: { property: { userId } } }, select: { storageKey: true, contentType: true } })
  if (!media) throw notFound('El material')
  return { key: media.storageKey, contentType: media.contentType }
}
