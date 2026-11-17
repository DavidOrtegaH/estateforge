import { describe, expect, it } from 'vitest'

import { fixVideoDuration, inspectVideoContainer } from './container.js'
import { pickUniform, POSTER_TEMPLATES, POSTER_TEMPLATE_IDS, audioFormatOfName, audioFormatOfType, findPosterTemplate } from './media.js'

// Archivos sintéticos con la misma estructura que los de MediaRecorder: MP4 fragmentado (moov sin
// duración + moof/mdat) y WebM en directo (segmento y clusters de tamaño desconocido, sin Duration).

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const str = (s: string) => [...s].map(c => c.charCodeAt(0))
function box(type: string, ...parts: number[][]): number[] {
  const body = parts.flat()
  return [...u32(8 + body.length), ...str(type), ...body]
}
const full = (version: number, flags: number) => [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]

function trak(id: number, handler: 'vide' | 'soun', timescale: number, codec: string) {
  return box(
    'trak',
    box('tkhd', full(0, 3), u32(0), u32(0), u32(id), u32(0), u32(0), Array.from({ length: 60 }, () => 0)),
    box(
      'mdia',
      box('mdhd', full(0, 0), u32(0), u32(0), u32(timescale), u32(0), [0x55, 0xc4, 0, 0]),
      box('hdlr', full(0, 0), u32(0), str(handler), Array.from({ length: 12 }, () => 0), [0]),
      box('minf', box('stbl', box('stsd', full(0, 0), u32(1), box(codec, Array.from({ length: 8 }, () => 0))))),
    ),
  )
}

/** MP4 fragmentado: vídeo a 30 fps (escala 30000, 1000 por muestra) y, si se pide, audio a 48 kHz. */
function fragmentedMp4(seconds: number, withAudio: boolean, baseOffsetFlag = false) {
  const tracks = [trak(1, 'vide', 30000, 'avc1'), ...(withAudio ? [trak(2, 'soun', 48000, 'mp4a')] : [])]
  const moov = box(
    'moov',
    box('mvhd', full(0, 0), u32(0), u32(0), u32(1000), u32(0), Array.from({ length: 80 }, () => 0)),
    ...tracks,
    box('mvex', box('trex', full(0, 0), u32(1), u32(1), u32(0), u32(0), u32(0)), ...(withAudio ? [box('trex', full(0, 0), u32(2), u32(1), u32(1024), u32(0), u32(0))] : [])),
  )
  const out = [...box('ftyp', str('isom'), u32(512), str('isomiso2avc1mp41')), ...moov]
  const fragments = Math.ceil(seconds)
  for (let f = 0; f < fragments; f += 1) {
    const frames = Math.min(30, Math.round((seconds - f) * 30))
    const videoTraf = box(
      'traf',
      box('tfhd', full(0, baseOffsetFlag ? 0x1 : 0x020000), u32(1), ...(baseOffsetFlag ? [u32(0), u32(0)] : [])),
      box('tfdt', full(1, 0), u32(0), u32(f * 30000)),
      box('trun', full(0, 0x301), u32(frames), u32(0), ...Array.from({ length: frames }, () => [...u32(1000), ...u32(10)])),
    )
    const audioFrames = Math.round(((frames / 30) * 48000) / 1024)
    const audioTraf = withAudio
      ? box('traf', box('tfhd', full(0, 0x020000), u32(2)), box('tfdt', full(1, 0), u32(0), u32(f * 48000)), box('trun', full(0, 0x201), u32(audioFrames), u32(0), ...Array.from({ length: audioFrames }, () => u32(4))))
      : []
    out.push(...box('moof', box('mfhd', full(0, 0), u32(f + 1)), videoTraf, audioTraf), ...box('mdat', Array.from({ length: 64 }, () => 1)))
  }
  return new Uint8Array(out)
}

// EBML: id + tamaño (vint) + datos.
const vint = (n: number) => (n < 127 ? [0x80 | n] : [0x40 | (n >> 8), n & 255])
const el = (id: number[], ...data: number[][]) => {
  const body = data.flat()
  return [...id, ...vint(body.length), ...body]
}
const unknown = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

// firefox: forma del WebM de MediaRecorder en Firefox 160 (SeekHead vacío, Duration de 8 bytes a 0, VP8).
function liveWebm(seconds: number, withAudio: boolean, extra: number[] = [], firefox = false) {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], str('webm')))
  const info = firefox
    ? el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), el([0x44, 0x89], [0, 0, 0, 0, 0, 0, 0, 0]), el([0x4d, 0x80], str('Firefox')))
    : el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), el([0x4d, 0x80], str('Chrome')))
  const tracks = el(
    [0x16, 0x54, 0xae, 0x6b],
    el([0xae], el([0xd7], [1]), el([0x83], [1]), el([0x86], str(firefox ? 'V_VP8' : 'V_VP9'))),
    ...(withAudio ? [el([0xae], el([0xd7], [2]), el([0x83], [2]), el([0x86], str('A_OPUS')))] : []),
  )
  const clusters: number[] = []
  for (let c = 0; c < Math.ceil(seconds); c += 1) {
    const blocks: number[] = []
    const frames = Math.min(30, Math.round((seconds - c) * 30))
    for (let i = 0; i < frames; i += 1) {
      const rel = Math.round((i * 1000) / 30)
      blocks.push(...el([0xa3], [0x81, (rel >> 8) & 255, rel & 255, 0x80, 1, 2, 3]))
      if (withAudio && i % 3 === 0) blocks.push(...el([0xa3], [0x82, (rel >> 8) & 255, rel & 255, 0x80, 4]))
    }
    clusters.push(0x1f, 0x43, 0xb6, 0x75, ...unknown, ...el([0xe7], [(c * 1000) >> 8, (c * 1000) & 255]), ...blocks)
  }
  return new Uint8Array([...header, 0x18, 0x53, 0x80, 0x67, ...unknown, ...extra, ...info, ...tracks, ...clusters])
}

describe('contenedores de MediaRecorder (DA-56)', () => {
  it('MP4 fragmentado: pistas, códecs y duración real a partir de las muestras', () => {
    const info = inspectVideoContainer(fragmentedMp4(19, true))
    expect(info).toMatchObject({ container: 'video/mp4', hasVideo: true, hasAudio: true, headerDurationMs: 0, videoCodec: 'avc1', audioCodec: 'mp4a' })
    expect(info!.durationMs).toBeGreaterThanOrEqual(18_990)
    expect(info!.durationMs).toBeLessThanOrEqual(19_050)
    expect(inspectVideoContainer(fragmentedMp4(5, false))).toMatchObject({ hasAudio: false, hasVideo: true })
  })

  it('MP4: escribe la duración (mvhd, tkhd, mdhd y mehd) sin tocar las muestras', () => {
    const original = fragmentedMp4(19, true)
    const fixed = fixVideoDuration(original)!
    expect(fixed.length).toBe(original.length + 20)
    const info = inspectVideoContainer(fixed)!
    expect(info.headerDurationMs).toBe(info.durationMs)
    expect(info.durationMs).toBe(inspectVideoContainer(original)!.durationMs)
    // Los fragmentos se conservan byte a byte tras el moov.
    const tail = (bytes: Uint8Array) => Buffer.from(bytes.subarray(bytes.length - 2000)).toString('hex')
    expect(tail(fixed)).toBe(tail(original))
    // Si ya declara la duración, no se toca otra vez.
    expect(fixVideoDuration(fixed)).toBeNull()
  })

  it('MP4 con desplazamientos absolutos: no se modifica', () => {
    expect(fixVideoDuration(fragmentedMp4(3, false, true))).toBeNull()
  })

  it('WebM en directo: pistas y duración a partir de los bloques; añade Duration', () => {
    const original = liveWebm(7, true)
    const info = inspectVideoContainer(original)!
    expect(info).toMatchObject({ container: 'video/webm', hasVideo: true, hasAudio: true, headerDurationMs: null, videoCodec: 'V_VP9', audioCodec: 'A_OPUS' })
    expect(info.durationMs).toBeGreaterThanOrEqual(6_990)
    expect(info.durationMs).toBeLessThanOrEqual(7_040)
    const fixed = fixVideoDuration(original)!
    const after = inspectVideoContainer(fixed)!
    expect(after.headerDurationMs).toBe(info.durationMs)
    expect(after.durationMs).toBe(info.durationMs)
    expect(fixVideoDuration(fixed)).toBeNull()
    expect(inspectVideoContainer(liveWebm(2, false))!.hasAudio).toBe(false)
  })

  it('WebM con SeekHead (posiciones absolutas) y sin Duration: no se modifica', () => {
    expect(fixVideoDuration(liveWebm(2, false, el([0x11, 0x4d, 0x9b, 0x74], el([0xec], [0, 0]))))).toBeNull()
  })

  it('WebM de Firefox (SeekHead vacío y Duration reservado a 0): la duración se escribe en su sitio, sin mover bytes', () => {
    const original = liveWebm(6, true, el([0x11, 0x4d, 0x9b, 0x74], []), true)
    const info = inspectVideoContainer(original)!
    expect(info).toMatchObject({ container: 'video/webm', hasAudio: true, headerDurationMs: 0, videoCodec: 'V_VP8', audioCodec: 'A_OPUS' })
    const fixed = fixVideoDuration(original)!
    expect(fixed.length).toBe(original.length)
    // Solo cambian los 8 bytes del valor de Duration.
    expect([...fixed].filter((byte, i) => byte !== original[i]).length).toBeLessThanOrEqual(8)
    expect(inspectVideoContainer(fixed)!.headerDurationMs).toBe(info.durationMs)
    expect(fixVideoDuration(fixed)).toBeNull()
    // Con SeekHead con contenido y Cues el valor también se escribe en su sitio: ninguna posición cambia.
    const withCues = liveWebm(3, false, el([0x11, 0x4d, 0x9b, 0x74], el([0x4d, 0xbb], el([0x53, 0xab], [0x15, 0x49, 0xa9, 0x66]))), true)
    expect(fixVideoDuration(withCues)!.length).toBe(withCues.length)
  })

  it('archivos que no son vídeo o están truncados: null sin lanzar', () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array([1, 2, 3]), new TextEncoder().encode('<html>hola</html>'), fragmentedMp4(3, true).subarray(0, 60), liveWebm(2, true).subarray(0, 30)]) {
      expect(() => inspectVideoContainer(bytes)).not.toThrow()
      expect(() => fixVideoDuration(bytes)).not.toThrow()
    }
    expect(inspectVideoContainer(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('plantillas de cartel y selección aleatoria (DA-52)', () => {
  it('catálogo: seis plantillas con identificador, nombre, descripción, versión y fotos', () => {
    expect(POSTER_TEMPLATE_IDS).toEqual(['elegante', 'minimalista', 'editorial', 'premium', 'fotografico', 'moderno'])
    for (const template of POSTER_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(3)
      expect(template.description.length).toBeGreaterThan(20)
      expect(template.version).toBeGreaterThanOrEqual(1)
      expect(template.photos).toBeGreaterThanOrEqual(1)
    }
    expect(findPosterTemplate('aleatoria')).toBeUndefined()
    expect(findPosterTemplate('editorial')?.photos).toBe(3)
  })

  it('pickUniform: cada índice de la fuente corresponde a una plantilla distinta y todas son alcanzables', () => {
    const chosen = POSTER_TEMPLATE_IDS.map((_, i) => pickUniform(POSTER_TEMPLATE_IDS, () => i))
    expect(chosen).toEqual(POSTER_TEMPLATE_IDS)
  })

  it('pickUniform: con una fuente uniforme, la frecuencia de cada plantilla es la misma', () => {
    // Fuente controlada que recorre todos los valores por igual: la distribución es exactamente uniforme.
    let i = 0
    const counts = new Map<string, number>()
    for (let n = 0; n < 6000; n += 1) {
      const id = pickUniform(POSTER_TEMPLATE_IDS, size => i++ % size)
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect([...counts.values()]).toEqual(Array.from({ length: 6 }, () => 1000))
  })

  it('pickUniform: una sola plantilla se elige sin consultar la fuente; fuera de rango falla', () => {
    expect(pickUniform(['unica'], () => { throw new Error('no debe llamarse') })).toBe('unica')
    expect(() => pickUniform([], () => 0)).toThrow()
    expect(() => pickUniform(['a', 'b'], () => 2)).toThrow()
    expect(() => pickUniform(['a', 'b'], () => 0.5)).toThrow()
  })
})

describe('formatos de audio (DA-55)', () => {
  it('reconoce los alias que envían los navegadores y las extensiones', () => {
    expect(audioFormatOfType('audio/mpeg')).toBe('mp3')
    expect(audioFormatOfType('audio/x-wav')).toBe('wav')
    expect(audioFormatOfType('audio/ogg; codecs=opus')).toBe('ogg')
    expect(audioFormatOfType('audio/x-m4a')).toBe('m4a')
    expect(audioFormatOfType('video/mp4')).toBeUndefined()
    expect(audioFormatOfType('image/png')).toBeUndefined()
    expect(audioFormatOfName('pista.MP3')).toBe('mp3')
    expect(audioFormatOfName('pista.opus')).toBe('ogg')
    expect(audioFormatOfName('pista.exe')).toBeUndefined()
  })
})
