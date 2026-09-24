import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isTurnstileEnabled,
  verifyTurnstileToken,
} from './turnstile.service.js'

describe('Turnstile service', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('permite el flujo actual cuando Turnstile no está configurado', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')

    expect(isTurnstileEnabled()).toBe(false)
    await expect(verifyTurnstileToken(undefined)).resolves.toBe(true)
  })

  it('rechaza un token vacío cuando Turnstile está habilitado', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret')

    await expect(verifyTurnstileToken(undefined)).resolves.toBe(false)
  })

  it('acepta un token validado correctamente', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          hostname: 'localhost',
        }),
        { status: 200 },
      ),
    )

    await expect(
      verifyTurnstileToken('valid-token', '127.0.0.1'),
    ).resolves.toBe(true)
  })

  it('rechaza un token no validado', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
        { status: 200 },
      ),
    )

    await expect(verifyTurnstileToken('invalid-token')).resolves.toBe(false)
  })

  it('valida el hostname cuando se configura', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret')
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'estateforge.local')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          hostname: 'localhost',
        }),
        { status: 200 },
      ),
    )

    await expect(verifyTurnstileToken('valid-token')).resolves.toBe(false)
  })
})
