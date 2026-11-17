import type { AiModerationCategory } from '@estateforge/shared'

// Errores controlados de la generación con IA (DA-67 a DA-75). El mensaje es para el usuario y nunca
// contiene la respuesta del proveedor, sus cabeceras ni ninguna parte de la API key.

export const AI_ERROR_STATUS = {
  AI_NOT_CONFIGURED: 409,
  AI_KEY_UNREADABLE: 409,
  AI_PROVIDER_UNKNOWN: 400,
  AI_MODEL_NOT_ALLOWED: 400,
  AI_CAPABILITY_MISSING: 400,
  AI_INVALID_REQUEST: 400,
  AI_CONSENT_REQUIRED: 400,
  AI_INVALID_KEY: 422,
  AI_PERMISSION_DENIED: 422,
  AI_PROVIDER_QUOTA: 429,
  AI_PROVIDER_UNAVAILABLE: 502,
  AI_PROVIDER_UNCERTAIN: 502,
  AI_PROVIDER_FAILED: 502,
  AI_INVALID_OUTPUT: 502,
  AI_RATE_LIMITED: 429,
  AI_CONCURRENCY_LIMIT: 429,
  AI_DAILY_LIMIT: 429,
  AI_MONTHLY_LIMIT: 429,
  AI_JOB_NOT_FOUND: 404,
  AI_JOB_NOT_READY: 409,
  AI_JOB_CLOSED: 409,
  AI_SSRF_BLOCKED: 502,
  MODERATION_UNAVAILABLE: 502,
  AI_MODERATION_REQUIRED: 409,
  AI_CONNECTION_AMBIGUOUS: 409,
  AI_CONNECTION_LIMIT: 409,
  AI_CONNECTION_DUPLICATE: 409,
  AI_VERIFY_COST_UNCONFIRMED: 409,
  AI_TRIAL_CONFIRMATION: 409,
  AI_TRIAL_NOT_FOUND: 404,
  AI_TRIAL_CLOSED: 409,
} as const

export type AiErrorCode = keyof typeof AI_ERROR_STATUS

export class AiMediaError extends Error {
  readonly status: number
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly category: AiModerationCategory | null = null,
  ) {
    super(message)
    this.name = 'AiMediaError'
    this.status = AI_ERROR_STATUS[code]
  }
}

export function isAiMediaError(error: unknown): error is AiMediaError {
  return error instanceof AiMediaError
}

/** Mensajes para el usuario de cada código del proveedor (sin detalles internos). */
export const PROVIDER_MESSAGES: Record<'AI_INVALID_KEY' | 'AI_PERMISSION_DENIED' | 'AI_PROVIDER_QUOTA' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_PROVIDER_UNCERTAIN' | 'AI_PROVIDER_FAILED' | 'AI_INVALID_OUTPUT', string> = {
  AI_INVALID_KEY: 'El proveedor ha rechazado la API key. Revísala o sustitúyela en Ajustes.',
  AI_PERMISSION_DENIED: 'El proveedor reconoce la API key, pero tu cuenta no tiene permiso para esta operación (proyecto, plan, organización o región). Revisa los permisos en tu cuenta del proveedor.',
  AI_PROVIDER_QUOTA: 'Tu cuenta del proveedor no tiene cuota disponible ahora mismo. Revisa tu plan o vuelve a intentarlo más tarde.',
  AI_PROVIDER_UNAVAILABLE: 'El proveedor no está disponible en este momento. Vuelve a intentarlo más tarde.',
  AI_PROVIDER_UNCERTAIN: 'No se ha podido confirmar si el proveedor recibió la solicitud. No se ha repetido para no duplicar cargos; revisa tu cuenta del proveedor antes de volver a intentarlo.',
  AI_PROVIDER_FAILED: 'El proveedor no ha podido completar la generación.',
  AI_INVALID_OUTPUT: 'El proveedor ha devuelto un resultado no válido. No se ha guardado nada.',
}
