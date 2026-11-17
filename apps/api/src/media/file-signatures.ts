// Identificación de archivos por su contenido (DA-46). El tipo declarado por el cliente y la
// extensión del nombre original no se usan para decidir: solo los bytes. Las imágenes deben tener
// cabeceras analizables con dimensiones razonables (se rechazan archivos truncados, disfrazados o
// «bombas» de descompresión); los vídeos, la firma de su contenedor.

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'
export type VideoType = 'video/webm' | 'video/mp4'

export interface ImageInfo {
  type: ImageType
  width: number
  height: number
}

export const MAX_IMAGE_SIDE = 10_000
export const MAX_IMAGE_PIXELS = 40_000_000

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) return null
    const marker = buf[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = buf.readUInt16BE(offset + 2)
    if (length < 2) return null
    // SOF0-SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return null
}

function webpSize(buf: Buffer): { width: number; height: number } | null {
  const chunk = buf.toString('latin1', 12, 16)
  if (chunk === 'VP8X' && buf.length >= 30) {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
  }
  if (chunk === 'VP8 ' && buf.length >= 30) {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    if (buf[20] !== 0x2f) return null
    const bits = buf.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
  }
  return null
}

/** Tipo y dimensiones reales de una imagen JPEG, PNG o WebP; null si no lo es o no es válida. */
export function sniffImage(buf: Buffer): ImageInfo | null {
  let type: ImageType | null = null
  let size: { width: number; height: number } | null = null
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    type = 'image/jpeg'
    size = jpegSize(buf)
  } else if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.toString('latin1', 12, 16) === 'IHDR') {
    type = 'image/png'
    size = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  } else if (buf.length >= 16 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    type = 'image/webp'
    size = webpSize(buf)
  }
  if (!type || !size) return null
  const { width, height } = size
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) return null
  return { type, width, height }
}

/** Contenedor de vídeo por su firma: WebM (EBML con DocType webm) o MP4 (caja ftyp). */
export function sniffVideo(buf: Buffer): VideoType | null {
  if (buf.length >= 12 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return buf.subarray(0, 64).includes(Buffer.from('webm', 'latin1')) ? 'video/webm' : null
  }
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'video/mp4'
  return null
}

/** Nombre original apto para mostrar: sin rutas, caracteres de control ni separadores; como mucho 120 caracteres. */
export function sanitizeOriginalName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let name = raw
  try {
    name = decodeURIComponent(raw)
  } catch {
    // se usa tal cual
  }
  name = name.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().slice(0, 120)
  return name && name !== '.' && name !== '..' ? name : null
}
