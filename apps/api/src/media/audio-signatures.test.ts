import { describe, expect, it } from 'vitest'

import { makeM4a, makeMp3, makeOgg, makeVideo, makeWav } from '../test-support/media-files.js'
import { makePng } from '../test-support/images.js'
import { sniffAudio } from './audio-signatures.js'

// Formato y duración de las pistas de audio por su contenido real (DA-55).

const near = (value: number | undefined, expected: number, tolerance = 60) => {
  expect(value).toBeGreaterThanOrEqual(expected - tolerance)
  expect(value).toBeLessThanOrEqual(expected + tolerance)
}

describe('identificación de audio', () => {
  it('WAV PCM: formato, canales, frecuencia y duración', () => {
    const info = sniffAudio(makeWav(3.5, { sampleRate: 22050, channels: 2 }))
    expect(info).toMatchObject({ format: 'wav', sampleRate: 22050, channels: 2 })
    near(info?.durationMs, 3500)
  })

  it('MP3 sin cabecera VBR (se cuentan las tramas) y con etiqueta ID3', () => {
    near(sniffAudio(makeMp3(4))?.durationMs, 4000, 40)
    expect(sniffAudio(makeMp3(2, { id3: true }))).toMatchObject({ format: 'mp3', sampleRate: 44100 })
  })

  it('Ogg Vorbis y Ogg Opus: duración a partir de la última página', () => {
    expect(sniffAudio(makeOgg(6, 'vorbis'))).toMatchObject({ format: 'ogg', sampleRate: 44100, durationMs: 6000 })
    expect(sniffAudio(makeOgg(9, 'opus'))).toMatchObject({ format: 'ogg', sampleRate: 48000, durationMs: 9000 })
  })

  it('M4A (AAC): duración del mvhd y pista de sonido', () => {
    expect(sniffAudio(makeM4a(12))).toMatchObject({ format: 'm4a', durationMs: 12000, sampleRate: 44100, channels: 2 })
  })

  it('rechaza lo que no es audio: imagen, vídeo, texto, vacío y binario aleatorio', () => {
    const random = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251))
    for (const bytes of [makePng(), makeVideo('mp4', 3), makeVideo('webm', 3), Buffer.from('<?php echo 1; ?>'), Buffer.alloc(0), random]) {
      expect(sniffAudio(bytes)).toBeNull()
    }
  })

  it('rechaza archivos dañados o truncados', () => {
    const wav = makeWav(2)
    expect(sniffAudio(wav.subarray(0, 30))).toBeNull()
    const noFormat = Buffer.from(wav)
    noFormat.write('xxxx', 12, 'latin1')
    expect(sniffAudio(noFormat)).toBeNull()
    expect(sniffAudio(makeMp3(2).subarray(0, 300))).toBeNull()
    expect(sniffAudio(makeOgg(3).subarray(0, 40))).toBeNull()
    expect(sniffAudio(makeM4a(3).subarray(0, 60))).toBeNull()
  })

  it('un WAV recortado mide solo los datos que contiene', () => {
    const wav = makeWav(4)
    near(sniffAudio(wav.subarray(0, 44 + 8000 * 2))?.durationMs, 1000)
  })
})
