import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import Fastify from 'fastify'

import {
  authenticateRequest,
  requireAuth,
} from './auth.middleware.js'

vi.mock(
  '../services/session.service.js',
  () => ({
    getUserIdFromSession: vi.fn(),
  }),
)

import {
  getUserIdFromSession,
} from '../services/session.service.js'

const mockedGetUserIdFromSession =
  vi.mocked(
    getUserIdFromSession,
  )

afterEach(() => {
  mockedGetUserIdFromSession.mockReset()
})

describe(
  'Authentication middleware',
  () => {
    it(
      'returns null when no session cookie exists',
      async () => {
        const app = Fastify()

        app.decorateRequest(
          'userId',
          null,
        )

        app.get(
          '/test',
          async (request) => {
            const userId =
              await authenticateRequest(
                request,
              )

            return {
              userId,
            }
          },
        )

        const response =
          await app.inject({
            method: 'GET',
            url: '/test',
          })

        expect(
          response.statusCode,
        ).toBe(200)

        expect(
          response.json(),
        ).toEqual({
          userId: null,
        })

        expect(
          mockedGetUserIdFromSession,
        ).not.toHaveBeenCalled()

        await app.close()
      },
    )

    it(
      'loads the user id from a valid session',
      async () => {
        mockedGetUserIdFromSession.mockResolvedValue(
          'user-123',
        )

        const app = Fastify()

        app.decorateRequest(
          'userId',
          null,
        )

        app.get(
          '/test',
          async (request) => {
            const userId =
              await authenticateRequest(
                request,
              )

            return {
              userId,
              requestUserId:
                request.userId,
            }
          },
        )

        const response =
          await app.inject({
            method: 'GET',
            url: '/test',
            headers: {
              cookie:
                'estateforge_session=valid-token',
            },
          })

        expect(
          response.statusCode,
        ).toBe(200)

        expect(
          response.json(),
        ).toEqual({
          userId: 'user-123',
          requestUserId: 'user-123',
        })

        expect(
          mockedGetUserIdFromSession,
        ).toHaveBeenCalledWith(
          'valid-token',
        )

        await app.close()
      },
    )

    it(
      'returns null when the session is invalid',
      async () => {
        mockedGetUserIdFromSession.mockResolvedValue(
          null,
        )

        const app = Fastify()

        app.decorateRequest(
          'userId',
          null,
        )

        app.get(
          '/test',
          async (request) => {
            const userId =
              await authenticateRequest(
                request,
              )

            return {
              userId,
              requestUserId:
                request.userId,
            }
          },
        )

        const response =
          await app.inject({
            method: 'GET',
            url: '/test',
            headers: {
              cookie:
                'estateforge_session=expired-token',
            },
          })

        expect(
          response.statusCode,
        ).toBe(200)

        expect(
          response.json(),
        ).toEqual({
          userId: null,
          requestUserId: null,
        })

        expect(
          mockedGetUserIdFromSession,
        ).toHaveBeenCalledWith(
          'expired-token',
        )

        await app.close()
      },
    )

    it(
      'returns 401 when authentication is required',
      async () => {
        mockedGetUserIdFromSession.mockResolvedValue(
          null,
        )

        const app = Fastify()

        app.decorateRequest(
          'userId',
          null,
        )

        app.get(
          '/private',
          {
            preHandler:
              requireAuth,
          },
          async () => {
            return {
              success: true,
            }
          },
        )

        const response =
          await app.inject({
            method: 'GET',
            url: '/private',
          })

        expect(
          response.statusCode,
        ).toBe(401)

        expect(
          response.json(),
        ).toEqual({
          message:
            'Se requiere una sesión activa.',
        })

        await app.close()
      },
    )

    it(
      'allows an authenticated request through requireAuth',
      async () => {
        mockedGetUserIdFromSession.mockResolvedValue(
          'user-456',
        )

        const app = Fastify()

        app.decorateRequest(
          'userId',
          null,
        )

        app.get(
          '/private',
          {
            preHandler:
              requireAuth,
          },
          async (request) => {
            return {
              success: true,
              userId:
                request.userId,
            }
          },
        )

        const response =
          await app.inject({
            method: 'GET',
            url: '/private',
            headers: {
              cookie:
                'estateforge_session=valid-token',
            },
          })

        expect(
          response.statusCode,
        ).toBe(200)

        expect(
          response.json(),
        ).toEqual({
          success: true,
          userId: 'user-456',
        })

        expect(
          mockedGetUserIdFromSession,
        ).toHaveBeenCalledWith(
          'valid-token',
        )

        await app.close()
      },
    )
  },
)