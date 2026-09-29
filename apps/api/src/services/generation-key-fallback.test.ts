import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const {
  createAIProviderMock,
  getUserAIKeyMock,
} = vi.hoisted(() => ({
  createAIProviderMock: vi.fn(),
  getUserAIKeyMock: vi.fn(),
}))

vi.mock('../ai/ai-provider.factory.js', () => ({
  createAIProvider: createAIProviderMock,
}))

vi.mock('./user-ai-key.service.js', () => ({
  getUserAIKey: getUserAIKeyMock,
}))

import {
  generateWithUserKeyFallback,
} from './generation.service.js'

import {
  AIProviderError,
} from '../ai/ai-provider.error.js'

function providerError(
  code: 'AI_QUOTA_EXCEEDED',
) {
  return new AIProviderError(
    code,
    'test',
    'Gemini',
    429,
  )
}

describe(
  'generation API key fallback',
  () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it(
      'no consulta keys guardadas para Mock',
      async () => {
        const generate =
          vi.fn().mockResolvedValue({
            title: 'Mock',
          })

        createAIProviderMock.mockReturnValue({
          generate,
        })

        await expect(
          generateWithUserKeyFallback(
            'mock',
            'prompt',
            undefined,
            'user-1',
          ),
        ).resolves.toEqual({
          title: 'Mock',
        })

        expect(
          getUserAIKeyMock,
        ).not.toHaveBeenCalled()

        expect(
          createAIProviderMock,
        ).toHaveBeenCalledWith(
          'mock',
        )
      },
    )

    it(
      'usa la key guardada cuando se agota la key del servidor',
      async () => {
        const firstGenerate =
          vi.fn().mockRejectedValue(
            providerError(
              'AI_QUOTA_EXCEEDED',
            ),
          )

        const secondGenerate =
          vi.fn().mockResolvedValue({
            title: 'Con key propia',
          })

        createAIProviderMock
          .mockReturnValueOnce({
            generate: firstGenerate,
          })
          .mockReturnValueOnce({
            generate: secondGenerate,
          })

        getUserAIKeyMock.mockResolvedValue(
          'stored-secret-key',
        )

        await expect(
          generateWithUserKeyFallback(
            'gemini',
            'prompt',
            undefined,
            'user-1',
          ),
        ).resolves.toEqual({
          title: 'Con key propia',
        })

        expect(
          getUserAIKeyMock,
        ).toHaveBeenCalledWith(
          'user-1',
          'gemini',
        )

        expect(
          createAIProviderMock,
        ).toHaveBeenNthCalledWith(
          2,
          'gemini',
          'stored-secret-key',
        )
      },
    )

    it(
      'mantiene la key introducida manualmente como prioridad',
      async () => {
        const generate =
          vi.fn().mockResolvedValue({
            title: 'Manual',
          })

        createAIProviderMock.mockReturnValue({
          generate,
        })

        await expect(
          generateWithUserKeyFallback(
            'openai',
            'prompt',
            'manual-key',
            'user-1',
          ),
        ).resolves.toEqual({
          title: 'Manual',
        })

        expect(
          createAIProviderMock,
        ).toHaveBeenCalledWith(
          'openai',
          'manual-key',
        )

        expect(
          getUserAIKeyMock,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'mantiene el error si no hay key propia guardada',
      async () => {
        const error =
          providerError(
            'AI_QUOTA_EXCEEDED',
          )

        createAIProviderMock.mockReturnValue({
          generate:
            vi.fn().mockRejectedValue(
              error,
            ),
        })

        getUserAIKeyMock.mockResolvedValue(
          null,
        )

        await expect(
          generateWithUserKeyFallback(
            'gemini',
            'prompt',
            undefined,
            'user-1',
          ),
        ).rejects.toBe(error)
      },
    )

    it(
      'mantiene el error de cuota si la key guardada no puede recuperarse',
      async () => {
        const error =
          providerError(
            'AI_QUOTA_EXCEEDED',
          )

        createAIProviderMock.mockReturnValue({
          generate:
            vi.fn().mockRejectedValue(
              error,
            ),
        })

        getUserAIKeyMock.mockRejectedValue(
          new Error(
            'ESTATEFORGE_API_KEY_ENCRYPTION_KEY no está configurada.',
          ),
        )

        await expect(
          generateWithUserKeyFallback(
            'gemini',
            'prompt',
            undefined,
            'user-1',
          ),
        ).rejects.toBe(error)
      },
    )

    it(
      'mantiene aisladas las keys de dos usuarios que generan simultáneamente',
      async () => {
        const user1ServerGenerate =
          vi.fn().mockRejectedValue(
            providerError(
              'AI_QUOTA_EXCEEDED',
            ),
          )

        const user2ServerGenerate =
          vi.fn().mockRejectedValue(
            providerError(
              'AI_QUOTA_EXCEEDED',
            ),
          )

        const user1StoredGenerate =
          vi.fn().mockResolvedValue({
            title: 'Anuncio usuario 1',
          })

        const user2StoredGenerate =
          vi.fn().mockResolvedValue({
            title: 'Anuncio usuario 2',
          })

        createAIProviderMock.mockImplementation(
          (
            provider: string,
            apiKey?: string,
          ) => {
            expect(provider).toBe(
              'gemini',
            )

            if (!apiKey) {
              return {
                generate: vi.fn(
                  async (
                    prompt: string,
                  ) => {
                    if (
                      prompt ===
                      'prompt-user-1'
                    ) {
                      return user1ServerGenerate(
                        prompt,
                      )
                    }

                    if (
                      prompt ===
                      'prompt-user-2'
                    ) {
                      return user2ServerGenerate(
                        prompt,
                      )
                    }

                    throw new Error(
                      `Prompt inesperado: ${prompt}`,
                    )
                  },
                ),
              }
            }

            if (
              apiKey ===
              'stored-key-user-1'
            ) {
              return {
                generate:
                  user1StoredGenerate,
              }
            }

            if (
              apiKey ===
              'stored-key-user-2'
            ) {
              return {
                generate:
                  user2StoredGenerate,
              }
            }

            throw new Error(
              `API key inesperada: ${apiKey}`,
            )
          },
        )

        getUserAIKeyMock.mockImplementation(
          async (
            userId: string,
            provider: string,
          ) => {
            expect(provider).toBe(
              'gemini',
            )

            if (
              userId ===
              'user-1'
            ) {
              await new Promise(
                (resolve) =>
                  setTimeout(
                    resolve,
                    10,
                  ),
              )

              return 'stored-key-user-1'
            }

            if (
              userId ===
              'user-2'
            ) {
              await new Promise(
                (resolve) =>
                  setTimeout(
                    resolve,
                    1,
                  ),
              )

              return 'stored-key-user-2'
            }

            throw new Error(
              `Usuario inesperado: ${userId}`,
            )
          },
        )

        const [
          user1Result,
          user2Result,
        ] = await Promise.all([
          generateWithUserKeyFallback(
            'gemini',
            'prompt-user-1',
            undefined,
            'user-1',
          ),

          generateWithUserKeyFallback(
            'gemini',
            'prompt-user-2',
            undefined,
            'user-2',
          ),
        ])

        expect(
          user1Result,
        ).toEqual({
          title:
            'Anuncio usuario 1',
        })

        expect(
          user2Result,
        ).toEqual({
          title:
            'Anuncio usuario 2',
        })

        expect(
          getUserAIKeyMock,
        ).toHaveBeenCalledWith(
          'user-1',
          'gemini',
        )

        expect(
          getUserAIKeyMock,
        ).toHaveBeenCalledWith(
          'user-2',
          'gemini',
        )

        expect(
          createAIProviderMock,
        ).toHaveBeenCalledWith(
          'gemini',
          'stored-key-user-1',
        )

        expect(
          createAIProviderMock,
        ).toHaveBeenCalledWith(
          'gemini',
          'stored-key-user-2',
        )

        expect(
          user1StoredGenerate,
        ).toHaveBeenCalledTimes(1)

        expect(
          user2StoredGenerate,
        ).toHaveBeenCalledTimes(1)

        expect(
          user1ServerGenerate,
        ).toHaveBeenCalledTimes(1)

        expect(
          user2ServerGenerate,
        ).toHaveBeenCalledTimes(1)
      },
    )
  },
)