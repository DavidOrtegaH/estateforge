import type { AudioFormat } from '@estateforge/shared'

// Identificación de pistas de audio por su contenido real (DA-55): no se confía en la extensión ni en
// el tipo declarado. Además de la firma, se recorre la estructura mínima de cada formato y se calcula
// la duración; un archivo truncado, corrupto o que no es audio se rechaza. La decodificación completa
// la hace el navegador antes de subirlo (decodeAudioData); aquí no se decodifica el sonido.

export interface AudioInfo {
  format: AudioFormat
  durationMs: number
  sampleRate: number
  channels: number
}

const ascii = (buf: Buffer, start: number, end: number) => buf.toString('latin1', start, end)

// ------------------------------------------------------------------------------------- WAV

function sniffWav(buf: Buffer): AudioInfo | null {
  if (buf.length < 44 || ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 12) !== 'WAVE') return null
  let pos = 12
  let fmt: { format: number; channels: number; sampleRate: number; byteRate: number } | null = null
  while (pos + 8 <= buf.length) {
    const id = ascii(buf, pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const start = pos + 8
    if (id === 'fmt ' && size >= 16 && start + 16 <= buf.length) {
      fmt = { format: buf.readUInt16LE(start), channels: buf.readUInt16LE(start + 2), sampleRate: buf.readUInt32LE(start + 4), byteRate: buf.readUInt32LE(start + 8) }
    }
    if (id === 'data') {
      if (!fmt || ![1, 3, 0xfffe].includes(fmt.format) || fmt.channels < 1 || fmt.channels > 8 || fmt.sampleRate < 8000 || fmt.sampleRate > 192_000 || fmt.byteRate === 0) return null
      // Un archivo recortado declara más datos de los que tiene: se mide lo que hay de verdad.
      const available = Math.min(size, buf.length - start)
      if (available <= 0) return null
      return { format: 'wav', durationMs: Math.round((available / fmt.byteRate) * 1000), sampleRate: fmt.sampleRate, channels: fmt.channels }
    }
    if (size > buf.length) return null
    pos = start + size + (size % 2)
  }
  return null
}

// ------------------------------------------------------------------------------------- MP3

const BITRATES: Record<string, number[]> = {
  // MPEG-1 capa III y MPEG-2/2.5 capa III (kbit/s), índice 1-14.
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

interface Mp3Frame {
  length: number
  sampleRate: number
  bitrate: number
  samples: number
  channels: number
  version: number
}

function mp3Frame(buf: Buffer, pos: number): Mp3Frame | null {
  if (pos + 4 > buf.length || buf[pos] !== 0xff || (buf[pos + 1] & 0xe0) !== 0xe0) return null
  const version = (buf[pos + 1] >> 3) & 3 // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
  const layer = (buf[pos + 1] >> 1) & 3 // 1: capa III
  const bitrateIndex = buf[pos + 2] >> 4
  const rateIndex = (buf[pos + 2] >> 2) & 3
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null
  const bitrate = BITRATES[version === 3 ? 'v1' : 'v2'][bitrateIndex] * 1000
  const sampleRate = SAMPLE_RATES[version][rateIndex]
  const padding = (buf[pos + 2] >> 1) & 1
  const samples = version === 3 ? 1152 : 576
  const length = Math.floor(((samples / 8) * bitrate) / sampleRate) + padding
  const channels = buf[pos + 3] >> 6 === 3 ? 1 : 2
  return length > 4 ? { length, sampleRate, bitrate, samples, channels, version } : null
}

function sniffMp3(buf: Buffer): AudioInfo | null {
  let pos = 0
  if (ascii(buf, 0, 3) === 'ID3' && buf.length >= 10) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
    pos = 10 + size + (buf[5] & 0x10 ? 10 : 0)
  }
  // Primera cabecera de trama válida seguida de otra (descarta bytes que solo parecen una cabecera).
  const limit = Math.min(buf.length, pos + 64 * 1024)
  let first: Mp3Frame | null = null
  for (; pos < limit; pos += 1) {
    const frame = mp3Frame(buf, pos)
    if (frame && mp3Frame(buf, pos + frame.length)) {
      first = frame
      break
    }
  }
  if (!first) return null
  // Xing/Info (VBR o CBR de LAME) o VBRI: número total de tramas.
  const sideInfo = first.version === 3 ? (first.channels === 1 ? 17 : 32) : first.channels === 1 ? 9 : 17
  const xing = pos + 4 + sideInfo
  let frames: number | null = null
  const tag = ascii(buf, xing, xing + 4)
  if ((tag === 'Xing' || tag === 'Info') && buf.length >= xing + 12 && buf.readUInt32BE(xing + 4) & 1) frames = buf.readUInt32BE(xing + 8)
  // VBRI: «VBRI», versión (2), retardo (2), calidad (2), bytes (4) y tramas (4).
  if (ascii(buf, pos + 36, pos + 40) === 'VBRI' && buf.length >= pos + 54) frames = buf.readUInt32BE(pos + 50)
  // Sin cabecera VBR: se cuentan las tramas reales (como mucho 4 MB de archivo).
  if (frames === null || frames === 0) {
    let count = 0
    let p = pos
    while (p < buf.length) {
      const frame = mp3Frame(buf, p)
      if (!frame) break
      count += 1
      p += frame.length
    }
    if (count < 2) return null
    frames = count
  }
  return { format: 'mp3', durationMs: Math.round(((frames * first.samples) / first.sampleRate) * 1000), sampleRate: first.sampleRate, channels: first.channels }
}

// ------------------------------------------------------------------------------------- Ogg

function sniffOgg(buf: Buffer): AudioInfo | null {
  if (buf.length < 58 || ascii(buf, 0, 4) !== 'OggS' || buf[4] !== 0) return null
  const segments = buf[26]
  const payload = 27 + segments
  if (payload + 19 > buf.length) return null
  let sampleRate: number
  let channels: number
  let preSkip = 0
  let opus = false
  if (ascii(buf, payload, payload + 8) === 'OpusHead') {
    opus = true
    channels = buf[payload + 9]
    preSkip = buf.readUInt16LE(payload + 10)
    sampleRate = 48000 // la posición de las páginas Opus siempre está en muestras de 48 kHz
  } else if (buf[payload] === 1 && ascii(buf, payload + 1, payload + 7) === 'vorbis') {
    channels = buf[payload + 11]
    sampleRate = buf.readUInt32LE(payload + 12)
  } else {
    return null
  }
  if (!channels || sampleRate < 8000 || sampleRate > 192_000) return null
  // Última página: su posición de gránulo es el número total de muestras.
  const tail = buf.lastIndexOf('OggS', buf.length - 27, 'latin1')
  if (tail <= 0 || tail + 14 > buf.length) return null
  const granule = Number(buf.readBigUInt64LE(tail + 6))
  if (!Number.isFinite(granule) || granule <= preSkip) return null
  const samples = granule - (opus ? preSkip : 0)
  return { format: 'ogg', durationMs: Math.round((samples / sampleRate) * 1000), sampleRate: opus ? 48000 : sampleRate, channels }
}

// -------------------------------------------------------------------------------- M4A / AAC

function sniffM4a(buf: Buffer): AudioInfo | null {
  if (buf.length < 16 || ascii(buf, 4, 8) !== 'ftyp') return null
  let pos = 0
  let moov: [number, number] | null = null
  while (pos + 8 <= buf.length) {
    const size = buf.readUInt32BE(pos)
    const type = ascii(buf, pos + 4, pos + 8)
    if (size < 8 || pos + size > buf.length) break
    if (type === 'moov') moov = [pos + 8, pos + size]
    pos += size
  }
  if (!moov) return null
  const kids = (start: number, end: number) => {
    const list: { type: string; start: number; end: number }[] = []
    let p = start
    while (p + 8 <= end) {
      const size = buf.readUInt32BE(p)
      if (size < 8 || p + size > end) break
      list.push({ type: ascii(buf, p + 4, p + 8), start: p, end: p + size })
      p += size
    }
    return list
  }
  const moovKids = kids(moov[0], moov[1])
  const mvhd = moovKids.find(box => box.type === 'mvhd')
  if (!mvhd) return null
  const v1 = buf[mvhd.start + 8] === 1
  const timescale = buf.readUInt32BE(mvhd.start + (v1 ? 28 : 20))
  const duration = v1 ? Number(buf.readBigUInt64BE(mvhd.start + 32)) : buf.readUInt32BE(mvhd.start + 24)
  let audio = false
  let video = false
  let channels = 2
  let sampleRate = timescale
  for (const trak of moovKids.filter(box => box.type === 'trak')) {
    const mdia = kids(trak.start + 8, trak.end).find(box => box.type === 'mdia')
    if (!mdia) continue
    const mdiaKids = kids(mdia.start + 8, mdia.end)
    const hdlr = mdiaKids.find(box => box.type === 'hdlr')
    const handler = hdlr ? ascii(buf, hdlr.start + 16, hdlr.start + 20) : ''
    if (handler === 'vide') video = true
    if (handler === 'soun') {
      audio = true
      const minf = mdiaKids.find(box => box.type === 'minf')
      const stbl = minf ? kids(minf.start + 8, minf.end).find(box => box.type === 'stbl') : undefined
      const stsd = stbl ? kids(stbl.start + 8, stbl.end).find(box => box.type === 'stsd') : undefined
      // Entrada de muestra de audio: canales en +16 y frecuencia (16.16) en +24 desde el inicio de la entrada.
      if (stsd && stsd.end - stsd.start >= 16 + 36) {
        const entry = stsd.start + 16
        channels = buf.readUInt16BE(entry + 24) || channels
        sampleRate = buf.readUInt16BE(entry + 32) || sampleRate
      }
    }
  }
  if (!audio || video || !timescale || !duration) return null
  return { format: 'm4a', durationMs: Math.round((duration / timescale) * 1000), sampleRate, channels }
}

/** Formato y duración reales, o null si no es una pista de audio admitida y legible. */
export function sniffAudio(buf: Buffer): AudioInfo | null {
  try {
    return sniffWav(buf) ?? sniffOgg(buf) ?? sniffM4a(buf) ?? sniffMp3(buf)
  } catch {
    return null
  }
}
