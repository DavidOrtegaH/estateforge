import type { AiTrialKind } from '@estateforge/shared'

// Las seis pruebas reales controladas propuestas (DA-93): una API directa y un agregador por modalidad.
// Elegidas por coste mínimo, disponibilidad documentada y adaptador implementado. Modelos, precios y
// parámetros verificados en la documentación oficial el 15/11/2026 (docs/proveedores-ia.md). Ninguna se
// ejecuta sola: cada una exige elegir una conexión, revisar el plan y confirmarla en Ajustes.

export interface TrialPreset {
  id: string
  title: string
  kind: AiTrialKind
  provider: string
  model: string
  /** Capacidad que se prueba. */
  capability: string
  durationSeconds?: number
  /** Solo vídeo: una de las resolutionOptions del modelo. */
  resolution?: string
  /** Imágenes sintéticas de referencia que se envían (0 o 1). */
  references: number
  /** Limitaciones conocidas de esta prueba. */
  notes: string
}

export const TRIAL_PRESETS: readonly TrialPreset[] = [
  { id: 'texto-directo', title: 'Texto · API directa', kind: 'text', provider: 'openai', model: 'gpt-6-luna', capability: 'Texto con salida estructurada (API Responses)', references: 0, notes: 'Un anuncio breve de un inmueble ficticio. El precio es por tokens: el importe se conoce al terminar, con los tokens que devuelva la API.' },
  { id: 'texto-agregador', title: 'Texto · agregador', kind: 'text', provider: 'groq', model: 'openai/gpt-oss-20b', capability: 'Texto con salida estructurada (API de chat de Groq)', references: 0, notes: 'Modelo de OpenAI (pesos abiertos) servido y facturado por Groq. La documentación de Groq no indica si su modo de esquema es estricto: la API valida el resultado igualmente.' },
  { id: 'imagen-directa', title: 'Imagen · API directa', kind: 'poster', provider: 'gemini', model: 'gemini-3.1-flash-lite-image', capability: 'Imagen de 1K sin referencias', references: 0, notes: 'El clasificador de seguridad es el propio de Gemini, con la misma clave.' },
  { id: 'imagen-agregador', title: 'Imagen · agregador', kind: 'poster', provider: 'runway', model: 'nano_banana_2.1', capability: 'Imagen de 1K sin referencias (848×1264)', references: 0, notes: 'Modelo de Google servido y facturado por Runway. Runway no clasifica: hace falta el clasificador de Gemini con tu clave.' },
  { id: 'video-directo', title: 'Vídeo · API directa', kind: 'video', provider: 'xai', model: 'grok-imagine-video-1.5-lite', capability: 'Vídeo de 4 s a partir de una imagen sintética', durationSeconds: 4, references: 1, notes: 'La documentación de xAI publica 0,02 $/s sin distinguir resolución y no indica el precio de la imagen de entrada, así que se pide la resolución por defecto del catálogo (720p) y la entrada no se estima. Hace falta el clasificador de vídeo de Gemini.' },
  { id: 'video-agregador', title: 'Vídeo · agregador', kind: 'video', provider: 'runway', model: 'gemini_omni_flash_1.2', capability: 'Vídeo de 4 s a 360p a partir de una imagen sintética', durationSeconds: 4, resolution: '360p', references: 1, notes: 'Modelo de Google servido y facturado por Runway. Siempre genera audio: EstateForge lo descarta y usa el sonido elegido o silencio. Hace falta el clasificador de vídeo de Gemini.' },
]
