import { createHash } from 'node:crypto'

import type { FastifyBaseLogger } from 'fastify'

import { AUDIO_MAX_BYTES, AUDIO_MAX_DURATION_MS, AUDIO_MIN_DURATION_MS, MAX_AUDIO_TRACKS_PER_USER, audioFormatOfType, audioTypeOf } from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { audioKey, getStorage, type StoredObject } from '../storage/object-storage.js'
import { sniffAudio } from './audio-signatures.js'
import { sanitizeOriginalName } from './file-signatures.js'
import { completeAttempt, type DirectCommit } from './direct.js'
import { MediaError, notFound } from './media-errors.js'
import { etagMatches } from './photo.service.js'
import { assertUserQuota, lockUser } from './quota.js'
import { discardUnreferenced, drainStorageCleanup } from './storage-cleanup.js'

// Biblioteca de audio personal (DA-55). Cada pista pertenece a quien la sube y puede usarse en los
// vídeos de cualquiera de sus anuncios. El archivo va al almacenamiento de objetos; PostgreSQL guarda
// sus metadatos. Borrar una pista no altera los vídeos generados: el sonido ya está dentro de ellos.
// Toda consulta filtra por el usuario: una pista ajena responde 404, como si no existiera.

const TRACK_SELECT = { id: true, name: true, format: true, contentType: true, size: true, durationMs: true, sha256: true, createdAt: true } as const
export type AudioTrackRow = Prisma.AudioTrackGetPayload<{ select: typeof TRACK_SELECT }>

export interface AudioUpload {
  body: Buffer
  declaredType: string | undefined
  originalName: unknown
  rightsConfirmed: boolean
}

export function inspectAudio(upload: AudioUpload) {
  if (!upload.rightsConfirmed) throw new MediaError('INVALID_REQUEST', 'Confirma que tienes derecho a usar esta pista en tus vídeos.')
  if (upload.body.length === 0) throw new MediaError('INVALID_FILE', 'El archivo está vacío.')
  if (upload.body.length > AUDIO_MAX_BYTES) throw new MediaError('TOO_LARGE', 'La pista supera el tamaño máximo de 4 MB.')
  const declared = audioFormatOfType(upload.declaredType)
  if (!declared) throw new MediaError('TYPE_MISMATCH', 'Formato de audio no admitido. Usa MP3, WAV, OGG o M4A.')
  const info = sniffAudio(upload.body)
  if (!info) throw new MediaError('INVALID_FILE', 'El archivo no es una pista de audio válida o está dañado.')
  if (info.format !== declared) throw new MediaError('TYPE_MISMATCH', 'El tipo del archivo no coincide con su contenido.')
  if (info.durationMs < AUDIO_MIN_DURATION_MS) throw new MediaError('INVALID_FILE', 'La pista es demasiado corta (mínimo 1 segundo).')
  if (info.durationMs > AUDIO_MAX_DURATION_MS) throw new MediaError('TOO_LARGE', 'La pista supera la duración máxima de 5 minutos.')
  const name = (sanitizeOriginalName(upload.originalName) ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').trim() || 'Pista sin nombre'
  return { ...info, contentType: audioTypeOf(info.format), name: name.slice(0, 120), size: upload.body.length, sha256: createHash('sha256').update(upload.body).digest('hex') }
}

export async function listTracks(userId: string): Promise<AudioTrackRow[]> {
  return prisma.audioTrack.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: TRACK_SELECT })
}

export async function addTrack(log: FastifyBaseLogger | null, userId: string, upload: AudioUpload, direct?: DirectCommit): Promise<AudioTrackRow> {
  const info = inspectAudio(upload)
  const existing = await prisma.audioTrack.findMany({ where: { userId }, select: { sha256: true } })
  if (existing.length >= MAX_AUDIO_TRACKS_PER_USER) throw new MediaError('LIMIT_REACHED', `Tu biblioteca ya tiene ${MAX_AUDIO_TRACKS_PER_USER} pistas. Elimina alguna para subir otra.`)
  if (existing.some(track => track.sha256 === info.sha256)) throw new MediaError('DUPLICATE', 'Esta pista ya está en tu biblioteca.')

  // En una subida directa, la clave la eligió la API con el tipo declarado: debe coincidir con el real.
  if (direct && !direct.key.endsWith(`.${{ 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }[info.contentType]}`)) {
    throw new MediaError('TYPE_MISMATCH', 'El tipo del archivo no coincide con su contenido.')
  }
  const key = direct?.key ?? audioKey(userId, info.contentType)
  if (!direct) await (await getStorage()).put(key, upload.body, info.contentType)
  try {
    return await prisma.$transaction(async tx => {
      await lockUser(tx, userId)
      const count = await tx.audioTrack.count({ where: { userId } })
      const pending = await tx.uploadAttempt.count({ where: { userId, kind: 'audio', status: { in: ['pending', 'processing'] }, expiresAt: { gt: new Date() }, ...(direct && { NOT: { id: direct.attemptId } }) } })
      if (count + pending >= MAX_AUDIO_TRACKS_PER_USER) throw new MediaError('LIMIT_REACHED', `Tu biblioteca ya tiene ${MAX_AUDIO_TRACKS_PER_USER} pistas. Elimina alguna para subir otra.`)
      await assertUserQuota(tx, userId, info.size, 0, direct?.attemptId ?? null)
      const created = await tx.audioTrack.create({
        data: { userId, storageKey: key, name: info.name, format: info.format, contentType: info.contentType, size: info.size, durationMs: info.durationMs, sha256: info.sha256 },
        select: TRACK_SELECT,
      })
      if (direct) await completeAttempt(tx, direct, created.id)
      return created
    })
  } catch (error) {
    if (!direct) await discardUnreferenced(log, key, 'audio:create-failed')
    if ((error as { code?: unknown } | null)?.code === 'P2002') throw new MediaError('DUPLICATE', 'Esta pista ya está en tu biblioteca.')
    throw error
  }
}

export async function removeTrack(log: FastifyBaseLogger | null, userId: string, trackId: string): Promise<void> {
  const key = await prisma.$transaction(async tx => {
    const track = await tx.audioTrack.findFirst({ where: { id: trackId, userId }, select: { storageKey: true } })
    if (!track) throw notFound('La pista')
    await tx.audioTrack.delete({ where: { id: trackId } })
    return track.storageKey
  })
  await drainStorageCleanup(log, [key])
}

/** Pista propia para usarla en un vídeo; null si no existe o es de otro usuario. */
export async function findOwnTrack(userId: string, trackId: string): Promise<{ id: string; name: string } | null> {
  return prisma.audioTrack.findFirst({ where: { id: trackId, userId }, select: { id: true, name: true } })
}

export async function readTrack(userId: string, trackId: string, ifNoneMatch?: string): Promise<{ track: AudioTrackRow; file: StoredObject | null; etag: string }> {
  const track = await prisma.audioTrack.findFirst({ where: { id: trackId, userId }, select: { ...TRACK_SELECT, storageKey: true } })
  if (!track) throw notFound('La pista')
  const { storageKey, ...row } = track
  const etag = `"a-${track.sha256.slice(0, 32)}"`
  if (etagMatches(ifNoneMatch, etag)) return { track: row, file: null, etag }
  const file = await (await getStorage()).get(storageKey)
  if (!file) throw new MediaError('STORAGE_UNAVAILABLE', 'El archivo de la pista no está disponible en este momento.')
  return { track: row, file, etag }
}

/** Clave y tipo de una pista propia, sin leerla (DA-58). */
export async function locateTrack(userId: string, trackId: string): Promise<{ key: string; contentType: string }> {
  const track = await prisma.audioTrack.findFirst({ where: { id: trackId, userId }, select: { storageKey: true, contentType: true } })
  if (!track) throw notFound('La pista')
  return { key: track.storageKey, contentType: track.contentType }
}
