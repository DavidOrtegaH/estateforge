// Errores esperables de la galería, del material publicitario y de la biblioteca de audio. El mensaje se muestra al usuario:
// nunca incluye claves de almacenamiento, rutas ni datos de otros usuarios.

export type MediaErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_FILE'
  | 'TYPE_MISMATCH'
  | 'TOO_LARGE'
  | 'LIMIT_REACHED'
  | 'DUPLICATE'
  | 'INVALID_ORDER'
  | 'INVALID_REQUEST'
  | 'NO_PHOTOS'
  | 'SOURCE_CHANGED'
  | 'VERSION_CONFLICT'
  | 'STORAGE_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'UPLOAD_EXPIRED'
  | 'UPLOAD_CLOSED'
  | 'UPLOAD_MISSING'
  | 'DIRECT_UPLOAD_REQUIRED'

const STATUS: Record<MediaErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_FILE: 400,
  TYPE_MISMATCH: 415,
  TOO_LARGE: 413,
  LIMIT_REACHED: 409,
  DUPLICATE: 409,
  INVALID_ORDER: 400,
  INVALID_REQUEST: 400,
  NO_PHOTOS: 409,
  SOURCE_CHANGED: 409,
  VERSION_CONFLICT: 409,
  STORAGE_UNAVAILABLE: 503,
  QUOTA_EXCEEDED: 409,
  UPLOAD_EXPIRED: 410,
  UPLOAD_CLOSED: 409,
  UPLOAD_MISSING: 409,
  DIRECT_UPLOAD_REQUIRED: 409,
}

export class MediaError extends Error {
  readonly status: number

  constructor(readonly code: MediaErrorCode, message: string) {
    super(message)
    this.name = 'MediaError'
    this.status = STATUS[code]
  }
}

export const notFound = (what = 'El recurso') => new MediaError('NOT_FOUND', `${what} no existe o no es tuyo.`)
