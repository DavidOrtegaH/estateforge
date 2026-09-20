import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type {
  FastifyInstance,
} from 'fastify'

vi.mock(
  '../services/generation.service.js',
  () => ({
    generateListing: vi.fn(
      async (input: unknown) => ({
        mocked: true,
        input,
      }),
    ),

    generateListingForExistingProperty:
      vi.fn(
        async (input: unknown) => ({
          mocked: true,
          input,
        }),
      ),
  }),
)

describe('Security Configuration', () => {
  // ==========================================================
  // SECURITY HEADERS
  // ==========================================================

  describe('Security headers', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      const { buildApp } =
        await import('../app.js')

      app = await buildApp()
      await app.ready()
    })

    afterAll(async () => {
      await app.close()
    })

    it(
      'debe devolver cabeceras de seguridad en /health',
      async () => {
        const response =
          await app.inject({
            method: 'GET',
            url: '/health',
          })

        expect(
          response.statusCode,
        ).toBe(200)

        expect(
          response.headers[
            'x-content-type-options'
          ],
        ).toBe('nosniff')

        expect(
          response.headers[
            'x-frame-options'
          ],
        ).toBe('DENY')

        expect(
          response.headers[
            'referrer-policy'
          ],
        ).toBe(
          'strict-origin-when-cross-origin',
        )

        expect(
          response.headers[
            'permissions-policy'
          ],
        ).toBe(
          'camera=(), microphone=(), geolocation=()',
        )
      },
    )
  })

  // ==========================================================
  // CORS
  // ==========================================================

  describe('CORS policy', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      vi.stubEnv(
        'CORS_ORIGIN',
        'http://frontend-permitido.com',
      )

      const { buildApp } =
        await import('../app.js')

      app = await buildApp()
      await app.ready()
    })

    afterAll(async () => {
      await app.close()
      vi.unstubAllEnvs()
    })

    it(
      'debe permitir peticiones desde el CORS_ORIGIN configurado',
      async () => {
        const response =
          await app.inject({
            method: 'OPTIONS',
            url: '/health',
            headers: {
              origin:
                'http://frontend-permitido.com',
              'access-control-request-method':
                'GET',
            },
          })

        expect(
          response.statusCode,
        ).toBe(204)

        expect(
          response.headers[
            'access-control-allow-origin'
          ],
        ).toBe(
          'http://frontend-permitido.com',
        )
      },
    )

    it(
      'no debe devolver Access-Control-Allow-Origin para orígenes no autorizados',
      async () => {
        const response =
          await app.inject({
            method: 'OPTIONS',
            url: '/health',
            headers: {
              origin:
                'http://sitio-malicioso.com',
              'access-control-request-method':
                'GET',
            },
          })

        expect(
          response.headers[
            'access-control-allow-origin'
          ],
        ).toBeUndefined()
      },
    )
  })

  // ==========================================================
  // RATE LIMITING
  // ==========================================================

  describe('Rate limiting', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      const { buildApp } =
        await import('../app.js')

      app = await buildApp()
      await app.ready()
    })

    afterAll(async () => {
      await app.close()
    })

    it(
      'debe limitar POST /api/generations después de 70 peticiones',
      async () => {
        const validPayload = {
          property: {
            title: 'Piso de prueba',
            operation: 'sale',
            type: 'apartment',
            price: 250000,
            address: 'Calle de Prueba 1',
            city: 'Madrid',
            neighborhood: 'Centro',
            area: 80,
            bedrooms: 2,
            bathrooms: 1,
            floor: 3,
            condition: 'good',
            elevator: true,
            terrace: false,
            balcony: true,
            garage: false,
            storageRoom: false,
            pool: false,
            garden: false,
            airConditioning: false,
            heating: true,
            additionalInformation:
              'Inmueble de prueba para test.',
          },
          provider: 'mock',
          tone: 'professional',
          language: 'español',
        }

        const responses = []

        for (let i = 0; i < 71; i += 1) {
          const response =
            await app.inject({
              method: 'POST',
              url: '/api/generations',
              payload: validPayload,
            })

          responses.push(response)
        }

        const firstSeventy =
          responses.slice(0, 70)

        const rateLimitedResponse =
          responses[70]

        expect(
          firstSeventy.every(
            (response) =>
              response.statusCode !== 429,
          ),
        ).toBe(true)

        expect(
          rateLimitedResponse.statusCode,
        ).toBe(429)

        expect(
          rateLimitedResponse.headers[
            'retry-after'
          ],
        ).toBeDefined()
      },
    )

    it(
      'debe limitar POST /api/generations/from-property después de 70 peticiones',
      async () => {
        const validPayload = {
          propertyId:
            'cmj7b5q8r0000v6y7g5q4m3n2',
          provider: 'mock',
          tone: 'professional',
          language: 'español',
        }

        const responses = []

        for (let i = 0; i < 71; i += 1) {
          const response =
            await app.inject({
              method: 'POST',
              url: '/api/generations/from-property',
              payload: validPayload,
            })

          responses.push(response)
        }

        const firstSeventy =
          responses.slice(0, 70)

        const rateLimitedResponse =
          responses[70]

        expect(
          firstSeventy.every(
            (response) =>
              response.statusCode !== 429,
          ),
        ).toBe(true)

        expect(
          rateLimitedResponse.statusCode,
        ).toBe(429)

        expect(
          rateLimitedResponse.headers[
            'retry-after'
          ],
        ).toBeDefined()
      },
    )

    it(
      'no debe aplicar el rate limit globalmente a /health',
      async () => {
        const responses =
          await Promise.all(
            Array.from(
              { length: 10 },
              () =>
                app.inject({
                  method: 'GET',
                  url: '/health',
                }),
            ),
          )

        expect(
          responses.every(
            (response) =>
              response.statusCode === 200,
          ),
        ).toBe(true)
      },
    )
  })

  // ==========================================================
  // ERROR HANDLING
  // ==========================================================

  describe('Error handling', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      const { buildApp } =
        await import('../app.js')

      app = await buildApp()

      // Ruta exclusiva para probar
      // el error handler REAL de la aplicación.
      app.get(
        '/test-internal-error',
        async () => {
          throw new Error(
            'DATABASE_URL secret internal failure',
          )
        },
      )

      app.get(
        '/test-client-error',
        async () => {
          const error =
            new Error(
              'Petición inválida',
            )

          Object.assign(error, {
            statusCode: 400,
          })

          throw error
        },
      )

      await app.ready()
    })

    afterAll(async () => {
      await app.close()
    })

    it(
      'no debe exponer detalles de errores internos',
      async () => {
        const response =
          await app.inject({
            method: 'GET',
            url: '/test-internal-error',
          })

        expect(
          response.statusCode,
        ).toBe(500)

        expect(
          response.json(),
        ).toEqual({
          message:
            'Error interno del servidor',
        })

        expect(
          response.body,
        ).not.toContain(
          'DATABASE_URL',
        )

        expect(
          response.body,
        ).not.toContain(
          'secret internal failure',
        )
      },
    )

    it(
      'debe conservar mensajes de errores de cliente conocidos',
      async () => {
        const response =
          await app.inject({
            method: 'GET',
            url: '/test-client-error',
          })

        expect(
          response.statusCode,
        ).toBe(400)

        expect(
          response.json(),
        ).toEqual({
          message:
            'Petición inválida',
        })
      },
    )
  })
})