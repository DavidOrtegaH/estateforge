import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  AIProviderError,
  classifyAIProviderError,
} from './ai-provider.error.js'

describe('AI provider errors', () => {
  it(
    'clasifica un error 429 como cuota agotada',
    () => {
      const error =
        classifyAIProviderError(
          'OpenAI',
          {
            status: 429,
            message:
              'Too many requests',
          },
        )

      expect(error).toBeInstanceOf(
        AIProviderError,
      )

      expect(error.code).toBe(
        'AI_QUOTA_EXCEEDED',
      )
    },
  )

  it(
    'clasifica una API key inválida',
    () => {
      const error =
        classifyAIProviderError(
          'OpenAI',
          {
            status: 401,
            message:
              'Incorrect API key provided',
          },
        )

      expect(error.code).toBe(
        'AI_INVALID_API_KEY',
      )
    },
  )

  it(
    'clasifica insufficient_quota como cuota agotada',
    () => {
      const error =
        classifyAIProviderError(
          'OpenAI',
          {
            code:
              'insufficient_quota',
            message:
              'You exceeded your current quota',
          },
        )

      expect(error.code).toBe(
        'AI_QUOTA_EXCEEDED',
      )
    },
  )

  it(
    'clasifica resource_exhausted de Gemini',
    () => {
      const error =
        classifyAIProviderError(
          'Gemini',
          {
            status: 429,
            code:
              'RESOURCE_EXHAUSTED',
            message:
              'Resource exhausted',
          },
        )

      expect(error.code).toBe(
        'AI_QUOTA_EXCEEDED',
      )
    },
  )

  it(
    'clasifica errores de timeout',
    () => {
      const error =
        classifyAIProviderError(
          'OpenAI',
          new Error(
            'Request timed out',
          ),
        )

      expect(error.code).toBe(
        'AI_TIMEOUT',
      )
    },
  )

  it(
    'no expone el mensaje original del proveedor',
    () => {
      const error =
        classifyAIProviderError(
          'OpenAI',
          {
            status: 500,
            message:
              'secret-api-key-value leaked internally',
          },
        )

      expect(error.code).toBe(
        'AI_PROVIDER_ERROR',
      )

      expect(
        error.message,
      ).not.toContain(
        'secret-api-key-value',
      )
    },
  )
})