import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GeminiProvider } from './gemini.provider.js'
import { OpenAIProvider } from './openai.provider.js'

// Mock del SDK de Google Gemini
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(function () {
      return {
        models: {
          generateContent: vi.fn().mockImplementation((options) => {
            return new Promise((_, reject) => {
              const signal = options?.config?.abortSignal
              if (signal) {
                signal.addEventListener('abort', () => {
                  const error = new Error('The operation was aborted')
                  error.name = 'AbortError'
                  reject(error)
                })
              }
            })
          }),
        },
      }
    }),
  }
})

// Mock del SDK de OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        responses: {
          create: vi.fn().mockImplementation(() => {
            const error = new Error('Request timed out.')
            error.name = 'APIConnectionTimeoutError'
            return Promise.reject(error)
          }),
        },
      }
    }),
  }
})

const dummyPrompt = `
DATOS DEL INMUEBLE:
{
  "title": "Piso céntrico",
  "operation": "sale",
  "type": "apartment",
  "price": 150000,
  "address": "Calle Mayor 1",
  "city": "Madrid",
  "neighborhood": "Centro",
  "area": 80,
  "bedrooms": 2,
  "bathrooms": 1,
  "condition": "good",
  "elevator": true,
  "terrace": false,
  "balcony": false,
  "garage": false,
  "storageRoom": false,
  "pool": false,
  "garden": false,
  "airConditioning": false,
  "heating": true,
  "additionalInformation": ""
}
`

describe('AI Providers Timeout handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('GeminiProvider lanza un error de timeout al superar los 40 segundos', async () => {
    const provider = new GeminiProvider('clave-ficticia-del-usuario', 'gemini-3.6-flash')

    const generatePromise = provider.generate(dummyPrompt)

    // Adjuntamos el handler de rechazo antes de hacer avanzar los timers para evitar Unhandled Rejection
    const assertion = expect(generatePromise).rejects.toThrow(
      'Error al generar el anuncio con Gemini: La solicitud a Gemini ha superado el tiempo límite de 40 segundos.',
    )

    await vi.advanceTimersByTimeAsync(40_000)

    await assertion
  })

  it('OpenAIProvider captura el timeout de la API y lanza un error descriptivo', async () => {
    const provider = new OpenAIProvider('clave-ficticia-del-usuario', 'gpt-6.1-terra')

    await expect(provider.generate(dummyPrompt)).rejects.toThrow(
      'Error al generar el anuncio con OpenAI: La solicitud ha superado el tiempo límite de 40 segundos.',
    )
  })
})