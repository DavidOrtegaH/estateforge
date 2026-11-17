// Archivos sintéticos de vídeo y de audio con la estructura real de cada formato, para las pruebas
// (DA-54 a DA-56). No contienen imagen ni sonido reales: solo lo que la API comprueba (contenedor,
// pistas, duración, cabeceras). Los vídeos imitan a MediaRecorder: MP4 fragmentado y WebM en directo.

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = (n: number) => [(n >>> 8) & 255, n & 255]
const str = (s: string) => [...s].map(c => c.charCodeAt(0))
const full = (version: number, flags: number) => [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]

function box(type: string, ...parts: number[][]): number[] {
  const body = parts.flat()
  return [...u32(8 + body.length), ...str(type), ...body]
}

function rng(seed: number) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) & 255
  }
}

// ------------------------------------------------------------------------------------ Vídeo

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

function mp4(seconds: number, audio: boolean, seed: number): number[] {
  const random = rng(seed)
  const tracks = [trak(1, 'vide', 30000, 'avc1'), ...(audio ? [trak(2, 'soun', 48000, 'mp4a')] : [])]
  const out = [
    ...box('ftyp', str('isom'), u32(512), str('isomiso2avc1mp41')),
    ...box(
      'moov',
      box('mvhd', full(0, 0), u32(0), u32(0), u32(1000), u32(0), Array.from({ length: 80 }, () => 0)),
      ...tracks,
      box('mvex', box('trex', full(0, 0), u32(1), u32(1), u32(0), u32(0), u32(0)), ...(audio ? [box('trex', full(0, 0), u32(2), u32(1), u32(1024), u32(0), u32(0))] : [])),
    ),
  ]
  for (let f = 0; f < Math.ceil(seconds); f += 1) {
    const frames = Math.min(30, Math.round((seconds - f) * 30))
    const video = box('traf', box('tfhd', full(0, 0x020000), u32(1)), box('tfdt', full(1, 0), u32(0), u32(f * 30000)), box('trun', full(0, 0x301), u32(frames), u32(0), ...Array.from({ length: frames }, () => [...u32(1000), ...u32(10)])))
    const audioFrames = Math.round(((frames / 30) * 48000) / 1024)
    const sound = audio ? box('traf', box('tfhd', full(0, 0x020000), u32(2)), box('tfdt', full(1, 0), u32(0), u32(f * 48000)), box('trun', full(0, 0x201), u32(audioFrames), u32(0), ...Array.from({ length: audioFrames }, () => u32(4)))) : []
    out.push(...box('moof', box('mfhd', full(0, 0), u32(f + 1)), video, sound), ...box('mdat', Array.from({ length: 96 }, random)))
  }
  return out
}

const vint = (n: number) => (n < 127 ? [0x80 | n] : [0x40 | (n >> 8), n & 255])
const el = (id: number[], ...data: number[][]) => {
  const body = data.flat()
  return [...id, ...vint(body.length), ...body]
}
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

function webm(seconds: number, audio: boolean, seed: number): number[] {
  const random = rng(seed)
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], str('webm')))
  const info = el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), el([0x4d, 0x80], str('Chrome')))
  const tracks = el(
    [0x16, 0x54, 0xae, 0x6b],
    el([0xae], el([0xd7], [1]), el([0x83], [1]), el([0x86], str('V_VP9'))),
    ...(audio ? [el([0xae], el([0xd7], [2]), el([0x83], [2]), el([0x86], str('A_OPUS')))] : []),
  )
  const clusters: number[] = []
  for (let c = 0; c < Math.ceil(seconds); c += 1) {
    const frames = Math.min(30, Math.round((seconds - c) * 30))
    clusters.push(0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN, ...el([0xe7], u16(c * 1000)))
    for (let i = 0; i < frames; i += 1) {
      const rel = Math.round((i * 1000) / 30)
      clusters.push(...el([0xa3], [0x81, ...u16(rel), 0x80, random(), random(), random()]))
      if (audio && i % 3 === 0) clusters.push(...el([0xa3], [0x82, ...u16(rel), 0x80, random()]))
    }
  }
  return [...header, 0x18, 0x53, 0x80, 0x67, ...UNKNOWN, ...info, ...tracks, ...clusters]
}

/** Vídeo como el de MediaRecorder, de `seconds` segundos, con o sin pista de audio. */
export function makeVideo(container: 'webm' | 'mp4', seconds: number, options: { audio?: boolean; seed?: number } = {}): Buffer {
  const bytes = container === 'mp4' ? mp4(seconds, Boolean(options.audio), options.seed ?? 1) : webm(seconds, Boolean(options.audio), options.seed ?? 1)
  return Buffer.from(bytes)
}

// ------------------------------------------------------------------------------------ Audio

/** WAV PCM de 16 bits. */
export function makeWav(seconds: number, options: { sampleRate?: number; channels?: number; seed?: number } = {}): Buffer {
  const rate = options.sampleRate ?? 8000
  const channels = options.channels ?? 1
  const samples = Math.round(seconds * rate)
  const data = Buffer.alloc(samples * channels * 2)
  const seed = options.seed ?? 1
  for (let i = 0; i < samples * channels; i += 1) data.writeInt16LE(Math.round(Math.sin((i * (440 + seed)) / rate) * 8000), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** MP3 (MPEG-1 capa III, 128 kbit/s, 44,1 kHz) con tramas válidas y contenido aleatorio. */
export function makeMp3(seconds: number, options: { seed?: number; id3?: boolean } = {}): Buffer {
  const random = rng(options.seed ?? 1)
  const frames = Math.round((seconds * 44100) / 1152)
  const frameLength = Math.floor((144 * 128000) / 44100)
  const out: number[] = []
  if (options.id3) out.push(...str('ID3'), 4, 0, 0, 0, 0, 0, 10, ...Array.from({ length: 10 }, () => 0))
  for (let i = 0; i < frames; i += 1) out.push(0xff, 0xfb, 0x90, 0x64, ...Array.from({ length: frameLength - 4 }, random))
  return Buffer.from(out)
}

function oggPage(granule: bigint, sequence: number, packet: number[], type: number): number[] {
  const header = Buffer.alloc(27)
  header.write('OggS', 0, 'latin1')
  header[5] = type
  header.writeBigUInt64LE(granule, 6)
  header.writeUInt32LE(0x45465354, 14)
  header.writeUInt32LE(sequence, 18)
  header[26] = 1
  return [...header, packet.length, ...packet]
}

/** Ogg Vorbis u Opus con la página de identificación y la última página con la posición final. */
export function makeOgg(seconds: number, codec: 'vorbis' | 'opus' = 'vorbis', seed = 1): Buffer {
  const random = rng(seed)
  if (codec === 'opus') {
    const head = [...str('OpusHead'), 1, 2, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]
    const end = BigInt(Math.round(seconds * 48000) + 312)
    return Buffer.from([...oggPage(0n, 0, head, 2), ...oggPage(0n, 1, Array.from({ length: 200 }, random), 0), ...oggPage(end, 2, Array.from({ length: 100 }, random), 4)])
  }
  const rate = 44100
  const id = [1, ...str('vorbis'), 0, 0, 0, 0, 2, 0x44, 0xac, 0, 0, ...Array.from({ length: 12 }, () => 0), 0xb8, 1]
  return Buffer.from([...oggPage(0n, 0, id, 2), ...oggPage(0n, 1, Array.from({ length: 200 }, random), 0), ...oggPage(BigInt(Math.round(seconds * rate)), 2, Array.from({ length: 100 }, random), 4)])
}

/** M4A (AAC) con moov/mvhd, una pista de sonido y mdat. */
export function makeM4a(seconds: number, seed = 1): Buffer {
  const random = rng(seed)
  const entry = box('mp4a', Array.from({ length: 6 }, () => 0), u16(1), Array.from({ length: 8 }, () => 0), u16(2), u16(16), u16(0), u16(0), u16(44100), u16(0))
  return Buffer.from([
    ...box('ftyp', str('M4A '), u32(0), str('M4A isommp42')),
    ...box(
      'moov',
      box('mvhd', full(0, 0), u32(0), u32(0), u32(1000), u32(Math.round(seconds * 1000)), Array.from({ length: 80 }, () => 0)),
      box(
        'trak',
        box('tkhd', full(0, 3), u32(0), u32(0), u32(1), u32(0), u32(0), Array.from({ length: 60 }, () => 0)),
        box('mdia', box('mdhd', full(0, 0), u32(0), u32(0), u32(44100), u32(Math.round(seconds * 44100)), [0x55, 0xc4, 0, 0]), box('hdlr', full(0, 0), u32(0), str('soun'), Array.from({ length: 12 }, () => 0), [0]), box('minf', box('stbl', box('stsd', full(0, 0), u32(1), entry)))),
      ),
    ),
    ...box('mdat', Array.from({ length: 400 }, random)),
  ])
}
