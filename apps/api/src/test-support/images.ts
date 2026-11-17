import { crc32, deflateSync } from 'node:zlib'

// Imágenes y contenedores sintéticos para las pruebas: nada procede de fotografías reales.

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, crc])
}

// Semilla única para las imágenes de prueba (MD-43). Antes se sumaba un número aleatorio a un índice
// («1000 + i + aleatorio»): dos fotografías del mismo inmueble podían recibir la misma semilla, salir
// idénticas y hacer que la API rechazara la segunda por duplicada (409), con razón. Un contador no repite.
// Empieza muy por encima de las semillas literales que usan las pruebas.
let nextSeed = 10_000_000

export function uniqueSeed(): number {
  nextSeed += 1
  return nextSeed
}

/** PNG RGB válido de width×height con un degradado que depende de seed (cada seed da otro archivo). */
export function makePng(width = 64, height = 48, seed = 1): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // profundidad
  header[9] = 2 // RGB
  const rows: Buffer[] = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = (x * 4 + seed * 37) & 0xff
      row[2 + x * 3] = (y * 4 + seed * 11) & 0xff
      row[3 + x * 3] = (seed * 53) & 0xff
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    // La semilla completa en un bloque de texto: dos semillas distintas nunca dan el mismo archivo.
    chunk('tEXt', Buffer.from(`seed\0${seed}`, 'latin1')),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Cabecera JPEG mínima con un segmento SOF0 de width×height (suficiente para identificarla). */
export function makeJpeg(width = 640, height = 480, seed = 1): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([seed & 0xff, 0xff, 0xd9])])
}

/** Cabecera WebP extendida (VP8X) de width×height. */
export function makeWebp(width = 800, height = 600): Buffer {
  const vp8x = Buffer.alloc(18)
  vp8x.write('VP8X', 0, 'latin1')
  vp8x.writeUInt32LE(10, 4)
  vp8x.writeUIntLE(width - 1, 12, 3)
  vp8x.writeUIntLE(height - 1, 15, 3)
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'latin1')
  riff.writeUInt32LE(4 + vp8x.length, 4)
  riff.write('WEBP', 8, 'latin1')
  return Buffer.concat([riff, vp8x])
}

/** Inicio de un archivo WebM (cabecera EBML con DocType webm) seguido de relleno. */
export function makeWebm(size = 2048, seed = 1): Buffer {
  const header = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])
  return Buffer.concat([header, Buffer.alloc(size - header.length, seed & 0xff)])
}

/** Inicio de un MP4 (caja ftyp) seguido de relleno. */
export function makeMp4(size = 2048, seed = 1): Buffer {
  const ftyp = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31])
  return Buffer.concat([ftyp, Buffer.alloc(size - ftyp.length, seed & 0xff)])
}
