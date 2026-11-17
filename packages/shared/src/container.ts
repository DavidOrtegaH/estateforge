// Análisis de los contenedores de vídeo que produce MediaRecorder (MP4 fragmentado y WebM), sin
// dependencias (DA-56). Lo usan la API, para comprobar qué contiene un vídeo (pistas de vídeo y de
// audio, duración real), y la web, para escribir la duración total en la cabecera.
//
// MediaRecorder graba «en directo»: en MP4 deja la duración de la cabecera a 0 y reparte las muestras
// en fragmentos (moof); en WebM omite el elemento Duration. El contenido está completo, pero algunos
// reproductores muestran una duración provisional. fixVideoDuration escribe la duración calculada a
// partir de las propias muestras, solo cuando puede hacerlo sin desplazar referencias absolutas; si
// no, devuelve null y el archivo se conserva tal cual.

export interface VideoContainerInfo {
  container: 'video/mp4' | 'video/webm'
  hasVideo: boolean
  hasAudio: boolean
  /** Duración calculada a partir de las muestras (o de la cabecera), en milisegundos. */
  durationMs: number | null
  /** Duración que declara la cabecera (0 o null si no la declara). */
  headerDurationMs: number | null
  audioCodec: string | null
  videoCodec: string | null
}

const text = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

// ------------------------------------------------------------------------------------------ MP4

interface Box {
  type: string
  start: number
  headerSize: number
  end: number
}

function readBox(bytes: Uint8Array, dv: DataView, start: number, limit: number): Box | null {
  if (start + 8 > limit) return null
  let size = dv.getUint32(start)
  const type = text(bytes, start + 4, 4)
  let headerSize = 8
  if (size === 1) {
    if (start + 16 > limit) return null
    const high = dv.getUint32(start + 8)
    const low = dv.getUint32(start + 12)
    size = high * 2 ** 32 + low
    headerSize = 16
  } else if (size === 0) {
    size = limit - start
  }
  if (size < headerSize || start + size > limit) return null
  return { type, start, headerSize, end: start + size }
}

function children(bytes: Uint8Array, dv: DataView, parent: Box, skip = 0): Box[] {
  const list: Box[] = []
  let pos = parent.start + parent.headerSize + skip
  while (pos < parent.end) {
    const box = readBox(bytes, dv, pos, parent.end)
    if (!box) break
    list.push(box)
    pos = box.end
  }
  return list
}

function topLevel(bytes: Uint8Array, dv: DataView): Box[] {
  const list: Box[] = []
  let pos = 0
  while (pos < bytes.length) {
    const box = readBox(bytes, dv, pos, bytes.length)
    if (!box) break
    list.push(box)
    pos = box.end
  }
  return list
}

const read64 = (dv: DataView, at: number) => dv.getUint32(at) * 2 ** 32 + dv.getUint32(at + 4)

interface Mp4Track {
  id: number
  handler: string
  timescale: number
  codec: string | null
  tkhd: Box
  mdhd: Box
  end: number
}

interface Mp4Parsed {
  moov: Box
  mvhd: Box
  mvex: Box | null
  mehd: Box | null
  movieTimescale: number
  headerDuration: number
  tracks: Mp4Track[]
  fragmented: boolean
  absoluteOffsets: boolean
  moovBeforeFragments: boolean
}

function parseMp4(bytes: Uint8Array): Mp4Parsed | null {
  const dv = view(bytes)
  const top = topLevel(bytes, dv)
  if (top[0]?.type !== 'ftyp') return null
  const moov = top.find(box => box.type === 'moov')
  if (!moov) return null
  const moovKids = children(bytes, dv, moov)
  const mvhd = moovKids.find(box => box.type === 'mvhd')
  if (!mvhd) return null
  const mvhdVersion = bytes[mvhd.start + 8]
  const movieTimescale = dv.getUint32(mvhd.start + (mvhdVersion === 1 ? 28 : 20))
  const headerDuration = mvhdVersion === 1 ? read64(dv, mvhd.start + 32) : dv.getUint32(mvhd.start + 24)
  const mvex = moovKids.find(box => box.type === 'mvex') ?? null
  const mvexKids = mvex ? children(bytes, dv, mvex) : []
  const mehd = mvexKids.find(box => box.type === 'mehd') ?? null
  const defaults = new Map<number, number>()
  for (const trex of mvexKids.filter(box => box.type === 'trex')) defaults.set(dv.getUint32(trex.start + 12), dv.getUint32(trex.start + 20))

  const tracks: Mp4Track[] = []
  for (const trak of moovKids.filter(box => box.type === 'trak')) {
    const trakKids = children(bytes, dv, trak)
    const tkhd = trakKids.find(box => box.type === 'tkhd')
    const mdia = trakKids.find(box => box.type === 'mdia')
    if (!tkhd || !mdia) continue
    const id = dv.getUint32(tkhd.start + (bytes[tkhd.start + 8] === 1 ? 28 : 20))
    const mdiaKids = children(bytes, dv, mdia)
    const mdhd = mdiaKids.find(box => box.type === 'mdhd')
    const hdlr = mdiaKids.find(box => box.type === 'hdlr')
    if (!mdhd || !hdlr) continue
    const mdhdVersion = bytes[mdhd.start + 8]
    const timescale = dv.getUint32(mdhd.start + (mdhdVersion === 1 ? 28 : 20))
    const mdhdDuration = mdhdVersion === 1 ? read64(dv, mdhd.start + 32) : dv.getUint32(mdhd.start + 24)
    const handler = text(bytes, hdlr.start + 16, 4)
    let codec: string | null = null
    const minf = mdiaKids.find(box => box.type === 'minf')
    const stbl = minf ? children(bytes, dv, minf).find(box => box.type === 'stbl') : undefined
    const stsd = stbl ? children(bytes, dv, stbl).find(box => box.type === 'stsd') : undefined
    if (stsd && stsd.end - stsd.start >= 24) codec = text(bytes, stsd.start + 20, 4)
    tracks.push({ id, handler, timescale, codec, tkhd, mdhd, end: mdhdDuration })
  }

  // Duración real de cada pista: fin de la última muestra de los fragmentos.
  let fragmented = false
  let absoluteOffsets = false
  const firstMoof = top.findIndex(box => box.type === 'moof')
  for (const moof of top.filter(box => box.type === 'moof')) {
    fragmented = true
    for (const traf of children(bytes, dv, moof).filter(box => box.type === 'traf')) {
      const trafKids = children(bytes, dv, traf)
      const tfhd = trafKids.find(box => box.type === 'tfhd')
      if (!tfhd) continue
      const tfhdFlags = dv.getUint32(tfhd.start + 8) & 0xffffff
      const trackId = dv.getUint32(tfhd.start + 12)
      if (tfhdFlags & 0x1) absoluteOffsets = true
      let pos = tfhd.start + 16
      if (tfhdFlags & 0x1) pos += 8
      if (tfhdFlags & 0x2) pos += 4
      const defaultDuration = tfhdFlags & 0x8 ? dv.getUint32(pos) : (defaults.get(trackId) ?? 0)
      const tfdt = trafKids.find(box => box.type === 'tfdt')
      let time = tfdt ? (bytes[tfdt.start + 8] === 1 ? read64(dv, tfdt.start + 12) : dv.getUint32(tfdt.start + 12)) : 0
      for (const trun of trafKids.filter(box => box.type === 'trun')) {
        const flags = dv.getUint32(trun.start + 8) & 0xffffff
        const count = dv.getUint32(trun.start + 12)
        let p = trun.start + 16
        if (flags & 0x1) p += 4
        if (flags & 0x4) p += 4
        const fieldSize = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0)
        if (p + count * fieldSize > trun.end) break
        for (let i = 0; i < count; i += 1) {
          time += flags & 0x100 ? dv.getUint32(p) : defaultDuration
          p += fieldSize
        }
      }
      const track = tracks.find(item => item.id === trackId)
      if (track) track.end = Math.max(track.end, time)
    }
  }
  const moovIndex = top.indexOf(moov)
  return { moov, mvhd, mvex, mehd, movieTimescale, headerDuration, tracks, fragmented, absoluteOffsets, moovBeforeFragments: firstMoof === -1 || moovIndex < firstMoof }
}

function mp4Info(bytes: Uint8Array): VideoContainerInfo | null {
  const parsed = parseMp4(bytes)
  if (!parsed) return null
  const video = parsed.tracks.find(track => track.handler === 'vide')
  const audio = parsed.tracks.find(track => track.handler === 'soun')
  const trackMs = parsed.tracks.filter(track => track.timescale > 0).map(track => (track.end / track.timescale) * 1000)
  const durationMs = trackMs.length ? Math.round(Math.max(...trackMs)) : null
  const headerDurationMs = parsed.movieTimescale ? Math.round((parsed.headerDuration / parsed.movieTimescale) * 1000) : null
  return { container: 'video/mp4', hasVideo: Boolean(video), hasAudio: Boolean(audio), durationMs, headerDurationMs, audioCodec: audio?.codec ?? null, videoCodec: video?.codec ?? null }
}

function fixMp4(bytes: Uint8Array): Uint8Array | null {
  const parsed = parseMp4(bytes)
  if (!parsed || !parsed.fragmented || parsed.absoluteOffsets || !parsed.moovBeforeFragments || !parsed.mvex || !parsed.movieTimescale) return null
  if (parsed.moov.headerSize !== 8 || parsed.mvex.headerSize !== 8) return null
  const ms = Math.max(...parsed.tracks.filter(track => track.timescale > 0).map(track => (track.end / track.timescale) * 1000))
  if (!Number.isFinite(ms) || ms <= 0) return null
  const out = new Uint8Array(bytes.length + (parsed.mehd ? 0 : 20))
  const movieDuration = Math.round((ms / 1000) * parsed.movieTimescale)
  const insertAt = parsed.mvex.start + 8
  out.set(bytes.subarray(0, insertAt), 0)
  let shift = 0
  if (!parsed.mehd) {
    // mehd versión 1: duración total del vídeo fragmentado en la escala de tiempo de la película.
    const mehd = new DataView(out.buffer, insertAt, 20)
    mehd.setUint32(0, 20)
    out.set([0x6d, 0x65, 0x68, 0x64], insertAt + 4)
    mehd.setUint32(8, 0x01000000)
    mehd.setUint32(12, Math.floor(movieDuration / 2 ** 32))
    mehd.setUint32(16, movieDuration >>> 0)
    shift = 20
  }
  out.set(bytes.subarray(insertAt), insertAt + shift)
  const dv = view(out)
  const at = (pos: number) => (pos >= insertAt ? pos + shift : pos)
  const write = (pos: number, version: number, value: number) => {
    if (version === 1) {
      dv.setUint32(at(pos), Math.floor(value / 2 ** 32))
      dv.setUint32(at(pos) + 4, value >>> 0)
    } else {
      if (value > 0xffffffff) throw new Error('duración fuera de rango')
      dv.setUint32(at(pos), value)
    }
  }
  if (shift) {
    dv.setUint32(parsed.moov.start, dv.getUint32(parsed.moov.start) + shift)
    dv.setUint32(parsed.mvex.start, dv.getUint32(parsed.mvex.start) + shift)
  } else if (parsed.mehd) {
    write(parsed.mehd.start + 12, bytes[parsed.mehd.start + 8], movieDuration)
  }
  const mvhdVersion = bytes[parsed.mvhd.start + 8]
  write(parsed.mvhd.start + (mvhdVersion === 1 ? 32 : 24), mvhdVersion, movieDuration)
  for (const track of parsed.tracks) {
    const tkhdVersion = bytes[track.tkhd.start + 8]
    write(track.tkhd.start + (tkhdVersion === 1 ? 36 : 28), tkhdVersion, Math.round((track.end / (track.timescale || 1)) * parsed.movieTimescale))
    const mdhdVersion = bytes[track.mdhd.start + 8]
    write(track.mdhd.start + (mdhdVersion === 1 ? 32 : 24), mdhdVersion, track.end)
  }
  return out
}

// ----------------------------------------------------------------------------------------- WebM

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  Cues: 0x1c53bb6b,
  Tags: 0x1254c367,
  Void: 0xec,
} as const

const SEGMENT_LEVEL = new Set<number>([ID.SeekHead, ID.Info, ID.Tracks, ID.Cluster, ID.Cues, ID.Tags, 0x1043a770, 0x1941a469])

interface Ebml {
  id: number
  start: number
  dataStart: number
  /** null: tamaño desconocido (grabación en directo). */
  end: number | null
  sizeWidth: number
}

function readId(bytes: Uint8Array, pos: number): { id: number; width: number } | null {
  const first = bytes[pos]
  if (first === undefined || first === 0) return null
  const width = Math.clz32(first) - 23
  if (width > 4 || pos + width > bytes.length) return null
  let id = 0
  for (let i = 0; i < width; i += 1) id = id * 256 + bytes[pos + i]
  return { id, width }
}

function readSize(bytes: Uint8Array, pos: number): { size: number | null; width: number } | null {
  const first = bytes[pos]
  if (first === undefined || first === 0) return null
  const width = Math.clz32(first) - 23
  if (width > 8 || pos + width > bytes.length) return null
  let value = first & (0xff >> width)
  let allOnes = value === 0xff >> width
  for (let i = 1; i < width; i += 1) {
    value = value * 256 + bytes[pos + i]
    if (bytes[pos + i] !== 0xff) allOnes = false
  }
  return { size: allOnes ? null : value, width }
}

function readElement(bytes: Uint8Array, pos: number, limit: number): Ebml | null {
  const id = readId(bytes, pos)
  if (!id) return null
  const size = readSize(bytes, pos + id.width)
  if (!size) return null
  const dataStart = pos + id.width + size.width
  const end = size.size === null ? null : dataStart + size.size
  if (end !== null && end > limit) return null
  return { id: id.id, start: pos, dataStart, end, sizeWidth: size.width }
}

function readUint(bytes: Uint8Array, element: Ebml): number {
  let value = 0
  for (let i = element.dataStart; i < (element.end ?? element.dataStart); i += 1) value = value * 256 + bytes[i]
  return value
}

function elementsIn(bytes: Uint8Array, start: number, end: number): Ebml[] {
  const list: Ebml[] = []
  let pos = start
  while (pos < end) {
    const element = readElement(bytes, pos, end)
    if (!element || element.end === null) break
    list.push(element)
    pos = element.end
  }
  return list
}

interface WebmParsed {
  segment: Ebml
  info: Ebml | null
  timecodeScale: number
  durationValue: number | null
  /** Posición y longitud (4 u 8 bytes) del valor de Duration, si el elemento existe. */
  durationSlot: { at: number; length: 4 | 8 } | null
  hasSeekHead: boolean
  hasCues: boolean
  tracks: { number: number; type: number; codec: string }[]
  lastBlockMs: number | null
  frameMs: number
}

function parseWebm(bytes: Uint8Array): WebmParsed | null {
  const header = readElement(bytes, 0, bytes.length)
  if (!header || header.id !== ID.EBML || header.end === null) return null
  if (!text(bytes, header.dataStart, header.end - header.dataStart).includes('webm')) return null
  const segment = readElement(bytes, header.end, bytes.length)
  if (!segment || segment.id !== ID.Segment) return null
  const segmentEnd = segment.end ?? bytes.length
  let info: Ebml | null = null
  let timecodeScale = 1_000_000
  let durationValue: number | null = null
  let durationSlot: WebmParsed['durationSlot'] = null
  let hasSeekHead = false
  let hasCues = false
  const tracks: WebmParsed['tracks'] = []
  const blockTimes = new Map<number, number[]>()
  let pos = segment.dataStart
  while (pos < segmentEnd) {
    const element = readElement(bytes, pos, segmentEnd)
    if (!element) break
    if (element.id === ID.SeekHead) hasSeekHead = true
    if (element.id === ID.Cues) hasCues = true
    if (element.id === ID.Info && element.end !== null) {
      info = element
      for (const child of elementsIn(bytes, element.dataStart, element.end)) {
        if (child.id === ID.TimecodeScale) timecodeScale = readUint(bytes, child)
        if (child.id === ID.Duration && child.end !== null) {
          const length = child.end - child.dataStart
          const dv = view(bytes)
          durationValue = length === 8 ? dv.getFloat64(child.dataStart) : length === 4 ? dv.getFloat32(child.dataStart) : null
          if (length === 8 || length === 4) durationSlot = { at: child.dataStart, length }
        }
      }
    }
    if (element.id === ID.Tracks && element.end !== null) {
      for (const entry of elementsIn(bytes, element.dataStart, element.end).filter(child => child.id === ID.TrackEntry)) {
        const fields = elementsIn(bytes, entry.dataStart, entry.end ?? entry.dataStart)
        const number = fields.find(child => child.id === ID.TrackNumber)
        const type = fields.find(child => child.id === ID.TrackType)
        const codec = fields.find(child => child.id === ID.CodecID)
        tracks.push({
          number: number ? readUint(bytes, number) : 0,
          type: type ? readUint(bytes, type) : 0,
          codec: codec && codec.end !== null ? text(bytes, codec.dataStart, codec.end - codec.dataStart) : '',
        })
      }
    }
    if (element.id === ID.Cluster) {
      // Un cluster en directo puede tener tamaño desconocido: termina donde empieza otro elemento de nivel de segmento.
      let clusterTime = 0
      let p = element.dataStart
      const limit = element.end ?? segmentEnd
      while (p < limit) {
        const child = readElement(bytes, p, segmentEnd)
        if (!child || child.end === null) break
        if (element.end === null && SEGMENT_LEVEL.has(child.id)) break
        if (child.id === ID.Timecode) clusterTime = readUint(bytes, child)
        const block = child.id === ID.SimpleBlock ? child : child.id === ID.BlockGroup ? elementsIn(bytes, child.dataStart, child.end).find(item => item.id === ID.Block) : undefined
        if (block && block.end !== null) {
          const track = readSize(bytes, block.dataStart)
          if (track && track.size !== null) {
            const at = block.dataStart + track.width
            const relative = view(bytes).getInt16(at)
            const list = blockTimes.get(track.size) ?? []
            list.push(clusterTime + relative)
            blockTimes.set(track.size, list)
          }
        }
        p = child.end
      }
      pos = p
      continue
    }
    if (element.end === null) break
    pos = element.end
  }
  let lastBlock: number | null = null
  let frame = 0
  const videoTrack = tracks.find(track => track.type === 1)
  for (const [track, times] of blockTimes) {
    const max = Math.max(...times)
    lastBlock = lastBlock === null ? max : Math.max(lastBlock, max)
    if (track === videoTrack?.number && times.length > 1) {
      const sorted = [...times].sort((a, b) => a - b)
      const deltas = sorted.slice(1).map((value, i) => value - sorted[i]).filter(delta => delta > 0).sort((a, b) => a - b)
      if (deltas.length) frame = deltas[Math.floor(deltas.length / 2)]
    }
  }
  const unit = timecodeScale / 1_000_000
  return { segment, info, timecodeScale, durationValue, durationSlot, hasSeekHead, hasCues, tracks, lastBlockMs: lastBlock === null ? null : lastBlock * unit, frameMs: frame * unit }
}

function webmInfo(bytes: Uint8Array): VideoContainerInfo | null {
  const parsed = parseWebm(bytes)
  if (!parsed) return null
  const video = parsed.tracks.find(track => track.type === 1 || track.codec.startsWith('V_'))
  const audio = parsed.tracks.find(track => track.type === 2 || track.codec.startsWith('A_'))
  const unit = parsed.timecodeScale / 1_000_000
  return {
    container: 'video/webm',
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    durationMs: parsed.lastBlockMs === null ? null : Math.round(parsed.lastBlockMs + parsed.frameMs),
    headerDurationMs: parsed.durationValue === null ? null : Math.round(parsed.durationValue * unit),
    audioCodec: audio?.codec ?? null,
    videoCodec: video?.codec ?? null,
  }
}

function encodeSize8(value: number): Uint8Array {
  const out = new Uint8Array(8)
  out[0] = 0x01
  let rest = value
  for (let i = 7; i >= 1; i -= 1) {
    out[i] = rest & 0xff
    rest = Math.floor(rest / 256)
  }
  return out
}

function fixWebm(bytes: Uint8Array): Uint8Array | null {
  const parsed = parseWebm(bytes)
  if (!parsed || !parsed.info || parsed.info.end === null) return null
  if (parsed.durationValue !== null && parsed.durationValue > 0) return null
  if (parsed.lastBlockMs === null) return null
  const ms = parsed.lastBlockMs + parsed.frameMs
  const unit = parsed.timecodeScale / 1_000_000
  // Firefox reserva un Duration a 0 de 8 bytes: se escribe en su sitio, sin mover ningún byte, así que
  // las posiciones absolutas (SeekHead, Cues) siguen siendo válidas.
  if (parsed.durationSlot) {
    const out = bytes.slice()
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
    if (parsed.durationSlot.length === 8) dv.setFloat64(parsed.durationSlot.at, ms / unit)
    else dv.setFloat32(parsed.durationSlot.at, ms / unit)
    return out
  }
  // Insertar el elemento desplaza bytes: con SeekHead o Cues hay posiciones absolutas que se invalidarían.
  if (parsed.hasSeekHead || parsed.hasCues) return null
  const info = parsed.info
  const oldContent = bytes.subarray(info.dataStart, info.end!)
  // Sin un Duration vacío previo: se quita si existía con valor 0.
  const kept = elementsIn(bytes, info.dataStart, info.end!).filter(child => child.id !== ID.Duration)
  const parts = kept.map(child => bytes.subarray(child.start, child.end!))
  const duration = new Uint8Array(11)
  duration.set([0x44, 0x89, 0x88])
  new DataView(duration.buffer).setFloat64(3, ms / unit)
  const contentLength = parts.reduce((sum, part) => sum + part.length, 0) + duration.length
  if (kept.length === 0 && oldContent.length > 0) return null
  const idBytes = bytes.subarray(info.start, info.dataStart - info.sizeWidth)
  const newInfo = new Uint8Array(idBytes.length + 8 + contentLength)
  newInfo.set(idBytes, 0)
  newInfo.set(encodeSize8(contentLength), idBytes.length)
  let p = idBytes.length + 8
  for (const part of parts) {
    newInfo.set(part, p)
    p += part.length
  }
  newInfo.set(duration, p)
  const delta = newInfo.length - (info.end! - info.start)
  const out = new Uint8Array(bytes.length + delta)
  out.set(bytes.subarray(0, info.start), 0)
  out.set(newInfo, info.start)
  out.set(bytes.subarray(info.end!), info.start + newInfo.length)
  if (parsed.segment.end !== null) {
    // Tamaño conocido del segmento: se reescribe con el mismo ancho si cabe.
    const width = parsed.segment.sizeWidth
    const newSize = parsed.segment.end - parsed.segment.dataStart + delta
    if (newSize >= 2 ** (7 * width) - 1) return null
    const sizePos = parsed.segment.dataStart - width
    let rest = newSize
    for (let i = width - 1; i >= 0; i -= 1) {
      out[sizePos + i] = rest & 0xff
      rest = Math.floor(rest / 256)
    }
    out[sizePos] |= 0x80 >> (width - 1)
  }
  return out
}

// ------------------------------------------------------------------------------------- Público

export function inspectVideoContainer(bytes: Uint8Array): VideoContainerInfo | null {
  try {
    if (bytes.length >= 8 && text(bytes, 4, 4) === 'ftyp') return mp4Info(bytes)
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return webmInfo(bytes)
  } catch {
    return null
  }
  return null
}

/**
 * Copia del vídeo con la duración total escrita en la cabecera, calculada a partir de sus muestras.
 * Devuelve null si el archivo ya la declara o si no puede corregirse sin riesgo.
 */
export function fixVideoDuration(bytes: Uint8Array): Uint8Array | null {
  try {
    if (bytes.length >= 8 && text(bytes, 4, 4) === 'ftyp') {
      const info = mp4Info(bytes)
      if (!info || (info.headerDurationMs ?? 0) > 0) return null
      return fixMp4(bytes)
    }
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return fixWebm(bytes)
  } catch {
    return null
  }
  return null
}
