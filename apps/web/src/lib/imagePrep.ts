import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, THUMBNAIL_MAX_BYTES, THUMBNAIL_MAX_SIDE, isPhotoType } from '@estateforge/shared'

// Preparación de fotografías en el navegador antes de subirlas (DA-46, DA-51). Mejora la experiencia,
// pero no sustituye a la API, que vuelve a comprobar el contenido real, el tipo y el tamaño.

/** Tamaño máximo que se acepta para intentar reducir una fotografía en el navegador. */
export const PHOTO_INPUT_MAX_BYTES = 25 * 1024 * 1024

/** Calidades JPEG que se prueban, de mayor a menor, hasta caber en el tamaño máximo. */
export const PHOTO_QUALITIES = [0.9, 0.85, 0.8, 0.72, 0.65] as const
export const THUMBNAIL_QUALITIES = [0.82, 0.74, 0.66] as const

/** Subidas simultáneas de la galería: suficientes para no esperar en serie, sin saturar la conexión. */
export const UPLOAD_CONCURRENCY = 3

export function validatePhotoFile(file: { name: string; type: string; size: number }): string | null {
  if (!isPhotoType(file.type)) return `«${file.name}» no es una imagen JPEG, PNG o WebP.`
  if (file.size === 0) return `«${file.name}» está vacío.`
  if (file.size > PHOTO_INPUT_MAX_BYTES) return `«${file.name}» supera los 25 MB.`
  return null
}

/** Dimensiones reducidas para que el lado mayor no supere max (sin ampliar nunca). */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Clave para no subir dos veces el mismo archivo en una misma selección. */
export const fileKey = (file: { name: string; size: number; lastModified?: number }) => `${file.name}|${file.size}|${file.lastModified ?? 0}`

async function encode(bitmap: ImageBitmap, target: { width: number; height: number }, qualities: readonly number[], maxBytes: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite procesar la imagen.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, target.width, target.height)
  try {
    for (const quality of qualities) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= maxBytes) return blob
    }
    return null
  } finally {
    // Libera la memoria del lienzo enseguida: con 50 fotografías se nota.
    canvas.width = 0
    canvas.height = 0
  }
}

export interface PreparedPhoto {
  file: Blob
  thumbnail: Blob | null
}

/**
 * Fotografía lista para subir (la original si ya cumple, o reducida y recodificada en JPEG) y su
 * miniatura. Se decodifica una sola vez y se libera al terminar.
 */
export async function prepareForUpload(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const target = fitWithin(bitmap.width, bitmap.height)
    let prepared: Blob = file
    if (file.size > PHOTO_MAX_BYTES || target.width !== bitmap.width || target.height !== bitmap.height) {
      const reduced = await encode(bitmap, target, PHOTO_QUALITIES, PHOTO_MAX_BYTES)
      if (!reduced) throw new Error(`«${file.name}» no se ha podido reducir por debajo de 4 MB.`)
      prepared = reduced
    }
    const thumbnail = await encode(bitmap, fitWithin(bitmap.width, bitmap.height, THUMBNAIL_MAX_SIDE), THUMBNAIL_QUALITIES, THUMBNAIL_MAX_BYTES).catch(() => null)
    return { file: prepared, thumbnail }
  } finally {
    bitmap.close()
  }
}

/** Miniatura de una fotografía ya subida (para las que no la tienen todavía). */
export async function makeThumbnail(blob: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(blob)
  try {
    return await encode(bitmap, fitWithin(bitmap.width, bitmap.height, THUMBNAIL_MAX_SIDE), THUMBNAIL_QUALITIES, THUMBNAIL_MAX_BYTES)
  } finally {
    bitmap.close()
  }
}

/**
 * Ejecuta tareas con un máximo de `limit` a la vez, en orden de llegada. Un fallo no detiene al resto:
 * cada tarea informa de su resultado.
 */
export async function runPool<T>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      await task(items[index], index)
    }
  })
  await Promise.all(workers)
}
