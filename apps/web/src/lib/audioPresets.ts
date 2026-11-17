import type { AudioPresetId } from '@estateforge/shared'

import type { PcmAudio } from './soundtrack'

// Pistas predeterminadas de EstateForge (DA-54). Son composiciones originales escritas para este
// proyecto como código: una partitura (acordes, ritmo y melodía) y unos instrumentos sintetizados
// (piano aditivo, colchón, campana, bajo, cuerda pulsada Karplus-Strong y percusión de ruido). No hay
// archivos de audio de terceros ni muestras: el sonido se calcula en el navegador, de forma
// determinista, para la duración exacta del vídeo. Por eso no ocupan almacenamiento.

/** 32 kHz: suficiente para estos instrumentos y un tercio menos de cálculo que 44,1 kHz. */
export const PRESET_SAMPLE_RATE = 32_000

const midi = (note: number) => 440 * 2 ** ((note - 69) / 12)

/** Generador pseudoaleatorio determinista: el mismo preset suena igual siempre. */
function seeded(seed: number) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 1_000_000) / 1_000_000
  }
}

class Mix {
  readonly sampleRate: number
  readonly length: number
  readonly left: Float32Array
  readonly right: Float32Array
  constructor(sampleRate: number, length: number) {
    this.sampleRate = sampleRate
    this.length = length
    this.left = new Float32Array(length)
    this.right = new Float32Array(length)
  }

  /** Suma una señal mono generada muestra a muestra con panorámica (-1 izquierda, 1 derecha). */
  add(start: number, duration: number, pan: number, sample: (t: number, i: number) => number) {
    const from = Math.max(0, Math.round(start * this.sampleRate))
    const to = Math.min(this.length, Math.round((start + duration) * this.sampleRate))
    const l = Math.cos(((pan + 1) * Math.PI) / 4)
    const r = Math.sin(((pan + 1) * Math.PI) / 4)
    for (let i = from; i < to; i += 1) {
      const value = sample((i - from) / this.sampleRate, i - from)
      this.left[i] += value * l
      this.right[i] += value * r
    }
  }
}

// ------------------------------------------------------------------------------ Instrumentos

function piano(mix: Mix, start: number, note: number, velocity: number, pan = 0) {
  const f = midi(note)
  const partials = [1, 2, 3, 4, 5, 6].map(k => ({ ratio: k * (1 + 0.0004 * k * k), amp: velocity / k ** 1.6, decay: 1.1 + k * 0.9 + note / 60 }))
  mix.add(start, 3.2, pan, t => {
    const attack = Math.min(1, t / 0.004)
    let v = 0
    for (const p of partials) v += p.amp * Math.exp(-t * p.decay) * Math.sin(2 * Math.PI * f * p.ratio * t)
    return 0.22 * attack * v
  })
}

function pad(mix: Mix, start: number, duration: number, notes: number[], gain: number) {
  for (const [n, note] of notes.entries()) {
    const f = midi(note)
    const pan = (n / Math.max(1, notes.length - 1)) * 1.2 - 0.6
    mix.add(start, duration + 1.6, pan, t => {
      const attack = Math.min(1, t / 1.2)
      const release = t > duration ? Math.max(0, 1 - (t - duration) / 1.6) : 1
      // Dos osciladores ligeramente desafinados con pocos armónicos: sonido cálido, sin aristas.
      let v = 0
      for (const detune of [-0.0035, 0.0035]) for (let k = 1; k <= 4; k += 1) v += Math.sin(2 * Math.PI * f * (1 + detune) * k * t) / (k * k)
      return gain * attack * release * v * 0.5
    })
  }
}

function bell(mix: Mix, start: number, note: number, gain: number, pan = 0.3) {
  const f = midi(note)
  mix.add(start, 2.6, pan, t => gain * Math.min(1, t / 0.002) * (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.2) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 4) + 0.2 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 7)))
}

function bass(mix: Mix, start: number, duration: number, note: number, gain: number) {
  const f = midi(note)
  mix.add(start, duration + 0.15, 0, t => {
    const env = Math.min(1, t / 0.01) * (t > duration ? Math.max(0, 1 - (t - duration) / 0.15) : Math.exp(-t * 0.9))
    return gain * env * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t))
  })
}

function stab(mix: Mix, start: number, notes: number[], gain: number) {
  for (const [n, note] of notes.entries()) {
    const f = midi(note)
    mix.add(start, 0.45, n % 2 ? 0.35 : -0.35, t => {
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 7)
      let v = 0
      for (let k = 1; k <= 7; k += 2) v += Math.sin(2 * Math.PI * f * k * t) / k
      return gain * env * v
    })
  }
}

function pluck(mix: Mix, start: number, note: number, gain: number, pan: number, random: () => number) {
  // Karplus-Strong: ráfaga de ruido en una línea de retardo con un filtro de media que la apaga.
  const period = Math.max(2, Math.round(mix.sampleRate / midi(note)))
  const line = new Float32Array(period)
  for (let i = 0; i < period; i += 1) line[i] = random() * 2 - 1
  let index = 0
  mix.add(start, 2.4, pan, (_t, i) => {
    const next = (index + 1) % period
    const value = line[index]
    line[index] = 0.4985 * (line[index] + line[next])
    index = next
    return gain * value * Math.min(1, i / 8)
  })
}

function kick(mix: Mix, start: number, gain: number) {
  let phase = 0
  mix.add(start, 0.35, 0, t => {
    phase += (2 * Math.PI * (45 + 80 * Math.exp(-t * 30))) / mix.sampleRate
    return gain * Math.exp(-t * 9) * Math.sin(phase)
  })
}

function hat(mix: Mix, start: number, gain: number, random: () => number) {
  let previous = 0
  mix.add(start, 0.06, 0.25, t => {
    const noise = random() * 2 - 1
    const high = noise - previous // diferencia: realza los agudos
    previous = noise
    return gain * Math.exp(-t * 70) * high
  })
}

/** Reverberación sencilla (filtros peine y paso todo de Schroeder) para dar espacio. */
function reverb(channel: Float32Array, sampleRate: number, wet: number) {
  const combs = [1557, 1617, 1491, 1422].map(n => ({ buf: new Float32Array(Math.round((n * sampleRate) / 44100)), i: 0 }))
  const passes = [225, 556].map(n => ({ buf: new Float32Array(Math.round((n * sampleRate) / 44100)), i: 0 }))
  for (let s = 0; s < channel.length; s += 1) {
    const dry = channel[s]
    let out = 0
    for (const comb of combs) {
      const delayed = comb.buf[comb.i]
      comb.buf[comb.i] = dry + delayed * 0.78
      comb.i = (comb.i + 1) % comb.buf.length
      out += delayed
    }
    out *= 0.25
    for (const pass of passes) {
      const delayed = pass.buf[pass.i]
      const value = -0.5 * out + delayed
      pass.buf[pass.i] = out + 0.5 * delayed
      pass.i = (pass.i + 1) % pass.buf.length
      out = value
    }
    channel[s] = dry * (1 - wet) + out * wet
  }
}

// ------------------------------------------------------------------------------- Partituras

type Score = (mix: Mix, seconds: number) => void

const pianoSereno: Score = (mix, seconds) => {
  const beat = 60 / 72
  // Do maj7, La m7, Fa maj7, Sol 6 (con la nota más grave en el bajo).
  const chords = [
    [48, 55, 64, 71, 76],
    [45, 52, 60, 67, 72],
    [41, 48, 57, 64, 69],
    [43, 50, 59, 64, 71],
  ]
  const pattern = [1, 2, 3, 4, 3, 2, 4, 3]
  for (let bar = 0; bar * 4 * beat < seconds; bar += 1) {
    const chord = chords[bar % chords.length]
    const t0 = bar * 4 * beat
    piano(mix, t0, chord[0] - 12, 0.55, -0.2)
    pattern.forEach((step, i) => piano(mix, t0 + (i * beat) / 2, chord[step], i === 0 ? 0.5 : 0.36, -0.3 + step * 0.15))
    if (bar % 2 === 1) piano(mix, t0 + 2 * beat, chord[4] + 12, 0.28, 0.4)
  }
}

const hogarCalido: Score = (mix, seconds) => {
  const beat = 60 / 80
  const chords = [
    [53, 57, 60, 64, 67],
    [50, 53, 57, 60, 64],
    [46, 50, 53, 57, 62],
    [48, 53, 55, 60, 65],
  ]
  const melody = [77, 76, 72, 74, 72, 69, 72, 74]
  for (let bar = 0; bar * 4 * beat < seconds; bar += 1) {
    const chord = chords[bar % chords.length]
    const t0 = bar * 4 * beat
    pad(mix, t0, 4 * beat, chord.slice(1), 0.07)
    bass(mix, t0, 1.6 * beat, chord[0] - 24, 0.32)
    bass(mix, t0 + 2 * beat, 1.6 * beat, chord[0] - 24, 0.26)
    bell(mix, t0 + beat, melody[(bar * 2) % melody.length], 0.12, 0.35)
    bell(mix, t0 + 3 * beat, melody[(bar * 2 + 1) % melody.length], 0.1, -0.25)
  }
}

const urbanoModerno: Score = (mix, seconds) => {
  const beat = 60 / 100
  const random = seeded(17)
  const chords = [
    [57, 60, 64, 69],
    [53, 57, 60, 65],
    [48, 55, 60, 64],
    [55, 59, 62, 67],
  ]
  for (let bar = 0; bar * 4 * beat < seconds; bar += 1) {
    const chord = chords[bar % chords.length]
    const t0 = bar * 4 * beat
    for (let i = 0; i < 8; i += 1) {
      const t = t0 + (i * beat) / 2
      hat(mix, t, i % 2 ? 0.08 : 0.05, random)
      if (i % 2 === 1) stab(mix, t, chord.slice(1), 0.05)
      bass(mix, t, beat / 2.4, chord[0] - 24, 0.22)
    }
    kick(mix, t0, 0.7)
    kick(mix, t0 + 2 * beat, 0.6)
    if (bar % 2 === 1) kick(mix, t0 + 3.5 * beat, 0.4)
  }
}

const brisaAmbiental: Score = (mix, seconds) => {
  const random = seeded(29)
  const span = 8
  const chords = [
    [50, 57, 62, 66, 69],
    [47, 54, 59, 62, 66],
    [43, 50, 55, 59, 62],
    [45, 52, 57, 61, 64],
  ]
  for (let i = 0; i * span < seconds; i += 1) {
    pad(mix, i * span, span, chords[i % chords.length], 0.06)
    if (i % 2 === 0) bell(mix, i * span + 2.5, chords[i % chords.length][3] + 12, 0.05, -0.4)
    bell(mix, i * span + 5.5, chords[i % chords.length][4] + 12, 0.04, 0.45)
  }
  // Aire: ruido suave filtrado con un vaivén lento de volumen.
  let low = 0
  mix.add(0, seconds, 0, t => {
    low += 0.02 * (random() * 2 - 1 - low)
    return low * 0.5 * (0.6 + 0.4 * Math.sin((2 * Math.PI * t) / 11))
  })
}

const acusticoSuave: Score = (mix, seconds) => {
  const beat = 60 / 90
  const random = seeded(41)
  // Sol, Mi m, Do, Re: bajo alterno y punteo de tres cuerdas.
  const chords = [
    [43, 50, 55, 59, 62],
    [40, 47, 55, 59, 64],
    [36, 48, 55, 60, 64],
    [38, 50, 57, 62, 66],
  ]
  const picks = [0, 3, 2, 4, 1, 3, 2, 4]
  for (let bar = 0; bar * 4 * beat < seconds; bar += 1) {
    const chord = chords[bar % chords.length]
    const t0 = bar * 4 * beat
    picks.forEach((string, i) => pluck(mix, t0 + (i * beat) / 2, chord[string], string <= 1 ? 0.55 : 0.4, -0.4 + string * 0.2, random))
  }
}

const SCORES: Record<AudioPresetId, { score: Score; reverb: number }> = {
  'piano-sereno': { score: pianoSereno, reverb: 0.32 },
  'hogar-calido': { score: hogarCalido, reverb: 0.28 },
  'urbano-moderno': { score: urbanoModerno, reverb: 0.12 },
  'brisa-ambiental': { score: brisaAmbiental, reverb: 0.45 },
  'acustico-suave': { score: acusticoSuave, reverb: 0.22 },
}

/** Normaliza a un pico de -1 dBFS y suaviza los picos que pudieran quedar. */
function master(mix: Mix) {
  let peak = 0
  for (const channel of [mix.left, mix.right]) for (const value of channel) peak = Math.max(peak, Math.abs(value))
  const gain = peak > 0 ? 0.89 / peak : 1
  for (const channel of [mix.left, mix.right]) for (let i = 0; i < channel.length; i += 1) channel[i] = Math.tanh(channel[i] * gain * 1.05) / Math.tanh(1.05)
}

/** Sintetiza la pista predeterminada para la duración indicada (estéreo, PCM en coma flotante). */
export function synthesizePreset(id: AudioPresetId, seconds: number, sampleRate = PRESET_SAMPLE_RATE): PcmAudio {
  const entry = SCORES[id]
  if (!entry) throw new Error('Pista predeterminada desconocida.')
  const mix = new Mix(sampleRate, Math.max(1, Math.round(seconds * sampleRate)))
  entry.score(mix, seconds)
  reverb(mix.left, sampleRate, entry.reverb)
  reverb(mix.right, sampleRate, entry.reverb)
  master(mix)
  return { sampleRate, channels: [mix.left, mix.right] }
}
