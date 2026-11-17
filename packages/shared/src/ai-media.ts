// Generación de carteles y vídeos con IA usando la API key de cada usuario (BYOK, DA-67 a DA-75).
// Aquí solo hay tipos, estados y límites comunes a la API y a la web. El catálogo de proveedores, sus
// endpoints y sus modelos admitidos los define y valida la API (apps/api/src/ai-media/registry.ts):
// la web los obtiene de GET /api/ai/providers y nunca los inventa.

/** Capacidades que un adaptador puede declarar. */
export const AI_CAPABILITIES = ['text', 'image', 'image-reference', 'video', 'video-reference', 'moderation', 'moderation-video', 'async-operations', 'model-discovery'] as const
export type AiCapability = (typeof AI_CAPABILITIES)[number]

/**
 * Proveedores de API admitidos (DA-82). «Proveedor» es quien sirve la API y factura al usuario; el
 * fabricante de cada modelo lo indica el catálogo. Los agregadores (openrouter, runway, fal, replicate)
 * sirven modelos de terceros con su propia clave y sus propias tarifas.
 */
export const AI_TEXT_PROVIDER_IDS = ['gemini', 'openai', 'anthropic', 'xai', 'mistral', 'deepseek', 'openrouter', 'groq'] as const
export const AI_MEDIA_ONLY_PROVIDER_IDS = ['bfl', 'stability', 'ideogram', 'recraft', 'runway', 'fal', 'replicate'] as const
export const AI_PROVIDER_IDS = [...AI_TEXT_PROVIDER_IDS, ...AI_MEDIA_ONLY_PROVIDER_IDS, 'simulador'] as const
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]
export const AI_PROVIDER_KINDS = ['direct', 'aggregator'] as const
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number]

/** Estado de un modelo según la documentación del proveedor. «unknown»: la documentación no lo indica. */
export const AI_MODEL_STATUSES = ['stable', 'preview', 'beta', 'experimental', 'deprecated', 'retired', 'unknown'] as const
export type AiModelStatus = (typeof AI_MODEL_STATUSES)[number]
export const AI_MODEL_STATUS_LABELS: Record<AiModelStatus, string> = {
  stable: 'Estable',
  preview: 'Preview',
  beta: 'Beta',
  experimental: 'Experimental',
  deprecated: 'En retirada',
  retired: 'Retirado',
  unknown: 'Estado no indicado por el proveedor',
}

/** Etiqueta personal de una conexión (varias cuentas del mismo proveedor). Vacía: conexión principal. */
export const AI_CONNECTION_LABEL_MAX = 40
export const AI_CONNECTION_LABEL_PATTERN = /^[\p{L}\p{N} ._-]{0,40}$/u
/** Conexiones guardadas como máximo por usuario y por proveedor. */
export const AI_MAX_CONNECTIONS_PER_PROVIDER = 5

/** Uso de un modelo dentro de EstateForge. */
export const AI_MODEL_PURPOSES = ['text', 'poster', 'video'] as const
export type AiModelPurpose = (typeof AI_MODEL_PURPOSES)[number]

export const AI_JOB_KINDS = ['poster', 'video'] as const
export type AiJobKind = (typeof AI_JOB_KINDS)[number]

/**
 * Estados de un trabajo de IA. «blocked» es el rechazo por moderación (entrada o salida); «failed», un
 * error del proveedor o de validación. Solo «ready» puede aceptarse, y solo tras la revisión del usuario.
 */
export const AI_JOB_STATUSES = ['pending', 'submitted', 'processing', 'moderating', 'ready', 'accepted', 'rejected', 'cancelled', 'failed', 'blocked', 'expired'] as const
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number]
export const AI_ACTIVE_JOB_STATUSES = ['pending', 'submitted', 'processing', 'moderating'] as const satisfies readonly AiJobStatus[]
export const AI_FINAL_JOB_STATUSES = ['accepted', 'rejected', 'cancelled', 'failed', 'blocked', 'expired'] as const satisfies readonly AiJobStatus[]

export const AI_JOB_STATUS_LABELS: Record<AiJobStatus, string> = {
  pending: 'Pendiente',
  submitted: 'Enviado al proveedor',
  processing: 'En proceso',
  moderating: 'Moderando',
  ready: 'Listo para revisión',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  failed: 'Error',
  blocked: 'Bloqueado por moderación',
  expired: 'Caducado',
}

/** Estado de una conexión guardada (credencial del usuario). */
export const AI_CONNECTION_STATUSES = ['unverified', 'verified', 'invalid', 'error'] as const
export type AiConnectionStatus = (typeof AI_CONNECTION_STATUSES)[number]

/**
 * Categorías controladas de moderación: lo único que se guarda y se muestra de un bloqueo (nunca el
 * detalle interno del filtro del proveedor).
 */
export const AI_MODERATION_CATEGORIES = [
  'sexual_minors',
  'sexual_explicit',
  'non_consensual_intimate',
  'violence',
  'hate',
  'harassment',
  'dangerous_illegal',
  'impersonation',
  'housing_discrimination',
  'real_estate_fraud',
  'deceptive_alteration',
  'invented_property_data',
  'prompt_injection',
  'text_in_generated_media',
  'off_topic',
  'provider_safety_block',
  'moderation_unavailable',
] as const
export type AiModerationCategory = (typeof AI_MODERATION_CATEGORIES)[number]

export const AI_MODERATION_MESSAGES: Record<AiModerationCategory, string> = {
  sexual_minors: 'El contenido no está permitido.',
  sexual_explicit: 'El contenido sexual explícito no está permitido en los materiales inmobiliarios.',
  non_consensual_intimate: 'El contenido no está permitido.',
  violence: 'El contenido violento no está permitido en los materiales inmobiliarios.',
  hate: 'El anuncio contiene expresiones de odio o discriminatorias.',
  harassment: 'El anuncio contiene expresiones de acoso.',
  dangerous_illegal: 'El contenido promueve actividades ilegales o peligrosas.',
  impersonation: 'El contenido podría suplantar a una persona real.',
  housing_discrimination: 'El anuncio excluye a compradores o inquilinos por una característica protegida (origen, religión, sexo, orientación, discapacidad, edad, familia…). Corrige el texto y vuelve a intentarlo.',
  real_estate_fraud: 'El anuncio contiene afirmaciones que podrían ser engañosas (garantías, rentabilidades, licencias o certificados no acreditados).',
  deceptive_alteration: 'El resultado altera el inmueble de forma engañosa.',
  invented_property_data: 'El resultado muestra datos o características que no son del inmueble.',
  prompt_injection: 'El título o la descripción contienen instrucciones dirigidas al sistema de IA. Elimínalas y vuelve a intentarlo.',
  text_in_generated_media: 'El resultado contenía texto o cifras generados por la IA; los datos del anuncio los pone EstateForge.',
  off_topic: 'El contenido no corresponde a un anuncio inmobiliario.',
  provider_safety_block: 'El proveedor ha bloqueado la solicitud por sus filtros de seguridad.',
  moderation_unavailable: 'No se ha podido completar la comprobación de seguridad; el resultado no se acepta.',
}

/** Cartel IA: identificador de «plantilla» que nunca forma parte del sorteo de «Aleatoria». */
export const AI_POSTER_TEMPLATE_ID = 'ai'
/** Fotografías de referencia (de estilo) que se envían como máximo para el fondo del cartel. */
export const AI_POSTER_MAX_REFERENCE_PHOTOS = 3
/** Duraciones admitidas del clip de vídeo IA, en segundos (el modelo admite 3-15 s). */
export const AI_VIDEO_DURATIONS = [4, 6, 8] as const
export type AiVideoDuration = (typeof AI_VIDEO_DURATIONS)[number]
export const AI_VIDEO_DEFAULT_DURATION: AiVideoDuration = 6
/** Tamaño máximo del resultado del proveedor que la API acepta descargar y guardar. */
export const AI_RESULT_MAX_BYTES = { poster: 12 * 1024 * 1024, video: 24 * 1024 * 1024 } as const
/** Caducidad de un resultado listo para revisión: después se limpia. */
export const AI_READY_TTL_MS = 24 * 60 * 60 * 1000
/** Tiempo máximo de un trabajo en el proveedor antes de darlo por caducado. */
export const AI_JOB_TIMEOUT_MS = 30 * 60 * 1000

/** Rótulos visibles que identifican el material generado con IA. */
export const AI_POSTER_LABEL = 'Diseño asistido por IA'
export const AI_VIDEO_LABEL = 'Vídeo generado con IA · no es una representación fotográfica certificada'

/** Pista de la API key que se guarda para mostrarla (nunca reversible: solo los 4 últimos caracteres). */
export function apiKeyHint(apiKey: string): string {
  const clean = apiKey.trim()
  return clean.length >= 12 ? clean.slice(-4) : ''
}

export function maskedKey(hint: string | null | undefined): string {
  return hint ? `••••••••${hint}` : '••••••••'
}

export function isAiJobActive(status: string): boolean {
  return (AI_ACTIVE_JOB_STATUSES as readonly string[]).includes(status)
}

/**
 * Coste de la comprobación de una conexión (DA-87). free: la documentación oficial dice expresamente que
 * no cobra. unknown: es una lectura que no genera contenido, pero la documentación no dice su coste; solo
 * se hace si el usuario lo confirma. unsupported: el proveedor no ofrece ninguna comprobación sin generar.
 */
export const AI_VERIFICATION_COSTS = ['free', 'unknown', 'unsupported'] as const
export type AiVerificationCost = (typeof AI_VERIFICATION_COSTS)[number]

/**
 * Estado de integración de cada proveedor y modelo (DA-88), distinto de su estado documental (estable,
 * preliminar…). Cada nivel es independiente: que un adaptador supere sus pruebas de contrato no dice nada
 * de cómo responde el servicio real.
 */
export const AI_INTEGRATION_LEVELS = ['documented', 'adapter', 'contract', 'simulator', 'real'] as const
export type AiIntegrationLevel = (typeof AI_INTEGRATION_LEVELS)[number]
export const AI_INTEGRATION_LEVEL_LABELS: Record<AiIntegrationLevel, string> = {
  documented: 'Documentado',
  adapter: 'Adaptador implementado',
  contract: 'Pruebas de contrato superadas',
  simulator: 'Flujo validado con el simulador',
  real: 'Validado con el servicio real',
}

/**
 * Prueba real controlada (DA-89): una sola operación con datos sintéticos, iniciada y confirmada por el
 * usuario con su propia conexión. No toca ningún inmueble ni anuncio y su resultado se valida y se descarta.
 */
export const AI_TRIAL_KINDS = ['text', 'poster', 'video'] as const
export type AiTrialKind = (typeof AI_TRIAL_KINDS)[number]
export const AI_TRIAL_STATUSES = ['pending', 'submitted', 'processing', 'validating', 'passed', 'failed', 'blocked', 'uncertain', 'cancelled', 'expired'] as const
export type AiTrialStatus = (typeof AI_TRIAL_STATUSES)[number]
export const AI_ACTIVE_TRIAL_STATUSES = ['pending', 'submitted', 'processing', 'validating'] as const satisfies readonly AiTrialStatus[]
export const AI_TRIAL_STATUS_LABELS: Record<AiTrialStatus, string> = {
  pending: 'Preparando',
  submitted: 'Enviada al proveedor',
  processing: 'En curso en el proveedor',
  validating: 'Validando el resultado',
  passed: 'Superada',
  failed: 'Fallida',
  blocked: 'Bloqueada por la moderación',
  uncertain: 'Estado incierto: no se ha repetido',
  cancelled: 'Cancelada',
  expired: 'Caducada',
}
/** Texto de la confirmación cuando no hay un precio publicado que permita estimar el coste. */
export const AI_COST_NOT_VERIFIABLE = 'Coste no verificable'
