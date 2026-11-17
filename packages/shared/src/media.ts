// Límites de la galería, del material publicitario y del audio, comunes a la web y a la API
// (DA-46, DA-51 a DA-55).
//
// Todos los archivos pasan por la API, que comprueba la propiedad y el contenido real: por eso cada
// archivo queda por debajo del límite de 4,5 MB por petición de las funciones de Vercel. La web
// reduce antes las fotografías grandes; la API nunca confía en esa reducción.

/** Fotografías por inmueble (DA-51). */
export const MAX_PROPERTY_PHOTOS = 50

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024
/** Suma máxima de las fotografías de un inmueble: 50 fotografías de 2 MB de media (DA-51). */
export const PROPERTY_PHOTOS_MAX_TOTAL_BYTES = 100 * 1024 * 1024
/** Miniatura que genera la web al subir cada fotografía (lado mayor y tamaño máximo). */
export const THUMBNAIL_MAX_SIDE = 480
export const THUMBNAIL_MAX_BYTES = 256 * 1024
export const POSTER_MAX_BYTES = 3 * 1024 * 1024
export const VIDEO_MAX_BYTES = 4 * 1024 * 1024

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type PhotoType = (typeof PHOTO_TYPES)[number]

export const POSTER_TYPES = ['image/jpeg', 'image/png'] as const
export const VIDEO_TYPES = ['video/webm', 'video/mp4'] as const

/** Lado mayor con el que la web reduce las fotografías antes de subirlas. */
export const PHOTO_MAX_SIDE = 2400

/** Cartel vertical 4:5, adecuado para redes y portales. */
export const POSTER_WIDTH = 1080
export const POSTER_HEIGHT = 1350

/** Vídeo horizontal 720p. */
export const VIDEO_WIDTH = 1280
export const VIDEO_HEIGHT = 720
export const VIDEO_MAX_DURATION_MS = 60_000
/**
 * Fotografías que admite un vídeo (DA-53): con 60 s como máximo, presentación y cierre, quedan al menos
 * 2 s por fotografía. Más fotografías obligarían a un ritmo demasiado rápido o a superar 4 MB.
 */
export const VIDEO_MAX_PHOTOS = 25

export const MEDIA_KINDS = ['poster', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export function isPhotoType(value: unknown): value is PhotoType {
  return typeof value === 'string' && (PHOTO_TYPES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------- Plantillas de cartel (DA-52)

export interface PosterTemplateInfo {
  id: string
  name: string
  description: string
  /** Versión del diseño: cambia si el dibujo cambia de forma visible. */
  version: number
  /** Fotografías que usa como máximo (la principal primero). */
  photos: number
}

export const POSTER_TEMPLATES = [
  { id: 'elegante', name: 'Elegante', description: 'Fondo crema, tipografía con serifa, foto enmarcada y filetes dorados; composición centrada.', version: 1, photos: 1 },
  { id: 'minimalista', name: 'Minimalista', description: 'Mucho blanco, una sola foto a lo ancho y datos en una rejilla limpia.', version: 1, photos: 1 },
  { id: 'editorial', name: 'Editorial', description: 'Titular de revista en mayúsculas, mosaico de tres fotos y texto en columnas.', version: 1, photos: 3 },
  { id: 'premium', name: 'Premium', description: 'Fondo oscuro con detalles dorados, foto a sangre con degradado y marco interior.', version: 1, photos: 2 },
  { id: 'fotografico', name: 'Fotográfico', description: 'Las fotos ocupan todo el cartel en mosaico; los datos, en una tarjeta translúcida.', version: 1, photos: 4 },
  { id: 'moderno', name: 'Moderno', description: 'Bloques de color, foto con corte diagonal, precio en etiqueta y características marcadas.', version: 1, photos: 2 },
] as const satisfies readonly PosterTemplateInfo[]

export type PosterTemplateId = (typeof POSTER_TEMPLATES)[number]['id']
export const POSTER_TEMPLATE_IDS = POSTER_TEMPLATES.map(template => template.id) as PosterTemplateId[]

export function findPosterTemplate(id: unknown): PosterTemplateInfo | undefined {
  return POSTER_TEMPLATES.find(template => template.id === id)
}

export const TEMPLATE_SELECTION_MODES = ['manual', 'random'] as const
export type TemplateSelectionMode = (typeof TEMPLATE_SELECTION_MODES)[number]

/**
 * Elige una plantilla de forma uniforme entre las indicadas. randomInt(n) debe devolver un entero
 * uniforme en [0, n); la API usa crypto.randomInt y las pruebas, una fuente controlada.
 */
export function pickUniform<T>(items: readonly T[], randomInt: (n: number) => number): T {
  if (items.length === 0) throw new Error('No hay elementos entre los que elegir.')
  if (items.length === 1) return items[0]
  const index = randomInt(items.length)
  if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('La fuente aleatoria ha devuelto un índice fuera de rango.')
  return items[index]
}

// ---------------------------------------------------------------- Audio (DA-54, DA-55)

/** Pistas originales de EstateForge: se sintetizan en el navegador a partir de código propio. */
export const AUDIO_PRESETS = [
  { id: 'piano-sereno', name: 'Piano sereno', description: 'Arpegios de piano tranquilos y elegantes (72 ppm).' },
  { id: 'hogar-calido', name: 'Hogar cálido', description: 'Colchón cálido con bajo suave y campanillas (80 ppm).' },
  { id: 'urbano-moderno', name: 'Urbano moderno', description: 'Acordes sintetizados con ritmo ligero y profesional (100 ppm).' },
  { id: 'brisa-ambiental', name: 'Brisa ambiental', description: 'Ambiente relajado y envolvente, sin percusión.' },
  { id: 'acustico-suave', name: 'Acústico suave', description: 'Guitarra punteada sintetizada, cercana y natural (90 ppm).' },
] as const

export type AudioPresetId = (typeof AUDIO_PRESETS)[number]['id']

export function findAudioPreset(id: unknown) {
  return AUDIO_PRESETS.find(preset => preset.id === id)
}

export const AUDIO_SOURCES = ['none', 'preset', 'library'] as const
export type AudioSource = (typeof AUDIO_SOURCES)[number]

/** Pistas personales: límite por archivo (por debajo de los 4,5 MB de Vercel), duración y cantidad. */
export const AUDIO_MAX_BYTES = 4 * 1024 * 1024
export const AUDIO_MIN_DURATION_MS = 1_000
export const AUDIO_MAX_DURATION_MS = 5 * 60_000
export const MAX_AUDIO_TRACKS_PER_USER = 20

/** Formatos admitidos: tipo canónico, alias que envían los navegadores y extensiones. */
export const AUDIO_FORMATS = [
  { format: 'mp3', type: 'audio/mpeg', aliases: ['audio/mpeg', 'audio/mp3'], extensions: ['mp3'] },
  { format: 'wav', type: 'audio/wav', aliases: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'], extensions: ['wav'] },
  { format: 'ogg', type: 'audio/ogg', aliases: ['audio/ogg', 'application/ogg'], extensions: ['ogg', 'oga', 'opus'] },
  { format: 'm4a', type: 'audio/mp4', aliases: ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'], extensions: ['m4a', 'mp4', 'aac'] },
] as const

export type AudioFormat = (typeof AUDIO_FORMATS)[number]['format']
export const AUDIO_DECLARED_TYPES: readonly string[] = AUDIO_FORMATS.flatMap(entry => [...entry.aliases])

/** Formato que corresponde a un tipo MIME declarado (con alias), o undefined. */
export function audioFormatOfType(type: unknown): AudioFormat | undefined {
  if (typeof type !== 'string') return undefined
  const clean = type.split(';')[0].trim().toLowerCase()
  return AUDIO_FORMATS.find(entry => (entry.aliases as readonly string[]).includes(clean))?.format
}

export function audioFormatOfName(name: unknown): AudioFormat | undefined {
  if (typeof name !== 'string') return undefined
  const extension = name.toLowerCase().split('.').pop() ?? ''
  return AUDIO_FORMATS.find(entry => (entry.extensions as readonly string[]).includes(extension))?.format
}

export function audioTypeOf(format: AudioFormat): string {
  return AUDIO_FORMATS.find(entry => entry.format === format)!.type
}

/** Volumen admitido (porcentaje) y fundidos (milisegundos). */
export const AUDIO_VOLUME_RANGE = [0, 100] as const
export const AUDIO_FADE_MAX_MS = 5_000
