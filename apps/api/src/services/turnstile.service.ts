const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const VALIDATION_TIMEOUT_MS = 5_000
const MAX_TOKEN_LENGTH = 2_048

interface TurnstileResponse {
  success?: boolean
  hostname?: string
  'error-codes'?: string[]
}

export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim())
}

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()

  // Local development remains unchanged until the server secret is configured.
  if (!secret) {
    return true
  }

  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return false
  }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    VALIDATION_TIMEOUT_MS,
  )

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return false
    }

    const result = (await response.json()) as TurnstileResponse

    if (!result.success) {
      return false
    }

    const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim()

    if (
      expectedHostname &&
      result.hostname !== expectedHostname
    ) {
      return false
    }

    return true
  } catch {
    // Fail closed when Turnstile is enabled but verification is unavailable.
    return false
  } finally {
    clearTimeout(timeout)
  }
}
