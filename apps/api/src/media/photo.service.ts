import { createHash } from 'node:crypto'

import type { FastifyBaseLogger } from 'fastify'

import { MAX_PROPERTY_PHOTOS, PHOTO_MAX_BYTES, PROPERTY_PHOTOS_MAX_TOTAL_BYTES, THUMBNAIL_MAX_BYTES, THUMBNAIL_MAX_SIDE, isPhotoType } from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { getStorage, photoKey, thumbKey, type StoredObject } from '../storage/object-storage.js'
import { sanitizeOriginalName, sniffImage } from './file-signatures.js'
import { completeAttempt, type DirectCommit } from './direct.js'
import { MediaError, notFound } from './media-errors.js'
import { assertUserQuota, lockUser } from './quota.js'
import { discardUnreferenced, drainStorageCleanup } from './storage-cleanup.js'

// Galería de un inmueble (hasta 50 fotografías, DA-51). Toda escritura bloquea el usuario (cuota) y la
// fila del inmueble con la condición de propiedad (UPDATE … WHERE id AND userId): un inmueble ajeno da
// 0 filas y se responde 404, sin revelar si existe. El archivo nuevo se sube antes de la transacción
// con una clave única; si la transacción falla, se descarta. El archivo antiguo solo se borra tras el
// commit (cola de limpieza). Cada fotografía puede tener una miniatura JPEG que genera la web; si no
// la tiene, se sirve la original.

type Tx = Prisma.TransactionClient

const PHOTO_SELECT = {
  id: true,
  propertyId: true,
  originalName: true,
  contentType: true,
  size: true,
  width: true,
  height: true,
  sha256: true,
  position: true,
  isPrimary: true,
  thumbSize: true,
  createdAt: true,
  updatedAt: true,
} as const

export type PhotoRow = Prisma.PropertyPhotoGetPayload<{ select: typeof PHOTO_SELECT }>

export interface PhotoUpload {
  body: Buffer
  declaredType: string | undefined
  originalName: unknown
}

async function lockOwnedProperty(tx: Tx, propertyId: string, userId: string): Promise<void> {
  const locked = await tx.$executeRaw`UPDATE "Property" SET "userId" = "userId" WHERE "id" = ${propertyId} AND "userId" = ${userId}`
  if (locked !== 1) throw notFound('El inmueble')
}

/** Bloquea el usuario y su inmueble, en este orden (ver quota.ts). */
async function lockForWrite(tx: Tx, propertyId: string, userId: string): Promise<void> {
  await lockUser(tx, userId)
  await lockOwnedProperty(tx, propertyId, userId)
}

async function assertOwnedProperty(propertyId: string, userId: string): Promise<void> {
  const owned = await prisma.property.count({ where: { id: propertyId, userId } })
  if (owned !== 1) throw notFound('El inmueble')
}

/** Valida el contenido real (no el tipo declarado ni la extensión) y calcula el SHA-256. */
export function inspectPhoto(upload: PhotoUpload) {
  if (upload.body.length === 0) throw new MediaError('INVALID_FILE', 'El archivo está vacío.')
  if (upload.body.length > PHOTO_MAX_BYTES) throw new MediaError('TOO_LARGE', 'La fotografía supera el tamaño máximo de 4 MB.')
  const image = sniffImage(upload.body)
  if (!image) throw new MediaError('INVALID_FILE', 'El archivo no es una imagen JPEG, PNG o WebP válida.')
  if (!isPhotoType(upload.declaredType) || upload.declaredType !== image.type) {
    throw new MediaError('TYPE_MISMATCH', 'El tipo del archivo no coincide con su contenido.')
  }
  return { ...image, size: upload.body.length, sha256: createHash('sha256').update(upload.body).digest('hex'), originalName: sanitizeOriginalName(upload.originalName) }
}

export async function listPhotos(propertyId: string, userId: string): Promise<PhotoRow[]> {
  await assertOwnedProperty(propertyId, userId)
  return prisma.propertyPhoto.findMany({ where: { propertyId }, orderBy: { position: 'asc' }, select: PHOTO_SELECT })
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002'
}

const LIMIT_MESSAGE = `El inmueble ya tiene ${MAX_PROPERTY_PHOTOS} fotografías.`
const TOTAL_MESSAGE = `Las fotografías de un inmueble no pueden superar ${PROPERTY_PHOTOS_MAX_TOTAL_BYTES / 1024 / 1024} MB en total.`

/** Límite de 50 y suma máxima por inmueble, con el inmueble bloqueado. `replacing` se descuenta. */
export async function assertPropertyCapacity(tx: Tx, propertyId: string, incoming: { size: number; adds: boolean; replacingSize?: number; exceptAttemptId?: string | null }) {
  const agg = await tx.propertyPhoto.aggregate({ where: { propertyId }, _count: { _all: true }, _sum: { size: true } })
  // Subidas directas pendientes y vigentes de fotografías nuevas de este inmueble: reservan su hueco.
  const pending = await tx.uploadAttempt.aggregate({
    where: { propertyId, kind: 'photo', status: { in: ['pending', 'processing'] }, expiresAt: { gt: new Date() }, ...(incoming.exceptAttemptId && { NOT: { id: incoming.exceptAttemptId } }) },
    _count: { _all: true },
    _sum: { size: true },
  })
  const count = agg._count._all
  if (incoming.adds && count + pending._count._all >= MAX_PROPERTY_PHOTOS) throw new MediaError('LIMIT_REACHED', LIMIT_MESSAGE)
  if ((agg._sum.size ?? 0) + (pending._sum.size ?? 0) - (incoming.replacingSize ?? 0) + incoming.size > PROPERTY_PHOTOS_MAX_TOTAL_BYTES) throw new MediaError('LIMIT_REACHED', TOTAL_MESSAGE)
  return count
}

export async function addPhoto(log: FastifyBaseLogger | null, userId: string, propertyId: string, upload: PhotoUpload, direct?: DirectCommit): Promise<PhotoRow> {
  const info = inspectPhoto(upload)
  // Comprobaciones previas para no subir archivos que se van a rechazar; se repiten con el bloqueo.
  await assertOwnedProperty(propertyId, userId)
  const existing = await prisma.propertyPhoto.findMany({ where: { propertyId }, select: { sha256: true, size: true } })
  if (existing.length >= MAX_PROPERTY_PHOTOS) throw new MediaError('LIMIT_REACHED', LIMIT_MESSAGE)
  if (existing.some(photo => photo.sha256 === info.sha256)) throw new MediaError('DUPLICATE', 'Esta fotografía ya está en la galería.')
  if (existing.reduce((sum, photo) => sum + photo.size, 0) + info.size > PROPERTY_PHOTOS_MAX_TOTAL_BYTES) throw new MediaError('LIMIT_REACHED', TOTAL_MESSAGE)

  const key = direct?.key ?? photoKey(userId, propertyId, info.type)
  if (!direct) await (await getStorage()).put(key, upload.body, info.type)
  try {
    return await prisma.$transaction(async tx => {
      await lockForWrite(tx, propertyId, userId)
      const count = await assertPropertyCapacity(tx, propertyId, { size: info.size, adds: true, exceptAttemptId: direct?.attemptId })
      await assertUserQuota(tx, userId, info.size, 0, direct?.attemptId ?? null)
      const created = await tx.propertyPhoto.create({
        data: {
          propertyId,
          storageKey: key,
          originalName: info.originalName,
          contentType: info.type,
          size: info.size,
          width: info.width,
          height: info.height,
          sha256: info.sha256,
          position: count,
          isPrimary: count === 0,
        },
        select: PHOTO_SELECT,
      })
      if (direct) await completeAttempt(tx, direct, created.id)
      return created
    })
  } catch (error) {
    // En una subida directa, el intento fallido encola su archivo (upload.service.ts).
    if (!direct) await discardUnreferenced(log, key, 'photo:create-failed')
    if (isUniqueViolation(error)) throw new MediaError('DUPLICATE', 'Esta fotografía ya está en la galería.')
    throw error
  }
}

export async function replacePhoto(log: FastifyBaseLogger | null, userId: string, propertyId: string, photoId: string, upload: PhotoUpload, direct?: DirectCommit): Promise<PhotoRow> {
  const info = inspectPhoto(upload)
  await assertOwnedProperty(propertyId, userId)
  const current = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { id: true } })
  if (!current) throw notFound('La fotografía')

  const key = direct?.key ?? photoKey(userId, propertyId, info.type)
  if (!direct) await (await getStorage()).put(key, upload.body, info.type)
  let oldKeys: string[]
  let updated: PhotoRow
  try {
    ;({ oldKeys, updated } = await prisma.$transaction(async tx => {
      await lockForWrite(tx, propertyId, userId)
      const photo = await tx.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { storageKey: true, thumbKey: true, size: true, thumbSize: true } })
      if (!photo) throw notFound('La fotografía')
      await assertPropertyCapacity(tx, propertyId, { size: info.size, adds: false, replacingSize: photo.size, exceptAttemptId: direct?.attemptId })
      await assertUserQuota(tx, userId, info.size, photo.size + (photo.thumbSize ?? 0), direct?.attemptId ?? null)
      // La miniatura anterior ya no corresponde: se retira (el trigger la encola) y la web genera otra.
      const row = await tx.propertyPhoto.update({
        where: { id: photoId },
        data: { storageKey: key, originalName: info.originalName, contentType: info.type, size: info.size, width: info.width, height: info.height, sha256: info.sha256, thumbKey: null, thumbSize: null },
        select: PHOTO_SELECT,
      })
      if (direct) await completeAttempt(tx, direct, row.id)
      return { oldKeys: [photo.storageKey, ...(photo.thumbKey ? [photo.thumbKey] : [])], updated: row }
    }))
  } catch (error) {
    if (!direct) await discardUnreferenced(log, key, 'photo:replace-failed')
    if (isUniqueViolation(error)) throw new MediaError('DUPLICATE', 'Esta fotografía ya está en la galería.')
    throw error
  }
  // Los triggers han encolado los archivos anteriores; se borran ahora, y si falla quedan pendientes.
  await drainStorageCleanup(log, oldKeys)
  return updated
}

/**
 * Miniatura de una fotografía (DA-51): JPEG generado por la web, de 480 px como máximo en el lado
 * mayor y con la misma proporción que la fotografía. Sustituye a la anterior si existía.
 */
export async function setPhotoThumbnail(log: FastifyBaseLogger | null, userId: string, propertyId: string, photoId: string, upload: { body: Buffer; declaredType: string | undefined }, direct?: DirectCommit): Promise<PhotoRow> {
  if (upload.body.length === 0) throw new MediaError('INVALID_FILE', 'La miniatura está vacía.')
  if (upload.body.length > THUMBNAIL_MAX_BYTES) throw new MediaError('TOO_LARGE', 'La miniatura supera el tamaño máximo.')
  const image = sniffImage(upload.body)
  if (!image || image.type !== 'image/jpeg') throw new MediaError('INVALID_FILE', 'La miniatura debe ser una imagen JPEG válida.')
  if (upload.declaredType !== 'image/jpeg') throw new MediaError('TYPE_MISMATCH', 'El tipo del archivo no coincide con su contenido.')
  if (Math.max(image.width, image.height) > THUMBNAIL_MAX_SIDE) throw new MediaError('INVALID_FILE', 'La miniatura es demasiado grande.')
  await assertOwnedProperty(propertyId, userId)
  const photo = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { width: true, height: true } })
  if (!photo) throw notFound('La fotografía')
  const ratio = (w: number, h: number) => w / h
  if (Math.abs(ratio(image.width, image.height) / ratio(photo.width, photo.height) - 1) > 0.05) throw new MediaError('INVALID_FILE', 'La miniatura no corresponde a la fotografía.')

  const key = direct?.key ?? thumbKey(userId, propertyId)
  if (!direct) await (await getStorage()).put(key, upload.body, 'image/jpeg')
  let oldKey: string | null
  let updated: PhotoRow
  try {
    ;({ oldKey, updated } = await prisma.$transaction(async tx => {
      await lockForWrite(tx, propertyId, userId)
      const current = await tx.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { thumbKey: true, thumbSize: true, width: true, height: true } })
      // Si se ha sustituido la fotografía mientras tanto, la miniatura ya no corresponde.
      if (!current || current.width !== photo.width || current.height !== photo.height) throw notFound('La fotografía')
      await assertUserQuota(tx, userId, upload.body.length, current.thumbSize ?? 0, direct?.attemptId ?? null)
      const row = await tx.propertyPhoto.update({ where: { id: photoId }, data: { thumbKey: key, thumbSize: upload.body.length }, select: PHOTO_SELECT })
      if (direct) await completeAttempt(tx, direct, row.id)
      return { oldKey: current.thumbKey, updated: row }
    }))
  } catch (error) {
    if (!direct) await discardUnreferenced(log, key, 'thumb:save-failed')
    throw error
  }
  if (oldKey) await drainStorageCleanup(log, [oldKey])
  return updated
}

export async function removePhoto(log: FastifyBaseLogger | null, userId: string, propertyId: string, photoId: string): Promise<void> {
  const oldKeys = await prisma.$transaction(async tx => {
    await lockForWrite(tx, propertyId, userId)
    const photo = await tx.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { storageKey: true, thumbKey: true, position: true, isPrimary: true } })
    if (!photo) throw notFound('La fotografía')
    await tx.propertyPhoto.delete({ where: { id: photoId } })
    await tx.propertyPhoto.updateMany({ where: { propertyId, position: { gt: photo.position } }, data: { position: { decrement: 1 } } })
    if (photo.isPrimary) {
      const next = await tx.propertyPhoto.findFirst({ where: { propertyId }, orderBy: { position: 'asc' }, select: { id: true } })
      if (next) await tx.propertyPhoto.update({ where: { id: next.id }, data: { isPrimary: true } })
    }
    return [photo.storageKey, ...(photo.thumbKey ? [photo.thumbKey] : [])]
  })
  await drainStorageCleanup(log, oldKeys)
}

export async function reorderPhotos(userId: string, propertyId: string, photoIds: string[]): Promise<PhotoRow[]> {
  return prisma.$transaction(async tx => {
    await lockOwnedProperty(tx, propertyId, userId)
    const current = await tx.propertyPhoto.findMany({ where: { propertyId }, select: { id: true, position: true } })
    const ids = new Set(current.map(photo => photo.id))
    if (photoIds.length !== ids.size || new Set(photoIds).size !== photoIds.length || photoIds.some(id => !ids.has(id))) {
      throw new MediaError('INVALID_ORDER', 'El orden debe incluir exactamente las fotografías actuales del inmueble.')
    }
    // Solo se actualizan las que cambian de lugar: con 50 fotografías, mover una es una o dos escrituras.
    const positions = new Map(current.map(photo => [photo.id, photo.position]))
    for (const [position, id] of photoIds.entries()) {
      if (positions.get(id) !== position) await tx.propertyPhoto.update({ where: { id }, data: { position } })
    }
    return tx.propertyPhoto.findMany({ where: { propertyId }, orderBy: { position: 'asc' }, select: PHOTO_SELECT })
  })
}

export async function setPrimaryPhoto(userId: string, propertyId: string, photoId: string): Promise<PhotoRow[]> {
  return prisma.$transaction(async tx => {
    await lockOwnedProperty(tx, propertyId, userId)
    const photo = await tx.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { id: true } })
    if (!photo) throw notFound('La fotografía')
    // Primero se quita la actual: el índice parcial no admite dos principales a la vez.
    await tx.propertyPhoto.updateMany({ where: { propertyId, isPrimary: true, NOT: { id: photoId } }, data: { isPrimary: false } })
    await tx.propertyPhoto.update({ where: { id: photoId }, data: { isPrimary: true } })
    return tx.propertyPhoto.findMany({ where: { propertyId }, orderBy: { position: 'asc' }, select: PHOTO_SELECT })
  })
}

/**
 * Archivo de una fotografía propia (o su miniatura, si se pide y existe). Si el navegador ya tiene
 * esta misma versión (If-None-Match), devuelve file = null sin leer el almacenamiento: la propiedad
 * se ha comprobado igualmente.
 */
export async function readPhoto(userId: string, propertyId: string, photoId: string, ifNoneMatch?: string, size: 'full' | 'thumb' = 'full'): Promise<{ photo: PhotoRow; file: StoredObject | null; etag: string; contentType: string }> {
  const photo = await prisma.propertyPhoto.findFirst({
    where: { id: photoId, propertyId, property: { userId } },
    select: { ...PHOTO_SELECT, storageKey: true, thumbKey: true },
  })
  if (!photo) throw notFound('La fotografía')
  const { storageKey, thumbKey: thumb, ...row } = photo
  const useThumb = size === 'thumb' && thumb !== null
  const etag = useThumb ? `"t-${photo.sha256.slice(0, 32)}-${photo.thumbSize}"` : `"p-${photo.sha256.slice(0, 32)}"`
  const contentType = useThumb ? 'image/jpeg' : photo.contentType
  if (etagMatches(ifNoneMatch, etag)) return { photo: row, file: null, etag, contentType }
  const file = await (await getStorage()).get(useThumb ? thumb : storageKey)
  if (!file) throw new MediaError('STORAGE_UNAVAILABLE', 'El archivo de la fotografía no está disponible en este momento.')
  return { photo: row, file, etag, contentType }
}

/** Compara If-None-Match (lista, «W/» o «*») con la etiqueta de la versión actual. */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header.split(',').some(value => {
    const tag = value.trim()
    return tag === '*' || tag === etag || tag === `W/${etag}`
  })
}

/** Clave y tipo del archivo de una fotografía propia (o de su miniatura), sin leerlo (DA-58). */
export async function locatePhoto(userId: string, propertyId: string, photoId: string, size: 'full' | 'thumb' = 'full'): Promise<{ key: string; contentType: string }> {
  const photo = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId, property: { userId } }, select: { storageKey: true, thumbKey: true, contentType: true } })
  if (!photo) throw notFound('La fotografía')
  return size === 'thumb' && photo.thumbKey ? { key: photo.thumbKey, contentType: 'image/jpeg' } : { key: photo.storageKey, contentType: photo.contentType }
}
