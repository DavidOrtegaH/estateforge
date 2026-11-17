// Banda sonora del vídeo (DA-54): se prepara entera antes de grabar, con la duración exacta del vídeo,
// y después se reproduce una sola vez hacia la grabación. Así no depende de temporizadores y la
// duración de la presentación nunca cambia por la pista.
//
// - Pista más corta que el vídeo: se repite con un fundido cruzado de igual potencia en cada vuelta.
// - Pista más larga: se corta en la duración del vídeo con el fundido de salida elegido.
// - Siempre se aplican 30 ms de rampa en los extremos para que no haya chasquidos.

export interface PcmAudio {
  sampleRate: number
  channels: Float32Array[]
}

export interface SoundtrackOptions {
  /** 0 a 1. */
  volume: number
  fadeInSec: number
  fadeOutSec: number
  /** Duración del fundido cruzado al repetir la pista. */
  crossfadeSec?: number
}

const ANTI_CLICK_SEC = 0.03

export function durationOf(audio: PcmAudio): number {
  return (audio.channels[0]?.length ?? 0) / audio.sampleRate
}

/** Estéreo, con la duración exacta (en muestras de la pista) y el volumen y fundidos aplicados. */
export function buildSoundtrack(source: PcmAudio, durationSec: number, options: SoundtrackOptions): PcmAudio {
  if (!source.channels.length || !source.channels[0].length) throw new Error('La pista de audio está vacía.')
  const rate = source.sampleRate
  const total = Math.max(1, Math.round(durationSec * rate))
  const inputs = [source.channels[0], source.channels[1] ?? source.channels[0]]
  const length = inputs[0].length
  const out = [new Float32Array(total), new Float32Array(total)]

  if (length >= total) {
    for (let c = 0; c < 2; c += 1) out[c].set(inputs[c].subarray(0, total))
  } else {
    // Repetición: cada vuelta empieza `cross` muestras antes del final de la anterior.
    const cross = Math.max(1, Math.min(Math.round((options.crossfadeSec ?? 1.5) * rate), Math.floor(length / 4)))
    let start = 0
    let first = true
    while (start < total) {
      for (let i = 0; i < length && start + i < total; i += 1) {
        const position = start + i
        // Igual potencia: la vuelta nueva entra con seno y la anterior ya está saliendo con coseno.
        const fadeIn = !first && i < cross ? Math.sin(((i + 0.5) / cross) * (Math.PI / 2)) : 1
        const fadeOut = i >= length - cross && start + length - cross < total ?Math.cos(((i - (length - cross) + 0.5) / cross) * (Math.PI / 2)) : 1
        for (let c = 0; c < 2; c += 1) out[c][position] += inputs[c][i] * fadeIn * fadeOut
      }
      start += length - cross
      first = false
    }
  }

  const volume = Math.min(1, Math.max(0, options.volume))
  const fadeIn = Math.max(ANTI_CLICK_SEC, options.fadeInSec) * rate
  const fadeOut = Math.max(ANTI_CLICK_SEC, options.fadeOutSec) * rate
  for (let i = 0; i < total; i += 1) {
    let gain = volume
    if (i < fadeIn) gain *= i / fadeIn
    const remaining = total - 1 - i
    if (remaining < fadeOut) gain *= remaining / fadeOut
    for (let c = 0; c < 2; c += 1) out[c][i] = Math.max(-1, Math.min(1, out[c][i] * gain))
  }
  return { sampleRate: rate, channels: out }
}

/** Nivel RMS de un tramo (para pruebas y medidores). */
export function rms(channel: Float32Array, from = 0, to = channel.length): number {
  let sum = 0
  for (let i = from; i < to; i += 1) sum += channel[i] * channel[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}

/**
 * Decodifica un archivo de audio en el navegador. Si no puede (formato no admitido por este navegador
 * o archivo dañado), lanza un error claro: nunca se sustituye por silencio.
 */
export async function decodeAudio(bytes: ArrayBuffer): Promise<PcmAudio> {
  const Context = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!Context) throw new Error('Este navegador no puede procesar audio.')
  const ctx = new Context(2, 1, 44_100)
  let buffer: AudioBuffer
  try {
    buffer = await ctx.decodeAudioData(bytes.slice(0))
  } catch {
    throw new Error('Este navegador no puede decodificar la pista de audio (formato no compatible o archivo dañado). Elige otra pista.')
  }
  return { sampleRate: buffer.sampleRate, channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c).slice()) }
}

/** Codifica PCM como WAV de 16 bits (previsualización de las pistas predeterminadas). */
export function encodeWav(audio: PcmAudio): Blob {
  const channels = audio.channels.length
  const length = audio.channels[0].length
  const buffer = new ArrayBuffer(44 + length * channels * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + length * channels * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, audio.sampleRate, true)
  view.setUint32(28, audio.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, length * channels * 2, true)
  let offset = 44
  for (let i = 0; i < length; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      view.setInt16(offset, Math.max(-1, Math.min(1, audio.channels[c][i])) * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
