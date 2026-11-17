import { afterEach, describe, expect, it, vi } from 'vitest'

import { AI_POSTER_LABEL, AI_VIDEO_LABEL, AUDIO_PRESETS, inspectVideoContainer, PHOTO_MAX_SIDE, POSTER_TEMPLATES, VIDEO_MAX_BYTES, VIDEO_MAX_PHOTOS, type PosterTemplateId } from '@estateforge/shared'

import { synthesizePreset } from './audioPresets'
import { fileKey, fitWithin, PHOTO_INPUT_MAX_BYTES, runPool, validatePhotoFile } from './imagePrep'
import { defaultVideoSelection, describeMediaError, formatDuration, moveId, moveInSelection, moveTo, planUploads, resolveVideoSelection } from './mediaUi'
import { coverCrop, drawAiPoster, drawPoster, photosForTemplate, wrapText, type PosterContext } from './posterRenderer'
import { buildPromoContent, excerptOf, formatPrice, nextVariant, orderedPhotos, type MediaSourceData } from './promoContent'
import { buildSoundtrack, encodeWav, rms, type PcmAudio } from './soundtrack'
import {
  buildTimeline,
  drawVideoFrame,
  estimateDuration,
  finalizeRecording,
  MAX_VIDEO_SECONDS,
  motionFrame,
  photosNeeded,
  pickRecorderFormat,
  secondsPerPhoto,
  VideoRenderError,
  videoBitrate,
  AUDIO_BITS_PER_SECOND,
} from './videoRenderer'
import { AI_INTRO_SECONDS, drawAiVideoFrame } from './videoRenderer'
import { describeCost, pollAiJob } from '@/services/aiMediaService'
import { mediaDownloadName, mediaHeaders, mediaPrepare, MediaRequestError, TRANSFER_RETRIES, transferFile, UPLOAD_PROGRESS_CAP } from '@/services/mediaService'

// Lógica del cartel, del vídeo, del audio y de la galería (DA-46 a DA-56) sin navegador: el lienzo se
// sustituye por un contexto que registra lo que se dibuja y el audio se comprueba sobre las muestras.

function source(overrides: Partial<MediaSourceData['property']> = {}, generation: Partial<MediaSourceData['generation']> = {}, photoCount = 3): MediaSourceData {
  return {
    sourceHash: 'a'.repeat(64),
    generation: {
      id: 'g1',
      title: 'Piso luminoso con terraza',
      description: 'Vivienda exterior y reformada en pleno Chamberí. Tres dormitorios amplios y salón con terraza orientada al sur. Cerca del metro y de colegios.',
      highlights: ['Reformado en 2024', '  ', 'Muy luminoso'],
      callToAction: 'Pide tu visita hoy',
      ...generation,
    },
    property: {
      id: 'p1',
      title: 'Piso en Chamberí',
      operation: 'sale',
      type: 'apartment',
      price: '325000.00',
      city: 'Madrid',
      neighborhood: 'Chamberí',
      area: 85,
      bedrooms: 3,
      bathrooms: 1,
      floor: 4,
      condition: 'good',
      commercialStatus: null,
      elevator: true,
      terrace: true,
      balcony: false,
      garage: false,
      storageRoom: false,
      pool: false,
      garden: false,
      airConditioning: true,
      heating: false,
      ...overrides,
    },
    photos: Array.from({ length: photoCount }, (_, i) => ({ id: `ph${i}`, position: i, isPrimary: i === photoCount - 1, width: 1600, height: 1200, url: `/api/properties/p1/photos/ph${i}/file?v=x`, thumbUrl: null })),
  }
}

function fakeContext() {
  const texts: string[] = []
  const images: unknown[] = []
  const ops: string[] = []
  const placed: { text: string; x: number; y: number; maxWidth: number; align: string }[] = []
  const log = (name: string, ...args: unknown[]) => ops.push(`${name}(${args.map(a => (typeof a === 'number' ? Math.round(a) : typeof a === 'string' ? a : '·')).join(',')})`)
  const ctx: PosterContext = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'left',
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: (...a) => log('fillRect', ...a),
    strokeRect: (...a) => log('strokeRect', ...a),
    fillText(text, x, y, maxWidth) {
      texts.push(text)
      placed.push({ text, x, y, maxWidth: maxWidth ?? Infinity, align: ctx.textAlign })
      log('fillText', Math.round(x / 10), Math.round(y / 10))
    },
    measureText: text => ({ width: text.length * 20 }),
    drawImage(image, ...a) {
      images.push(image)
      log('drawImage', ...a.slice(4))
    },
    createLinearGradient: () => ({ addColorStop() {} }) as unknown as CanvasGradient,
    save: () => log('save'),
    restore: () => log('restore'),
    beginPath: () => log('beginPath'),
    roundRect: (...a) => log('roundRect', ...a),
    moveTo: (...a) => log('moveTo', ...a),
    lineTo: (...a) => log('lineTo', ...a),
    arc: (...a) => log('arc', ...a.slice(0, 3)),
    closePath: () => log('closePath'),
    fill: () => log('fill'),
    stroke: () => log('stroke'),
    clip: () => log('clip'),
  }
  return { ctx, texts, images, ops, placed }
}

const imgs = (n: number) => Array.from({ length: n }, (_, i) => ({ width: 1600 + i, height: 1200 }))
const TEMPLATE_IDS = POSTER_TEMPLATES.map(t => t.id) as PosterTemplateId[]

describe('contenido del material publicitario', () => {
  it('formatea el precio exacto sin coma flotante', () => {
    expect(formatPrice('325000.00')).toBe('325.000 €')
    expect(formatPrice('1250.50')).toBe('1.250,50 €')
    expect(formatPrice('999999999999.99')).toBe('999.999.999.999,99 €')
    expect(formatPrice('0.5')).toBe('0,50 €')
  })

  it('usa solo datos reales y omite los que faltan', () => {
    const content = buildPromoContent(source({ floor: null }))
    expect(content.headline).toBe('Piso luminoso con terraza')
    expect(content.price).toBe('325.000 €')
    expect(content.location).toBe('Chamberí, Madrid')
    expect(content.facts).toEqual(['85 m²', '3 habitaciones', '1 baño'])
    expect(content.features).toEqual(['Ascensor', 'Terraza', 'Aire acondicionado'])
    expect(content.highlights).toEqual(['Reformado en 2024', 'Muy luminoso'])
    expect(content.slogan).toBe('Pide tu visita hoy')
    expect(content.status).toBeNull()
  })

  it('el extracto son frases completas de la descripción real', () => {
    expect(buildPromoContent(source()).excerpt.startsWith('Vivienda exterior y reformada')).toBe(true)
    expect(excerptOf('Una frase. Otra frase más larga que la anterior. Y una tercera.', 30)).toBe('Una frase.')
    expect(excerptOf('x'.repeat(400), 50)).toHaveLength(50)
  })

  it('alquiler, planta baja, título del inmueble como respaldo y sin eslogan', () => {
    const content = buildPromoContent(source({ operation: 'rent', floor: 0, price: '950.00' }, { title: '  ', callToAction: null }))
    expect(content.priceSuffix).toBe('/mes')
    expect(content.facts).toContain('Planta baja')
    expect(content.headline).toBe('Piso en Chamberí')
    expect(content.slogan).toBeNull()
  })

  it('pone primero la fotografía principal y respeta el orden de la galería', () => {
    expect(orderedPhotos(source().photos).map(photo => photo.id)).toEqual(['ph2', 'ph0', 'ph1'])
  })

  it('al regenerar el vídeo cambia siempre el movimiento de cámara', () => {
    for (let current = 0; current < 12; current += 1) {
      for (const r of [0, 0.1, 0.5, 0.99999]) expect(nextVariant(current, () => r) % 3).not.toBe(current % 3)
    }
  })

  it('los destacados que repiten un dato visible no se duplican', () => {
    const content = buildPromoContent(source({}, { highlights: ['85 m²', '3 Habitaciones', 'terraza', 'Orientación sur'] }))
    expect(content.highlights).toEqual(['Orientación sur'])
  })
})

describe('plantillas de cartel (DA-52)', () => {
  it('recorta la foto para cubrir el hueco sin deformarla', () => {
    expect(coverCrop({ width: 2000, height: 1000 }, 500, 500)).toMatchObject({ sw: 1000, sh: 1000, sx: 500 })
  })

  it('parte el texto y lo recorta con puntos suspensivos', () => {
    const { ctx } = fakeContext()
    const lines = wrapText(ctx, 'uno dos tres cuatro cinco seis siete', 200, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })

  it.each(TEMPLATE_IDS)('%s: dibuja los datos reales, empieza por la principal y usa las fotos que admite', templateId => {
    const pics = imgs(5)
    const { ctx, texts, images } = fakeContext()
    const { photosUsed } = drawPoster(ctx, buildPromoContent(source()), pics, templateId)
    expect(photosUsed).toBe(POSTER_TEMPLATES.find(t => t.id === templateId)!.photos)
    expect(images[0]).toBe(pics[0])
    expect(new Set(images).size).toBe(photosUsed)
    expect(images.every(image => pics.slice(0, photosUsed).includes(image as (typeof pics)[number]))).toBe(true)
    const all = texts.join('\n')
    expect(all).toContain('325.000 €')
    expect(all).toMatch(/Chamberí/)
    expect(all).toContain('85 m²')
    expect(all).not.toMatch(/undefined|null|NaN/)
    expect(all).not.toContain('Calle')
  })

  it.each(TEMPLATE_IDS)('%s: funciona con una sola fotografía y con datos mínimos', templateId => {
    const { ctx, texts } = fakeContext()
    const minimal = buildPromoContent(source({ floor: null, elevator: false, terrace: false, airConditioning: false, neighborhood: '' }, { highlights: [], callToAction: null, description: '' }, 1))
    expect(drawPoster(ctx, minimal, imgs(1), templateId).photosUsed).toBe(1)
    expect(texts.join('\n')).not.toMatch(/undefined|null|NaN/)
  })

  it('las seis composiciones son distintas entre sí (no son la misma plantilla con otro color)', () => {
    const signatures = TEMPLATE_IDS.map(templateId => {
      const { ctx, ops } = fakeContext()
      drawPoster(ctx, buildPromoContent(source()), imgs(5), templateId)
      // Solo la geometría: dónde se colocan fotos, bloques y textos.
      return ops.filter(op => /^(drawImage|fillRect|roundRect|arc|moveTo|fillText)/.test(op)).join('|')
    })
    expect(new Set(signatures).size).toBe(TEMPLATE_IDS.length)
    // Ni siquiera la colocación de las fotografías coincide entre dos plantillas.
    const placements = TEMPLATE_IDS.map(templateId => {
      const { ctx, ops } = fakeContext()
      drawPoster(ctx, buildPromoContent(source()), imgs(5), templateId)
      return ops.filter(op => op.startsWith('drawImage')).join('|')
    })
    expect(new Set(placements).size).toBe(TEMPLATE_IDS.length)
  })

  it.each(TEMPLATE_IDS)('%s: ningún texto se comprime (ancho disponible) ni se superpone a otro ni sale del cartel', templateId => {
    const { ctx, placed } = fakeContext()
    drawPoster(ctx, buildPromoContent(source()), imgs(5), templateId)
    for (const item of placed) {
      // El ancho disponible nunca es menor que el que ocupa el texto (o 200 px): no se comprime.
      expect(item.maxWidth, item.text).toBeGreaterThanOrEqual(Math.min(200, item.text.length * 20))
      expect(item.y, item.text).toBeLessThanOrEqual(1350)
    }
    // Dos líneas en la misma columna nunca a menos de 20 px (salvo el pie, que va aparte).
    const lines = placed.filter(item => !item.text.startsWith('Material generado')).sort((a, b) => a.y - b.y)
    for (let i = 1; i < lines.length; i += 1) {
      const a = lines[i - 1]
      const b = lines[i]
      const sameColumn = Math.abs(a.x - b.x) < 40 && a.align === b.align
      if (sameColumn) expect(b.y - a.y, `${a.text} / ${b.text}`).toBeGreaterThanOrEqual(20)
    }
  })

  it('el extracto no parte un precio con punto de miles', () => {
    expect(excerptOf('Ático reformado. Precio: 489.000 €. Llama hoy.', 40)).toBe('Ático reformado. Precio: 489.000 €.')
  })

  it('con 50 fotografías cada plantilla usa solo las suyas; sin fotografías o con una plantilla desconocida falla', () => {
    for (const templateId of TEMPLATE_IDS) expect(photosForTemplate(templateId, 50)).toBeLessThanOrEqual(4)
    const { ctx } = fakeContext()
    expect(() => drawPoster(ctx, buildPromoContent(source()), [], 'elegante')).toThrow()
    expect(() => drawPoster(ctx, buildPromoContent(source()), imgs(1), 'aleatoria' as PosterTemplateId)).toThrow()
  })
})

describe('vídeo (DA-53, DA-54)', () => {
  it('elige MP4 si el navegador lo graba y WebM en otro caso', () => {
    expect(pickRecorderFormat(type => type.startsWith('video/mp4'))?.container).toBe('video/mp4')
    expect(pickRecorderFormat(type => type === 'video/webm;codecs=vp8')?.container).toBe('video/webm')
    expect(pickRecorderFormat(() => false)).toBeNull()
    expect(pickRecorderFormat(undefined)).toBeNull()
  })

  it('con audio comprueba la combinación completa de vídeo y audio', () => {
    expect(pickRecorderFormat(type => type.includes('mp4a'), true)?.mimeType).toBe('video/mp4;codecs="avc1.42E01E,mp4a.40.2"')
    expect(pickRecorderFormat(type => type === 'video/webm;codecs="vp9,opus"', true)?.container).toBe('video/webm')
    // Admite vídeo MP4 pero ninguna combinación con audio: no se elige un formato sin sonido.
    expect(pickRecorderFormat(type => type === 'video/mp4' || type === 'video/mp4;codecs=avc1.42E01E', true)).toBeNull()
  })

  it('línea de tiempo: de 1 a 25 fotografías, al menos 2 s por foto y como máximo 60 s; más de 25 se rechaza', () => {
    for (const count of [1, 4, 16, 25]) {
      const { segments, duration } = buildTimeline(count, 3)
      expect(segments.filter(s => s.kind === 'photo')).toHaveLength(count)
      expect(duration).toBeLessThanOrEqual(MAX_VIDEO_SECONDS)
      expect(secondsPerPhoto(count)).toBeGreaterThanOrEqual(2)
      expect(estimateDuration(count)).toBeCloseTo(duration, 1)
      for (let i = 1; i < segments.length; i += 1) expect(segments[i].start).toBeCloseTo(segments[i - 1].end)
    }
    expect(VIDEO_MAX_PHOTOS).toBe(25)
    expect(() => buildTimeline(26, 0)).toThrow()
    expect(() => buildTimeline(0, 0)).toThrow()
  })

  it('la tasa de bits (con y sin audio) mantiene el archivo por debajo del límite', () => {
    for (const seconds of [10, 22, 45, 60]) {
      expect((videoBitrate(seconds) * seconds) / 8).toBeLessThan(VIDEO_MAX_BYTES)
      expect(((videoBitrate(seconds, true) + AUDIO_BITS_PER_SECOND) * seconds) / 8).toBeLessThan(VIDEO_MAX_BYTES)
    }
  })

  it('el movimiento se mantiene acotado', () => {
    for (const motion of [0, 1, 2, 3]) {
      for (const p of [-1, 0, 0.5, 1, 2]) {
        const f = motionFrame(motion, p)
        expect(f.zoom).toBeGreaterThanOrEqual(1)
        expect(f.zoom).toBeLessThanOrEqual(1.12)
      }
    }
  })

  it('solo mantiene decodificadas unas pocas fotografías a la vez, aunque sean 25', () => {
    const timeline = buildTimeline(25, 0)
    for (let t = 0; t < timeline.duration; t += 0.5) {
      const needed = photosNeeded(timeline, t)
      expect(needed.length).toBeLessThanOrEqual(6)
      const segment = timeline.segments.find(s => t >= s.start && t < s.end)!
      expect(needed).toContain(segment.photo)
    }
  })

  it('cada parte del vídeo muestra los datos reales; una foto aún no cargada no rompe el fotograma', () => {
    const content = buildPromoContent(source())
    const timeline = buildTimeline(3, 0)
    const pics = imgs(3)
    const at = (kind: string, available = true) => {
      const segment = timeline.segments.find(s => s.kind === kind)!
      const { ctx } = fakeContext()
      return drawVideoFrame(ctx, content, i => (available ? pics[i] : null), timeline, 0, segment.start + 0.6).join('\n')
    }
    expect(at('intro')).toContain('325.000 €')
    expect(at('photo')).toContain('3 habitaciones')
    expect(at('features')).toContain('Ascensor')
    expect(at('outro')).toContain('Pide tu visita hoy')
    expect(at('photo', false)).toContain('3 habitaciones')
  })
})

// MP4 fragmentado mínimo como el de MediaRecorder (para finalizeRecording).
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const str = (s: string) => [...s].map(c => c.charCodeAt(0))
const box = (type: string, ...parts: number[][]) => {
  const body = parts.flat()
  return [...u32(8 + body.length), ...str(type), ...body]
}
const full = (v: number, f: number) => [v, (f >>> 16) & 255, (f >>> 8) & 255, f & 255]
const trak = (id: number, handler: string, ts: number) =>
  box('trak', box('tkhd', full(0, 3), u32(0), u32(0), u32(id), u32(0), u32(0), Array.from({ length: 60 }, () => 0)), box('mdia', box('mdhd', full(0, 0), u32(0), u32(0), u32(ts), u32(0), [0, 0, 0, 0]), box('hdlr', full(0, 0), u32(0), str(handler), Array.from({ length: 13 }, () => 0))))
function mp4(seconds: number, audio: boolean) {
  const out = [...box('ftyp', str('isom'), u32(0)), ...box('moov', box('mvhd', full(0, 0), u32(0), u32(0), u32(1000), u32(0), Array.from({ length: 80 }, () => 0)), trak(1, 'vide', 30000), ...(audio ? [trak(2, 'soun', 48000)] : []), box('mvex', box('trex', full(0, 0), u32(1), u32(1), u32(1000), u32(0), u32(0))))]
  for (let f = 0; f < seconds; f += 1) out.push(...box('moof', box('traf', box('tfhd', full(0, 0x020000), u32(1)), box('tfdt', full(1, 0), u32(0), u32(f * 30000)), box('trun', full(0, 0x1), u32(30), u32(0)))), ...box('mdat', [1, 2, 3]))
  return new Blob([new Uint8Array(out)], { type: 'video/mp4' })
}

describe('archivo grabado (DA-56)', () => {
  it('escribe la duración real en la cabecera y la devuelve', async () => {
    const result = await finalizeRecording(mp4(12, true), true, 99_000)
    expect(result).toMatchObject({ durationMs: 12_000, hasAudio: true, fixed: true })
    const info = inspectVideoContainer(new Uint8Array(await result.blob.arrayBuffer()))
    expect(info?.headerDurationMs).toBe(12_000)
  })

  it('si se pidió sonido y el archivo no lo lleva, falla en vez de devolver un vídeo mudo', async () => {
    await expect(finalizeRecording(mp4(5, false), true, 5000)).rejects.toBeInstanceOf(VideoRenderError)
    await expect(finalizeRecording(new Blob([new Uint8Array([1, 2, 3])]), false, 5000)).rejects.toBeInstanceOf(VideoRenderError)
    expect((await finalizeRecording(mp4(5, false), false, 5000)).hasAudio).toBe(false)
  })
})

const tone = (seconds: number, rate = 8000, channels = 1): PcmAudio => ({
  sampleRate: rate,
  channels: Array.from({ length: channels }, () => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate))),
})

describe('banda sonora (DA-54)', () => {
  it('pista más corta: se repite sin huecos hasta la duración exacta del vídeo', () => {
    const out = buildSoundtrack(tone(3), 20, { volume: 1, fadeInSec: 0, fadeOutSec: 0 })
    expect(out.channels).toHaveLength(2)
    expect(out.channels[0].length).toBe(20 * 8000)
    // Ningún tramo de 0,25 s queda en silencio (salvo las rampas de 30 ms de los extremos).
    for (let start = 0.1; start < 19.6; start += 0.25) expect(rms(out.channels[0], Math.round(start * 8000), Math.round((start + 0.25) * 8000))).toBeGreaterThan(0.1)
  })

  it('pista más larga: termina con el vídeo y con fundido de salida', () => {
    const out = buildSoundtrack(tone(30), 10, { volume: 1, fadeInSec: 0, fadeOutSec: 2 })
    const ch = out.channels[0]
    expect(ch.length).toBe(80_000)
    expect(rms(ch, 0, 8000)).toBeGreaterThan(0.3)
    expect(rms(ch, 79_000, 80_000)).toBeLessThan(0.05)
    expect(Math.abs(ch[ch.length - 1])).toBeLessThan(0.001)
  })

  it('duración similar: se reproduce entera; volumen y fundido de entrada se aplican', () => {
    const loud = buildSoundtrack(tone(10), 10, { volume: 1, fadeInSec: 0, fadeOutSec: 0 })
    const quiet = buildSoundtrack(tone(10), 10, { volume: 0.25, fadeInSec: 1, fadeOutSec: 0 })
    expect(rms(quiet.channels[0], 16_000, 24_000) / rms(loud.channels[0], 16_000, 24_000)).toBeCloseTo(0.25, 2)
    expect(rms(quiet.channels[0], 0, 800)).toBeLessThan(rms(quiet.channels[0], 7000, 8000))
    expect(Math.abs(loud.channels[0][0])).toBe(0)
  })

  it('mono a estéreo, sin saturar y con error claro si la pista está vacía', () => {
    const out = buildSoundtrack({ sampleRate: 8000, channels: [new Float32Array(16_000).fill(5)] }, 1, { volume: 1, fadeInSec: 0, fadeOutSec: 0 })
    expect(Math.max(...out.channels[1])).toBeLessThanOrEqual(1)
    expect(() => buildSoundtrack({ sampleRate: 8000, channels: [new Float32Array(0)] }, 1, { volume: 1, fadeInSec: 0, fadeOutSec: 0 })).toThrow()
  })

  it('WAV de previsualización con cabecera correcta', async () => {
    const wav = new DataView(await encodeWav(tone(1, 8000, 2)).arrayBuffer())
    expect(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3))).toBe('RIFF')
    expect(wav.getUint16(22, true)).toBe(2)
    expect(wav.getUint32(24, true)).toBe(8000)
    expect(wav.getUint32(40, true)).toBe(8000 * 2 * 2)
  })
})

describe('pistas predeterminadas (DA-54)', () => {
  it.each(AUDIO_PRESETS.map(preset => preset.id))('%s: suena, no satura, dura lo pedido y es siempre igual', id => {
    const a = synthesizePreset(id, 6, 16_000)
    const b = synthesizePreset(id, 6, 16_000)
    expect(a.channels).toHaveLength(2)
    expect(a.channels[0].length).toBe(96_000)
    expect(rms(a.channels[0], 16_000, 80_000)).toBeGreaterThan(0.02)
    expect(Math.max(...a.channels[0].map(Math.abs))).toBeLessThanOrEqual(1)
    expect(a.channels[1]).toEqual(b.channels[1])
  })

  it('las cinco pistas son distintas', () => {
    const fingerprints = AUDIO_PRESETS.map(preset => {
      const { channels } = synthesizePreset(preset.id, 3, 8000)
      return Array.from({ length: 12 }, (_, i) => rms(channels[0], i * 2000, (i + 1) * 2000).toFixed(3)).join(',')
    })
    expect(new Set(fingerprints).size).toBe(AUDIO_PRESETS.length)
  })
})

describe('galería y mensajes', () => {
  it('valida tipo, tamaño y archivos vacíos antes de subir', () => {
    expect(validatePhotoFile({ name: 'a.jpg', type: 'image/jpeg', size: 10 })).toBeNull()
    expect(validatePhotoFile({ name: 'a.gif', type: 'image/gif', size: 10 })).toMatch(/no es una imagen/)
    expect(validatePhotoFile({ name: 'a.png', type: 'image/png', size: 0 })).toMatch(/vacío/)
    expect(validatePhotoFile({ name: 'a.webp', type: 'image/webp', size: PHOTO_INPUT_MAX_BYTES + 1 })).toMatch(/25 MB/)
  })

  it('reduce sin ampliar y conserva la proporción', () => {
    expect(fitWithin(4800, 3600)).toEqual({ width: PHOTO_MAX_SIDE, height: 1800 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('subida múltiple: descarta repetidos de la misma selección y lo que excede las 50', () => {
    const files = [
      { name: 'a.jpg', size: 1, lastModified: 1 },
      { name: 'b.jpg', size: 2, lastModified: 1 },
      { name: 'a.jpg', size: 1, lastModified: 1 },
      { name: 'c.jpg', size: 3, lastModified: 1 },
    ]
    const plan = planUploads(files, 2, 50)
    expect(plan.accepted.map(item => item.file.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(plan.states.map(state => state.status)).toEqual(['pending', 'pending', 'error', 'error'])
    expect(plan.states[2].message).toMatch(/repetido/)
    expect(plan.states[3].message).toMatch(/50/)
    expect(fileKey(files[0])).toBe(fileKey(files[2]))
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `f${i}.jpg`, size: i + 1 }))
    expect(planUploads(many, 50, 50).accepted).toHaveLength(50)
  })

  it('subidas con un máximo de tareas simultáneas; un fallo no detiene a las demás', async () => {
    let running = 0
    let peak = 0
    const done: number[] = []
    await runPool(Array.from({ length: 12 }, (_, i) => i), 3, async i => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise(resolve => setTimeout(resolve, 2))
      running -= 1
      if (i === 4) return
      done.push(i)
    })
    expect(peak).toBe(3)
    expect(done).toHaveLength(11)
  })

  it('mueve una fotografía a su vecina o a cualquier posición de las 50', () => {
    expect(moveId(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveId(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    const fifty = Array.from({ length: 50 }, (_, i) => `p${i}`)
    const moved = moveTo(fifty, 49, 0)
    expect(moved[0]).toBe('p49')
    expect(moved).toHaveLength(50)
    expect(new Set(moved).size).toBe(50)
    expect(moveTo(fifty, 3, 3)).toBe(fifty)
    expect(moveTo(fifty, 3, 60)).toBe(fifty)
  })

  it('el vídeo toma por defecto las 25 primeras (la principal primero) y la duración se muestra legible', () => {
    const photos = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` }))
    expect(defaultVideoSelection(photos)).toHaveLength(25)
    expect(defaultVideoSelection(photos.slice(0, 3))).toEqual(['p0', 'p1', 'p2'])
    expect(formatDuration(19_000)).toBe('19 s')
    expect(formatDuration(60_000)).toBe('1 min 00 s')
  })

  it('explica cada fallo de generación', () => {
    expect(describeMediaError(new MediaRequestError('x', 409, 'NO_PHOTOS')).needsPhotos).toBe(true)
    expect(describeMediaError(new MediaRequestError('x', 409, 'SOURCE_CHANGED')).text).toMatch(/han cambiado/)
    expect(describeMediaError(new MediaRequestError('x', 409, 'VERSION_CONFLICT')).text).toMatch(/otra versión/)
    expect(describeMediaError(new MediaRequestError('Sin espacio.', 409, 'QUOTA_EXCEEDED')).text).toMatch(/Se conserva la versión anterior/)
    expect(describeMediaError(new VideoRenderError('Sin audio.')).text).toMatch(/Se conserva la versión anterior/)
    expect(describeMediaError(new DOMException('c', 'AbortError')).text).toMatch(/cancelada/)
  })

  it('cabeceras del guardado: plantilla y sorteo en el cartel; audio y códecs en el vídeo', () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    const poster = mediaHeaders(blob, { sourceHash: 'h', expectedVersion: 2, variant: 1, photoIds: ['a', 'b'], poster: { templateId: 'editorial', selection: 'random', drawId: 'd1' } })
    expect(poster).toMatchObject({ 'X-Template-Id': 'editorial', 'X-Template-Selection': 'random', 'X-Template-Draw': 'd1', 'X-Photo-Ids': 'a,b', 'X-Expected-Version': '2' })
    expect(poster['X-Audio-Source']).toBeUndefined()
    const video = mediaHeaders(new Blob(['x'], { type: 'video/mp4' }), { sourceHash: 'h', expectedVersion: 0, variant: 3, photoIds: ['a'], durationMs: 15_000, codecs: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', audio: { source: 'preset', trackId: 'piano-sereno', volume: 70, fadeInMs: 1000, fadeOutMs: 2000 } })
    expect(video).toMatchObject({ 'X-Audio-Source': 'preset', 'X-Audio-Track': 'piano-sereno', 'X-Audio-Volume': '70', 'X-Audio-Fade-In-Ms': '1000', 'X-Audio-Fade-Out-Ms': '2000', 'X-Media-Duration-Ms': '15000' })
    const silent = mediaHeaders(new Blob(['x'], { type: 'video/webm' }), { sourceHash: 'h', expectedVersion: 0, variant: 3, photoIds: ['a'], audio: { source: 'none' } })
    expect(silent['X-Audio-Source']).toBe('none')
    expect(silent['X-Audio-Track']).toBeUndefined()
  })
})

describe('selección de fotografías del vídeo (DA-58)', () => {
  const photos = [
    { id: 'a', isPrimary: false },
    { id: 'b', isPrimary: true },
    { id: 'c', isPrimary: false },
    { id: 'd', isPrimary: false },
  ]

  it('la principal va siempre primera; el resto conserva el orden elegido por el usuario', () => {
    expect(resolveVideoSelection(['d', 'b', 'a'], photos)).toEqual({ photos: [photos[1], photos[3], photos[0]], missing: false })
    // Aunque no esté en la selección, la principal se incluye.
    expect(resolveVideoSelection(['c'], photos).photos.map(p => p.id)).toEqual(['b', 'c'])
  })

  it('una fotografía que ya no existe se descarta y se avisa (el componente responde SOURCE_CHANGED)', () => {
    expect(resolveVideoSelection(['b', 'borrada', 'c'], photos)).toEqual({ photos: [photos[1], photos[2]], missing: true })
  })

  it('nunca más de 25', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, isPrimary: i === 7 }))
    const result = resolveVideoSelection(many.map(p => p.id), many)
    expect(result.photos).toHaveLength(VIDEO_MAX_PHOTOS)
    expect(result.photos[0].id).toBe('p7')
  })

  it('mover: la principal (posición 0) no se mueve ni puede ser desplazada', () => {
    const ids = ['b', 'a', 'c', 'd']
    expect(moveInSelection(ids, 2, -1)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveInSelection(ids, 1, 1)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveInSelection(ids, 1, -1)).toBe(ids)
    expect(moveInSelection(ids, 0, 1)).toBe(ids)
    expect(moveInSelection(ids, 3, 1)).toBe(ids)
  })
})

describe('subida directa desde el navegador (DA-58)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('preparación del cartel y del vídeo: solo metadatos; nunca una ruta de almacenamiento', () => {
    const video = new Blob(['x'.repeat(10)], { type: 'video/webm' })
    const request = mediaPrepare('g1', 'video', video, { sourceHash: 'h', expectedVersion: 2, variant: 3, photoIds: ['b', 'a'], durationMs: 12_000, audio: { source: 'none' } })
    expect(request).toEqual({
      kind: 'video', contentType: 'video/webm', size: 10, generationId: 'g1',
      media: { sourceHash: 'h', expectedVersion: 2, variant: 3, photoIds: ['b', 'a'], durationMs: 12_000, audio: { source: 'none', trackId: null, volume: null, fadeInMs: null, fadeOutMs: null } },
    })
    expect(JSON.stringify(request)).not.toMatch(/pathname|storageKey/)
  })

  // XMLHttpRequest simulado: registra lo enviado y responde con los estados indicados en orden.
  function fakeXhr(statuses: (number | 'network')[], progressEvent = { loaded: 5, total: 10 }) {
    const sent: { method: string; url: string; headers: Record<string, string>; withCredentials: boolean }[] = []
    class FakeXhr {
      upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      status = 0
      withCredentials = true
      private request = { method: '', url: '', headers: {} as Record<string, string> }
      open(method: string, url: string) { this.request = { method, url, headers: {} } }
      setRequestHeader(name: string, value: string) { this.request.headers[name] = value }
      abort() { this.onabort?.() }
      send() {
        sent.push({ ...this.request, withCredentials: this.withCredentials })
        const next = statuses.shift() ?? 200
        queueMicrotask(() => {
          this.upload.onprogress?.({ lengthComputable: true, ...progressEvent })
          if (next === 'network') return this.onerror?.()
          this.status = next
          this.onload?.()
        })
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    return sent
  }

  const upload = { method: 'PUT' as const, url: 'https://almacen.example/u/x.png?firma=1', headers: { 'Content-Type': 'image/png' } }

  it('envía a la URL firmada sin cookies, con su cabecera, e informa del progreso', async () => {
    const sent = fakeXhr([200])
    const progress: number[] = []
    await transferFile(upload, new Blob(['x']), { onProgress: value => progress.push(value) })
    expect(sent).toEqual([{ method: 'PUT', url: upload.url, headers: { 'Content-Type': 'image/png' }, withCredentials: false }])
    // El 100 % solo llega con la respuesta del almacenamiento.
    expect(progress).toEqual([0.5, 1])
  })

  it('el progreso no pasa del 99 % hasta que responde el almacenamiento (Firefox lo da por enviado al llenar el búfer)', async () => {
    fakeXhr([500, 200], { loaded: 10, total: 10 })
    vi.useFakeTimers()
    const progress: number[] = []
    const done = transferFile(upload, new Blob(['x']), { onProgress: value => progress.push(value) })
    await vi.runAllTimersAsync()
    await done
    // Primer intento: todos los bytes «enviados» pero respuesta 500 → no hay 100 %; segundo: 100 % al responder.
    expect(progress).toEqual([UPLOAD_PROGRESS_CAP, UPLOAD_PROGRESS_CAP, 1])
  })

  it('reintenta errores de red y 5xx, no los 4xx', async () => {
    vi.useFakeTimers()
    const sent = fakeXhr(['network', 503, 200])
    const done = transferFile(upload, new Blob(['x']))
    await vi.runAllTimersAsync()
    await done
    expect(sent).toHaveLength(1 + TRANSFER_RETRIES)
    vi.useRealTimers()
    const refused = fakeXhr([403])
    await expect(transferFile(upload, new Blob(['x']))).rejects.toMatchObject({ status: 403, code: 'TRANSFER_FAILED' })
    expect(refused).toHaveLength(1)
  })

  it('cancelar aborta el envío', async () => {
    fakeXhr([200])
    const controller = new AbortController()
    controller.abort()
    await expect(transferFile(upload, new Blob(['x']), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('descarga con nombre propio (DA-58)', () => {
  it('el nombre coincide con el que propone la API, para cartel y vídeo', () => {
    expect(mediaDownloadName({ kind: 'poster', contentType: 'image/jpeg', url: '/api/generations/cg123/media/poster/file?v=3' })).toBe('estateforge-cartel-cg123.jpg')
    expect(mediaDownloadName({ kind: 'video', contentType: 'video/mp4', url: '/api/generations/cg123/media/video/file?v=1' })).toBe('estateforge-video-cg123.mp4')
    expect(mediaDownloadName({ kind: 'video', contentType: 'video/webm', url: '/x' })).toBe('estateforge-video-anuncio.webm')
  })
})

describe('cartel y vídeo con IA (DA-72): datos exactos, fotografías reales y rótulo', () => {
  it('el cartel con IA dibuja el fondo, solo fotografías reales (máx. 3, la principal primero) y los datos del anuncio', () => {
    const background = { width: 928, height: 1152 }
    const pics = imgs(5)
    const { ctx, texts, images } = fakeContext()
    const { photosUsed } = drawAiPoster(ctx, buildPromoContent(source()), background, pics)
    expect(photosUsed).toBe(3)
    expect(images[0]).toBe(background)
    expect(images.slice(1)).toEqual(pics.slice(0, 3))
    const all = texts.join('\n')
    expect(all).toContain('325.000 €')
    expect(all).toMatch(/Chamberí/)
    expect(all).toContain(AI_POSTER_LABEL)
    expect(all).not.toMatch(/undefined|null|NaN/)
    expect(all).not.toContain('Calle')
  })

  it('el vídeo con IA lleva el rótulo en todo momento y los datos exactos en la presentación y el cierre', () => {
    const content = buildPromoContent(source())
    for (const t of [0.5, AI_INTRO_SECONDS + 1, AI_INTRO_SECONDS + 6 + 1]) {
      const { ctx } = fakeContext()
      const texts = drawAiVideoFrame(ctx, content, { width: 1280, height: 720 }, 6, t)
      expect(texts).toContain(AI_VIDEO_LABEL)
      if (t < AI_INTRO_SECONDS || t > AI_INTRO_SECONDS + 6) expect(texts.join(' ')).toContain('325.000 €')
    }
  })

  it('coste: precio publicado con fuente y fecha; sin precio, lo dice', () => {
    const model = { id: 'm', label: 'M', purpose: 'video' as const, stability: 'GA', maxReferenceImages: 6, notes: '', pricing: { usd: 0.0695, unit: 'second' as const, detail: '≈0,07 $ por segundo', source: 'https://aistudio.google.com/docs/pricing', consultedAt: '2026-11-11' } }
    expect(describeCost(model, 6)).toMatch(/0,417.*\$.*11\/11\/2026/)
    expect(describeCost({ ...model, pricing: null })).toContain('Consultar tarifa del proveedor')
  })

  it('sondeo con espera progresiva hasta un estado final, sin inventar progreso', async () => {
    const statuses = ['submitted', 'processing', 'processing', 'moderating', 'ready']
    const seen: string[] = []
    const waits: number[] = []
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ job: { id: 'j', kind: 'video', status: statuses.shift() } }), { status: 200 })))
    try {
      const job = await pollAiJob('j', update => seen.push(update.status), new AbortController().signal, async ms => void waits.push(ms))
      expect(job.status).toBe('ready')
      expect(seen).toEqual(['submitted', 'processing', 'processing', 'moderating', 'ready'])
      expect(waits).toEqual([2000, 3000, 4500, 6750])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('servicio de IA del navegador', () => {
  it('las acciones sin cuerpo (comprobar, cancelar, rechazar) no declaran JSON; guardar la clave sí, y nunca en la URL', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify({ job: { id: 'j' }, status: 'verified' }), { status: 200 }))))
    try {
      const { cancelAiJob, rejectAiJob, saveAiKey, verifyAiKey } = await import('@/services/aiMediaService')
      await verifyAiKey('simulador')
      await cancelAiJob('j')
      await rejectAiJob('j')
      await saveAiKey('gemini', 'AIzaSyFAKE-not-a-real-key-0123456789abcd')
      for (const call of calls.slice(0, 3)) expect(call.init.headers).toBeUndefined()
      expect(calls[3].init.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(calls[3].url).not.toContain('AIzaSy')
      expect(calls.every(call => call.init.credentials === 'include' && call.init.cache === 'no-store')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
