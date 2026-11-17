import { describe, expect, it } from 'vitest'

import { makeJpeg, makeMp4, makePng, makeWebm, makeWebp } from '../test-support/images.js'
import { sanitizeOriginalName, sniffImage, sniffVideo } from './file-signatures.js'

describe('identificación de imágenes por su contenido', () => {
  it.each([
    ['PNG', makePng(64, 48), 'image/png', 64, 48],
    ['JPEG', makeJpeg(640, 480), 'image/jpeg', 640, 480],
    ['WebP', makeWebp(800, 600), 'image/webp', 800, 600],
  ])('%s válido: tipo y dimensiones reales', (_label, buf, type, width, height) => {
    expect(sniffImage(buf)).toEqual({ type, width, height })
  })

  it.each([
    ['texto con extensión .jpg', Buffer.from('no soy una imagen')],
    ['SVG (podría contener código)', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['ejecutable de Windows', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)])],
    ['GIF (formato no admitido)', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')],
    ['JPEG truncado sin SOF', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
    ['PNG con dimensiones absurdas (bomba)', makePng(64, 48).fill(0xff, 16, 24)],
    ['WebP con 20.000 px de lado', makeWebp(20_000, 100)],
    ['vacío', Buffer.alloc(0)],
  ])('%s: rechazado', (_label, buf) => {
    expect(sniffImage(buf)).toBeNull()
  })
})

describe('identificación de vídeos', () => {
  it('WebM y MP4 por su firma', () => {
    expect(sniffVideo(makeWebm())).toBe('video/webm')
    expect(sniffVideo(makeMp4())).toBe('video/mp4')
  })

  it('otro contenido no es un vídeo', () => {
    expect(sniffVideo(makePng())).toBeNull()
    expect(sniffVideo(Buffer.from('1a45dfa3 no es binario'))).toBeNull()
    expect(sniffVideo(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(60)]))).toBeNull()
  })
})

describe('nombre original', () => {
  it.each([
    ['salón.jpg', 'salón.jpg'],
    ['..%2F..%2Fetc%2Fpasswd', 'passwd'],
    ['C:\\fotos\\cocina.png', 'cocina.png'],
    ['<script>x.jpg', 'scriptx.jpg'],
    ['..', null],
    [123, null],
    ['a'.repeat(300) + '.jpg', 'a'.repeat(120)],
  ])('%s → %s', (raw, expected) => {
    expect(sanitizeOriginalName(raw)).toBe(expected)
  })
})
