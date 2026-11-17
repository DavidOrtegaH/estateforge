export type AIProviderErrorCode =
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_INVALID_API_KEY'
  // Límite de peticiones por minuto de la cuenta del usuario: es transitorio, a diferencia de la cuota.
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  // BYOK (DA-77): el usuario no ha configurado su clave, o no se puede descifrar.
  | 'AI_KEY_REQUIRED'
  | 'AI_KEY_UNREADABLE'
  | 'AI_MODEL_NOT_ALLOWED'
  // La clave se reconoce, pero la cuenta, el proyecto o la región no tienen permiso (DA-87).
  | 'AI_PERMISSION_DENIED'

export class AIProviderError extends Error {
  constructor(
    public readonly code: AIProviderErrorCode,
    message: string,
    public readonly provider?: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'AIProviderError'
  }
}

export function isAIProviderError(
  error: unknown,
): error is AIProviderError {
  return error instanceof AIProviderError
}

function getErrorValue(
  error: unknown,
  key: string,
): unknown {
  if (
    typeof error !== 'object' ||
    error === null
  ) {
    return undefined
  }

  return (
    error as Record<string, unknown>
  )[key]
}

function getErrorStatus(
  error: unknown,
): number | undefined {
  const status =
    getErrorValue(error, 'status')

  if (typeof status === 'number') {
    return status
  }

  const statusCode =
    getErrorValue(
      error,
      'statusCode',
    )

  if (typeof statusCode === 'number') {
    return statusCode
  }

  return undefined
}

function getErrorText(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message.toLowerCase()
  }

  const message =
    getErrorValue(
      error,
      'message',
    )

  return typeof message === 'string'
    ? message.toLowerCase()
    : ''
}

function getErrorCode(
  error: unknown,
): string {
  const code =
    getErrorValue(error, 'code')

  return typeof code === 'string'
    ? code.toLowerCase()
    : ''
}

function providerErrorMessage(
  provider: string,
  status: number | undefined,
  code: string,
): string {
  const statusDetail =
    status !== undefined
      ? ` (HTTP ${status}${code ? `, código ${code}` : ''})`
      : code
        ? ` (código ${code})`
        : ''

  return `El proveedor ${provider} no está disponible en este momento${statusDetail}.`
}

export function classifyAIProviderError(
  provider: string,
  error: unknown,
): AIProviderError {
  if (isAIProviderError(error)) {
    return error
  }

  const status =
    getErrorStatus(error)

  const message =
    getErrorText(error)

  const code =
    getErrorCode(error)

  const isTimeout =
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('deadline exceeded') ||
    code === 'deadline_exceeded'

  if (isTimeout) {
    const detailMessage =
      provider === 'OpenAI'
        ? 'La solicitud ha superado el tiempo límite de 40 segundos.'
        : `La solicitud a ${provider} ha superado el tiempo límite de 40 segundos.`

    return new AIProviderError(
      'AI_TIMEOUT',
      `Error al generar el anuncio con ${provider}: ${detailMessage}`,
      provider,
      status,
    )
  }

  const isInvalidApiKey =
    status === 401 ||
    code === 'invalid_api_key' ||
    code === 'authentication_error' ||
    code === 'unauthenticated' ||
    message.includes('invalid api key') ||
    message.includes('incorrect api key') ||
    message.includes('api key not valid') ||
    message.includes('invalid_api_key') ||
    message.includes('authentication')

  if (isInvalidApiKey) {
    return new AIProviderError(
      'AI_INVALID_API_KEY',
      `La API key proporcionada para ${provider} no es válida.`,
      provider,
      status,
    )
  }

  // Modelo desconocido, retirado o sin acceso desde la cuenta del usuario: se informa y no se
  // sustituye por otro modelo (sin fallback).
  const isModelUnavailable =
    status === 404 ||
    code === 'model_not_found' ||
    message.includes('model_not_found') ||
    (message.includes('model') &&
      (message.includes('does not exist') ||
        message.includes('not found') ||
        message.includes('deprecated')))

  if (isModelUnavailable) {
    return new AIProviderError(
      'AI_MODEL_NOT_ALLOWED',
      `${provider} no reconoce el modelo elegido o tu cuenta no tiene acceso a él (puede haberse retirado). Elige otro modelo en Ajustes.`,
      provider,
      status,
    )
  }

  // Permiso denegado (403, permission_error, PERMISSION_DENIED): la clave es válida; no se marca como inválida.
  const isPermissionDenied =
    status === 403 ||
    code === 'permission_error' ||
    code === 'permission_denied'

  if (isPermissionDenied) {
    return new AIProviderError(
      'AI_PERMISSION_DENIED',
      `${provider} reconoce tu API key, pero tu cuenta no tiene permiso para esta operación (proyecto, plan, organización o región). Revisa los permisos en tu cuenta del proveedor.`,
      provider,
      status,
    )
  }

  const isHardQuota =
    code === 'insufficient_quota' ||
    code === 'resource_exhausted' ||
    message.includes('insufficient quota') ||
    message.includes('insufficient_quota') ||
    message.includes('quota exceeded') ||
    message.includes('quota exhausted') ||
    message.includes('exceeded your current quota') ||
    message.includes('resource exhausted')

  const isRateLimited =
    !isHardQuota &&
    (code === 'rate_limit_exceeded' ||
      code === 'rate_limit_error' ||
      message.includes('rate limit'))

  if (isRateLimited) {
    return new AIProviderError(
      'AI_RATE_LIMITED',
      `Has superado el límite de peticiones de tu cuenta de ${provider}. Espera un momento y vuelve a intentarlo.`,
      provider,
      status,
    )
  }

  const isQuotaExceeded =
    isHardQuota ||
    status === 429

  if (isQuotaExceeded) {
    return new AIProviderError(
      'AI_QUOTA_EXCEEDED',
      `La cuota disponible de ${provider} se ha agotado.`,
      provider,
      status,
    )
  }

  return new AIProviderError(
    'AI_PROVIDER_ERROR',
    providerErrorMessage(provider, status, code),
    provider,
    status,
  )
}