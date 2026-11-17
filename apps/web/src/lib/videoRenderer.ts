import { AI_VIDEO_LABEL, fixVideoDuration, inspectVideoContainer, VIDEO_HEIGHT, VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_MS, VIDEO_MAX_PHOTOS, VIDEO_WIDTH } from '@estateforge/shared'

import { coverCrop, wrapText, type PosterContext, type PosterImage } from './posterRenderer'
import type { PromoContent } from './promoContent'
import type { PcmAudio } from './soundtrack'

// Vídeo publicitario (DA-47, DA-53, DA-54, DA-56): un lienzo que se anima en tiempo real y se graba con
// MediaRecorder. Si se elige una pista, la banda sonora ya preparada (soundtrack.ts) se reproduce con
// Web Audio hacia un MediaStreamAudioDestinationNode y su pista se graba junto a la del lienzo: el
// sonido queda dentro del archivo. Nunca se usa el micrófono. Tras grabar, se comprueba el
// contenedor (vídeo, y audio si se pidió) y se escribe la duración total en la cabecera.

/** Formatos sin audio, en orden de preferencia. */
export const VIDEO_CANDIDATES = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E', container: 'video/mp4' },
  { mimeType: 'video/mp4', container: 'video/mp4' },
  { mimeType: 'video/webm;codecs=vp9', container: 'video/webm' },
  { mimeType: 'video/webm;codecs=vp8', container: 'video/webm' },
  { mimeType: 'video/webm', container: 'video/webm' },
] as const

/** Formatos con audio: se comprueba la combinación completa, no basta con que admita el vídeo. */
export const AUDIO_VIDEO_CANDIDATES = [
  { mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', container: 'video/mp4' },
  { mimeType: 'video/mp4;codecs="avc1.42E01E,opus"', container: 'video/mp4' },
  { mimeType: 'video/webm;codecs="vp9,opus"', container: 'video/webm' },
  { mimeType: 'video/webm;codecs="vp8,opus"', container: 'video/webm' },
] as const

export type VideoContainer = (typeof VIDEO_CANDIDATES)[number]['container']

/** Primer formato de grabación admitido por el navegador; null si no puede grabar. */
export function pickRecorderFormat(isTypeSupported: ((type: string) => boolean) | undefined, withAudio = false) {
  if (!isTypeSupported) return null
  return (withAudio ? AUDIO_VIDEO_CANDIDATES : VIDEO_CANDIDATES).find(candidate => isTypeSupported(candidate.mimeType)) ?? null
}

export type Segment =
  | { kind: 'intro'; photo: number; start: number; end: number }
  | { kind: 'photo'; photo: number; start: number; end: number; motion: number }
  | { kind: 'features'; photo: number; start: number; end: number }
  | { kind: 'outro'; photo: number; start: number; end: number }

export const MAX_VIDEO_SECONDS = VIDEO_MAX_DURATION_MS / 1000
const INTRO = 3
const FEATURES = 3.5
const OUTRO = 3.5
/** Tiempo por fotografía: 3,5 s con pocas y 2 s como mínimo con 25 (ritmo cómodo, nunca precipitado). */
export const PHOTO_SECONDS = { max: 3.5, min: 2 } as const

export function secondsPerPhoto(photoCount: number): number {
  return Math.min(PHOTO_SECONDS.max, Math.max(PHOTO_SECONDS.min, (MAX_VIDEO_SECONDS - INTRO - FEATURES - OUTRO) / Math.max(1, photoCount)))
}

/** Duración estimada (s) para mostrarla antes de generar. */
export function estimateDuration(photoCount: number): number {
  return Math.round((INTRO + FEATURES + OUTRO + secondsPerPhoto(photoCount) * photoCount) * 10) / 10
}

/** Línea de tiempo: presentación, una toma por fotografía, características y cierre (segundos). */
export function buildTimeline(photoCount: number, variant: number): { segments: Segment[]; duration: number } {
  if (photoCount < 1) throw new Error('El vídeo necesita al menos una fotografía.')
  if (photoCount > VIDEO_MAX_PHOTOS) throw new Error(`El vídeo admite como máximo ${VIDEO_MAX_PHOTOS} fotografías.`)
  const perPhoto = secondsPerPhoto(photoCount)
  const segments: Segment[] = []
  let t = 0
  segments.push({ kind: 'intro', photo: 0, start: t, end: (t += INTRO) })
  for (let i = 0; i < photoCount; i += 1) {
    segments.push({ kind: 'photo', photo: i, start: t, end: (t += perPhoto), motion: (i + variant) % 4 })
  }
  segments.push({ kind: 'features', photo: Math.min(1, photoCount - 1), start: t, end: (t += FEATURES) })
  segments.push({ kind: 'outro', photo: 0, start: t, end: (t += OUTRO) })
  return { segments, duration: Math.round(t * 1000) / 1000 }
}

export const AUDIO_BITS_PER_SECOND = 64_000

/** Tasa de bits de vídeo que mantiene el archivo (con el audio, si lo hay) por debajo del máximo. */
export function videoBitrate(durationSeconds: number, withAudio = false): number {
  const budget = VIDEO_MAX_BYTES * 8 * 0.8 - (withAudio ? AUDIO_BITS_PER_SECOND * durationSeconds : 0)
  return Math.max(250_000, Math.min(1_500_000, Math.floor(budget / durationSeconds)))
}

/** Zoom y desplazamiento suaves (efecto Ken Burns) según el tipo de movimiento y el progreso 0-1. */
export function motionFrame(motion: number, progress: number) {
  const p = Math.min(1, Math.max(0, progress))
  const zoom = motion % 2 === 0 ? 1 + 0.12 * p : 1.12 - 0.12 * p
  const pan = (motion < 2 ? 1 : -1) * 0.04 * (p - 0.5)
  return { zoom, panX: pan, panY: pan / 2 }
}

const SANS = "'Manrope Variable', 'Inter Variable', system-ui, sans-serif"
const ACCENTS = ['#f59e0b', '#2dd4bf', '#fb7185', '#a3e635']

function drawFrame(ctx: PosterContext, image: PosterImage, zoom: number, panX: number, panY: number, alpha = 1) {
  const { sx, sy, sw, sh } = coverCrop(image, VIDEO_WIDTH, VIDEO_HEIGHT)
  const zw = sw / zoom
  const zh = sh / zoom
  const zx = sx + (sw - zw) / 2 + panX * sw
  const zy = sy + (sh - zh) / 2 + panY * sh
  ctx.globalAlpha = alpha
  ctx.drawImage(image as never, Math.max(0, zx), Math.max(0, zy), zw, zh, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT)
  ctx.globalAlpha = 1
}

function shade(ctx: PosterContext, from: number) {
  const gradient = ctx.createLinearGradient(0, VIDEO_HEIGHT * from, 0, VIDEO_HEIGHT)
  gradient.addColorStop(0, 'rgba(15, 23, 42, 0)')
  gradient.addColorStop(1, 'rgba(15, 23, 42, 0.88)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT)
}

/**
 * Dibuja el fotograma del instante t (segundos). image(i) devuelve la fotografía i ya decodificada o
 * null si aún no está (no debería ocurrir: se precargan). Devuelve los textos dibujados (para pruebas).
 */
export function drawVideoFrame(ctx: PosterContext, content: PromoContent, image: (index: number) => PosterImage | null, timeline: { segments: Segment[] }, variant: number, t: number): string[] {
  const texts: string[] = []
  const write = (text: string, x: number, y: number, font: string, color: string, maxWidth = VIDEO_WIDTH - 128) => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.fillText(text, x, y, maxWidth)
    texts.push(text)
  }
  const accent = ACCENTS[variant % ACCENTS.length]
  const segment = timeline.segments.find(s => t >= s.start && t < s.end) ?? timeline.segments[timeline.segments.length - 1]
  const progress = (t - segment.start) / (segment.end - segment.start)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const current = image(segment.photo)
  const motion = segment.kind === 'photo' ? segment.motion : variant % 4
  const frame = motionFrame(motion, progress)
  if (current) drawFrame(ctx, current, frame.zoom, frame.panX, frame.panY)
  // Fundido con la toma anterior en el primer medio segundo.
  const index = timeline.segments.indexOf(segment)
  if (index > 0 && t - segment.start < 0.5) {
    const previous = timeline.segments[index - 1]
    const previousImage = image(previous.photo)
    const prevFrame = motionFrame(previous.kind === 'photo' ? previous.motion : variant % 4, 1)
    if (previousImage) drawFrame(ctx, previousImage, prevFrame.zoom, prevFrame.panX, prevFrame.panY, 1 - (t - segment.start) / 0.5)
  }

  if (segment.kind === 'intro') {
    shade(ctx, 0.35)
    write([content.operation, content.type].join(' · ').toUpperCase(), 64, 470, `700 26px ${SANS}`, accent)
    write(`${content.price}${content.priceSuffix ? ` ${content.priceSuffix}` : ''}`, 64, 540, `800 72px ${SANS}`, '#ffffff')
    ctx.font = `700 38px ${SANS}`
    const [headline] = wrapText(ctx, content.headline, VIDEO_WIDTH - 128, 1)
    write(headline, 64, 608, `700 38px ${SANS}`, '#ffffff')
    if (content.location) write(content.location, 64, 660, `500 28px ${SANS}`, '#e2e8f0')
  } else if (segment.kind === 'photo') {
    shade(ctx, 0.7)
    write(content.facts.join('  ·  '), 64, 668, `600 30px ${SANS}`, '#ffffff')
  } else if (segment.kind === 'features') {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)'
    ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT)
    write('Características', 64, 120, `800 48px ${SANS}`, accent)
    const items = [...content.facts, ...content.features, ...content.highlights].slice(0, 9)
    items.forEach((item, i) => write(`• ${item}`, 64 + (i >= 5 ? 580 : 0), 210 + (i % 5) * 82, `600 34px ${SANS}`, '#ffffff', 520))
  } else {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)'
    ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT)
    write(`${content.price}${content.priceSuffix ? ` ${content.priceSuffix}` : ''}`, 64, 290, `800 76px ${SANS}`, '#ffffff')
    if (content.location) write(content.location, 64, 370, `500 34px ${SANS}`, '#e2e8f0')
    if (content.slogan) {
      ctx.font = `700 40px ${SANS}`
      const [slogan] = wrapText(ctx, content.slogan, VIDEO_WIDTH - 128, 1)
      write(slogan, 64, 460, `700 40px ${SANS}`, accent)
    }
    write('Material generado con EstateForge a partir de los datos del anuncio', 64, 660, `600 22px ${SANS}`, '#cbd5e1')
  }
  return texts
}

/**
 * Fotografías que deben estar decodificadas en el instante t: la actual, la anterior (fundido), las
 * dos siguientes (precarga) y la principal y la segunda (presentación, características y cierre).
 */
export function photosNeeded(timeline: { segments: Segment[] }, t: number): number[] {
  const index = Math.max(0, timeline.segments.findIndex(s => t >= s.start && t < s.end))
  const around = timeline.segments.slice(Math.max(0, index - 1), index + 3).map(s => s.photo)
  return [...new Set([0, Math.min(1, timeline.segments.length - 4), ...around])].sort((a, b) => a - b)
}

export class VideoRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoRenderError'
  }
}

export interface RenderVideoOptions {
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
  /** Banda sonora ya preparada con la duración del vídeo; null o ausente: sin sonido. */
  soundtrack?: PcmAudio | null
}

export interface RenderedVideo {
  blob: Blob
  container: VideoContainer
  mimeType: string
  durationMs: number
  photosUsed: number
  hasAudio: boolean
  durationFixed: boolean
}

/** Comprueba el archivo grabado y escribe la duración total en la cabecera cuando es posible. */
export async function finalizeRecording(blob: Blob, expectAudio: boolean, fallbackMs: number): Promise<{ blob: Blob; durationMs: number; hasAudio: boolean; fixed: boolean }> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const info = inspectVideoContainer(bytes)
  if (!info || !info.hasVideo) throw new VideoRenderError('El navegador ha producido un vídeo que no se puede leer.')
  if (expectAudio && !info.hasAudio) throw new VideoRenderError('El navegador no ha incorporado la pista de audio al vídeo. No se ha guardado nada; prueba con otra pista o sin sonido.')
  const fixed = fixVideoDuration(bytes)
  return {
    blob: fixed ? new Blob([fixed as BlobPart], { type: blob.type }) : blob,
    durationMs: info.durationMs ?? fallbackMs,
    hasAudio: info.hasAudio,
    fixed: Boolean(fixed),
  }
}

interface CanvasScene {
  durationSeconds: number
  /** Dibuja el instante t (segundos) en el lienzo. */
  draw: (ctx: CanvasRenderingContext2D, t: number) => void
  /** Antes de cada fotograma: devuelve un error para detener la grabación. */
  tick?: (t: number) => VideoRenderError | null
  /** Justo al empezar a grabar. */
  onStart?: () => void
}

/**
 * Núcleo común de grabación (DA-54, DA-72): anima el lienzo en tiempo real, mezcla la banda sonora
 * preparada con Web Audio (nunca el micrófono ni otro audio) y graba con MediaRecorder. Rechaza si el
 * navegador no puede grabar, la pestaña se oculta o se cancela; nunca devuelve un vídeo sin la pista pedida.
 */
async function recordCanvas(scene: CanvasScene, options: RenderVideoOptions): Promise<Omit<RenderedVideo, 'photosUsed'>> {
  const withAudio = Boolean(options.soundtrack)
  const supported = typeof MediaRecorder === 'undefined' ? undefined : (type: string) => MediaRecorder.isTypeSupported(type)
  const format = pickRecorderFormat(supported, withAudio)
  if (!format) {
    throw new VideoRenderError(withAudio ? 'Este navegador no puede grabar vídeo con sonido. Prueba sin sonido o con Chrome, Edge o Firefox actualizados.' : 'Este navegador no puede grabar vídeo. Prueba con Chrome, Edge o Firefox actualizados.')
  }
  if (withAudio && (typeof AudioContext === 'undefined' || typeof MediaStream === 'undefined')) throw new VideoRenderError('Este navegador no puede mezclar audio en el vídeo.')
  await document.fonts?.ready

  const canvas = document.createElement('canvas')
  canvas.width = VIDEO_WIDTH
  canvas.height = VIDEO_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new VideoRenderError('El navegador no permite dibujar el vídeo.')
  scene.draw(ctx, 0)
  const canvasStream = canvas.captureStream(30)

  let audioCtx: AudioContext | null = null
  let source: AudioBufferSourceNode | null = null
  let stream: MediaStream = canvasStream
  if (options.soundtrack) {
    const track = options.soundtrack
    audioCtx = new AudioContext()
    const buffer = audioCtx.createBuffer(track.channels.length, track.channels[0].length, track.sampleRate)
    track.channels.forEach((channel, c) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c))
    source = audioCtx.createBufferSource()
    source.buffer = buffer
    const destination = audioCtx.createMediaStreamDestination()
    source.connect(destination)
    stream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()])
    await audioCtx.resume()
  }

  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: videoBitrate(scene.durationSeconds, withAudio),
      ...(withAudio && { audioBitsPerSecond: AUDIO_BITS_PER_SECOND }),
    })
  } catch {
    stream.getTracks().forEach(track => track.stop())
    await audioCtx?.close()
    throw new VideoRenderError('El navegador no ha podido iniciar la grabación con este formato.')
  }
  const chunks: Blob[] = []
  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const recorded = await new Promise<Blob>((resolve, reject) => {
    let failure: VideoRenderError | null = null
    let timer = 0
    const stop = (error?: VideoRenderError) => {
      if (error && !failure) failure = error
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onHidden)
      options.signal?.removeEventListener('abort', onAbort)
      try {
        source?.stop()
      } catch {
        // ya estaba parada
      }
      if (recorder.state !== 'inactive') recorder.stop()
      stream.getTracks().forEach(track => track.stop())
      canvasStream.getTracks().forEach(track => track.stop())
    }
    const onHidden = () => {
      if (document.hidden) stop(new VideoRenderError('La pestaña ha dejado de estar visible y la grabación se ha cancelado. Vuelve a generarlo sin cambiar de pestaña.'))
    }
    const onAbort = () => stop(new VideoRenderError('Generación cancelada.'))
    recorder.onerror = () => stop(new VideoRenderError('El navegador ha interrumpido la grabación del vídeo.'))
    recorder.onstop = () => {
      if (failure) return reject(failure)
      const blob = new Blob(chunks, { type: format.container })
      if (blob.size === 0) return reject(new VideoRenderError('El navegador no ha producido ningún vídeo.'))
      if (blob.size > VIDEO_MAX_BYTES) return reject(new VideoRenderError('El vídeo supera el tamaño máximo de 4 MB. Prueba con menos fotografías.'))
      resolve(blob)
    }
    if (options.signal?.aborted) {
      stop(new VideoRenderError('Generación cancelada.'))
      return
    }
    document.addEventListener('visibilitychange', onHidden)
    options.signal?.addEventListener('abort', onAbort)
    recorder.start(1000)
    source?.start()
    scene.onStart?.()
    const started = performance.now()
    timer = window.setInterval(() => {
      const t = (performance.now() - started) / 1000
      const error = scene.tick?.(Math.min(t, scene.durationSeconds))
      if (error) return stop(error)
      if (t >= scene.durationSeconds) {
        scene.draw(ctx, scene.durationSeconds - 0.001)
        stop()
        return
      }
      scene.draw(ctx, t)
      options.onProgress?.(t / scene.durationSeconds)
    }, 1000 / 30)
  }).finally(async () => {
    canvas.width = 0
    canvas.height = 0
    await audioCtx?.close().catch(() => undefined)
  })

  const final = await finalizeRecording(recorded, withAudio, Math.round(scene.durationSeconds * 1000))
  return { blob: final.blob, container: format.container, mimeType: format.mimeType, durationMs: final.durationMs, hasAudio: final.hasAudio, durationFixed: final.fixed }
}

/**
 * Graba el vídeo clásico en tiempo real. loadPhoto(i) descarga y decodifica la fotografía i (reducida);
 * solo se mantienen unas pocas a la vez.
 */
export async function renderVideo(content: PromoContent, photoCount: number, loadPhoto: (index: number) => Promise<ImageBitmap>, variant: number, options: RenderVideoOptions = {}): Promise<RenderedVideo> {
  const timeline = buildTimeline(photoCount, variant)
  // Fotografías: ventana de decodificadas que avanza con el vídeo.
  const decoded = new Map<number, ImageBitmap>()
  const loading = new Map<number, Promise<void>>()
  let loadError: unknown = null
  const ensure = (index: number) => {
    if (decoded.has(index) || loading.has(index) || index >= photoCount) return loading.get(index)
    const promise = loadPhoto(index).then(
      bitmap => {
        decoded.set(index, bitmap)
      },
      error => {
        loadError = error
      },
    )
    loading.set(index, promise)
    return promise
  }
  const prune = (keep: number[]) => {
    for (const [index, bitmap] of decoded) {
      if (!keep.includes(index)) {
        bitmap.close()
        decoded.delete(index)
        loading.delete(index)
      }
    }
  }
  try {
    await Promise.all(photosNeeded(timeline, 0).map(ensure))
    if (loadError) throw loadError
    const result = await recordCanvas(
      {
        durationSeconds: timeline.duration,
        draw: (ctx, t) => drawVideoFrame(ctx as unknown as PosterContext, content, i => decoded.get(i) ?? null, timeline, variant, t),
        tick: t => {
          if (loadError) return new VideoRenderError('No se ha podido cargar una de las fotografías. No se ha guardado nada.')
          const needed = photosNeeded(timeline, t)
          needed.forEach(ensure)
          prune(needed)
          return null
        },
      },
      options,
    )
    return { ...result, photosUsed: photoCount }
  } finally {
    for (const bitmap of decoded.values()) bitmap.close()
    decoded.clear()
  }
}

// ------------------------------------------------------------------------------ Vídeo con IA (DA-72)

/** Presentación y cierre del vídeo con IA, con los datos exactos del anuncio. */
export const AI_INTRO_SECONDS = 3
export const AI_OUTRO_SECONDS = 3.5

/** Lo que el vídeo con IA necesita del clip (un <video> en el navegador). */
export interface AiClip {
  width: number
  height: number
  duration: number
}

/**
 * Fotograma del vídeo con IA: el clip del proveedor a pantalla completa, con presentación y cierre que
 * escribe EstateForge (datos exactos) y el rótulo de contenido generado con IA siempre visible.
 */
export function drawAiVideoFrame(ctx: PosterContext, content: PromoContent, frame: PosterImage | null, clipSeconds: number, t: number): string[] {
  const texts: string[] = []
  const write = (text: string, x: number, y: number, font: string, color: string, maxWidth = VIDEO_WIDTH - 128) => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.fillText(text, x, y, maxWidth)
    texts.push(text)
  }
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  if (frame) drawFrame(ctx, frame, 1, 0, 0)
  const price = `${content.price}${content.priceSuffix ? ` ${content.priceSuffix}` : ''}`
  if (t < AI_INTRO_SECONDS) {
    shade(ctx, 0.35)
    write([content.operation, content.type].join(' · ').toUpperCase(), 64, 470, `700 26px ${SANS}`, ACCENTS[0])
    write(price, 64, 540, `800 72px ${SANS}`, '#ffffff')
    ctx.font = `700 38px ${SANS}`
    const [headline] = wrapText(ctx, content.headline, VIDEO_WIDTH - 128, 1)
    write(headline, 64, 608, `700 38px ${SANS}`, '#ffffff')
    if (content.location) write(content.location, 64, 660, `500 28px ${SANS}`, '#e2e8f0')
  } else if (t >= AI_INTRO_SECONDS + clipSeconds) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'
    ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT)
    write(price, 64, 250, `800 76px ${SANS}`, '#ffffff')
    if (content.location) write(content.location, 64, 330, `500 34px ${SANS}`, '#e2e8f0')
    write(content.facts.join('  ·  '), 64, 410, `600 30px ${SANS}`, '#ffffff')
    write('Material generado con EstateForge a partir de los datos del anuncio', 64, 660, `600 22px ${SANS}`, '#cbd5e1')
  } else {
    shade(ctx, 0.78)
    write(content.facts.join('  ·  '), 64, 668, `600 30px ${SANS}`, '#ffffff')
  }
  // Rótulo de contenido generado con IA, visible durante todo el vídeo.
  ctx.font = `700 20px ${SANS}`
  const width = Math.min(VIDEO_WIDTH - 48, ctx.measureText(AI_VIDEO_LABEL).width + 32)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'
  ctx.fillRect(24, 22, width, 40)
  write(AI_VIDEO_LABEL, 40, 42, `700 20px ${SANS}`, '#ffffff', width - 32)
  return texts
}

/**
 * Vídeo con IA: graba en tiempo real el clip del proveedor (silenciado: su audio propio se descarta) con
 * la presentación, el cierre, el rótulo de IA y la banda sonora elegida por el usuario (o sin sonido),
 * con las mismas comprobaciones que el vídeo clásico.
 */
export async function renderAiVideo(content: PromoContent, clip: HTMLVideoElement, options: RenderVideoOptions = {}): Promise<RenderedVideo & { clipSeconds: number }> {
  const clipSeconds = Math.min(15, Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 0)
  if (clipSeconds < 1) throw new VideoRenderError('El clip generado no se puede reproducir en este navegador.')
  clip.muted = true
  clip.volume = 0
  clip.currentTime = 0
  let playing = false
  let failed = false
  clip.onerror = () => {
    failed = true
  }
  const duration = AI_INTRO_SECONDS + clipSeconds + AI_OUTRO_SECONDS
  const result = await recordCanvas(
    {
      durationSeconds: duration,
      draw: (ctx, t) => drawAiVideoFrame(ctx as unknown as PosterContext, content, clip.readyState >= 2 ? (clip as unknown as PosterImage) : null, clipSeconds, t),
      tick: t => {
        if (failed) return new VideoRenderError('El clip generado no se ha podido reproducir. No se ha guardado nada.')
        if (!playing && t >= AI_INTRO_SECONDS) {
          playing = true
          void clip.play().catch(() => {
            failed = true
          })
        }
        return null
      },
    },
    options,
  ).finally(() => {
    clip.pause()
  })
  return { ...result, photosUsed: 0, clipSeconds }
}
