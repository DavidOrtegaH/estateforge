import { AUDIO_MAX_BYTES, AUDIO_MAX_DURATION_MS, audioFormatOfName, audioFormatOfType, audioTypeOf, type AudioSource } from '@estateforge/shared'

import { formatBytes, formatDuration } from '@/lib/mediaUi'
import { decodeAudio, durationOf } from '@/lib/soundtrack'

// Elección de sonido del vídeo y comprobaciones de las pistas antes de subirlas (DA-54, DA-55).

export interface AudioChoice {
  source: AudioSource
  trackId: string | null
  volume: number
  fadeInMs: number
  fadeOutMs: number
}

export const DEFAULT_AUDIO: AudioChoice = { source: 'none', trackId: null, volume: 80, fadeInMs: 1000, fadeOutMs: 2000 }

/** Comprobaciones antes de subir una pista: formato, tamaño, y que este navegador la pueda decodificar. */
export async function checkAudioFile(file: File): Promise<{ contentType: string; durationMs: number } | string> {
  const format = audioFormatOfType(file.type) ?? (file.type === '' || file.type === 'application/octet-stream' ? audioFormatOfName(file.name) : undefined)
  if (!format) return `«${file.name}» no es MP3, WAV, OGG ni M4A.`
  if (file.size === 0) return `«${file.name}» está vacío.`
  if (file.size > AUDIO_MAX_BYTES) return `«${file.name}» supera los ${formatBytes(AUDIO_MAX_BYTES)}.`
  try {
    const decoded = await decodeAudio(await file.arrayBuffer())
    const durationMs = Math.round(durationOf(decoded) * 1000)
    if (durationMs < 1000) return `«${file.name}» dura menos de un segundo.`
    if (durationMs > AUDIO_MAX_DURATION_MS) return `«${file.name}» dura más de ${formatDuration(AUDIO_MAX_DURATION_MS)}.`
    return { contentType: audioTypeOf(format), durationMs }
  } catch (error) {
    return error instanceof Error ? error.message : 'No se ha podido leer la pista.'
  }
}

