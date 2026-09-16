export type AIProviderErrorCode =
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_INVALID_API_KEY'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'

export class AIProviderError extends Error {
  constructor(
    public readonly code: AIProviderErrorCode,
    message: string,
    public readonly provider?: 'OpenAI' | 'Gemini',
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
  provider: 'OpenAI' | 'Gemini',
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
  provider: 'OpenAI' | 'Gemini',
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

  const isQuotaExceeded =
    status === 429 ||
    code === 'insufficient_quota' ||
    code === 'resource_exhausted' ||
    message.includes('insufficient quota') ||
    message.includes('quota exceeded') ||
    message.includes('quota exhausted') ||
    message.includes('resource exhausted') ||
    message.includes('rate limit')

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