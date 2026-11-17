// Quita los metadatos de las fotografías antes de enviarlas a un proveedor (DA-74): EXIF (incluida la
// geolocalización), XMP, IPTC y comentarios. No recodifica la imagen: solo elimina segmentos o
// fragmentos de metadatos, conservando los píxeles. Si el formato no se reconoce, no se envía.

/** JPEG: elimina APP1-APP15 (EXIF, XMP, IPTC…) y COM; conserva APP0 (JFIF) y los datos de imagen. */
function stripJpeg(input: Buffer): Buffer | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null
  const parts: Buffer[] = [input.subarray(0, 2)]
  let pos = 2
  while (pos + 4 <= input.length) {
    if (input[pos] !== 0xff) return null
    const marker = input[pos + 1]
    // Inicio del escaneo: el resto (datos comprimidos y EOI) se copia tal cual.
    if (marker === 0xda) {
      parts.push(input.subarray(pos))
      return Buffer.concat(parts)
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(input.subarray(pos, pos + 2))
      pos += 2
      continue
    }
    const length = input.readUInt16BE(pos + 2)
    if (length < 2 || pos + 2 + length > input.length) return null
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
    if (!isMetadata) parts.push(input.subarray(pos, pos + 2 + length))
    pos += 2 + length
  }
  return null
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_METADATA = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'])

/** PNG: elimina los fragmentos de texto, EXIF y fecha. */
function stripPng(input: Buffer): Buffer | null {
  if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  const parts: Buffer[] = [PNG_SIGNATURE]
  let pos = 8
  while (pos + 12 <= input.length) {
    const length = input.readUInt32BE(pos)
    const type = input.toString('latin1', pos + 4, pos + 8)
    const end = pos + 12 + length
    if (end > input.length) return null
    if (!PNG_METADATA.has(type)) parts.push(input.subarray(pos, end))
    pos = end
    if (type === 'IEND') return Buffer.concat(parts)
  }
  return null
}

/** WebP: elimina los fragmentos EXIF y XMP y corrige el tamaño RIFF y los indicadores de VP8X. */
function stripWebp(input: Buffer): Buffer | null {
  if (input.length < 12 || input.toString('latin1', 0, 4) !== 'RIFF' || input.toString('latin1', 8, 12) !== 'WEBP') return null
  const parts: Buffer[] = []
  let pos = 12
  while (pos + 8 <= input.length) {
    const type = input.toString('latin1', pos, pos + 4)
    const size = input.readUInt32LE(pos + 4)
    const end = pos + 8 + size + (size % 2)
    if (end > input.length + 1) return null
    const chunk = Buffer.from(input.subarray(pos, Math.min(end, input.length)))
    if (type === 'VP8X' && chunk.length >= 9) chunk[8] &= ~(0x08 | 0x04) // sin indicadores EXIF ni XMP
    if (type !== 'EXIF' && type !== 'XMP ') parts.push(chunk)
    pos = end
  }
  const body = Buffer.concat(parts)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('WEBP', 8, 'latin1')
  return Buffer.concat([header, body])
}

export function stripImageMetadata(input: Buffer, mimeType: string): Buffer | null {
  if (mimeType === 'image/jpeg') return stripJpeg(input)
  if (mimeType === 'image/png') return stripPng(input)
  if (mimeType === 'image/webp') return stripWebp(input)
  return null
}
