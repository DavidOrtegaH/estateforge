const API_URL =
  import.meta.env.VITE_API_URL ??
  'http://localhost:3000'

export interface AuthUser {
  id: string
  email: string
}

async function extractErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as {
      message?: unknown
    }

    if (
      typeof body.message === 'string' &&
      body.message
    ) {
      return body.message
    }
  } catch {
    // Ignorar si la respuesta no es JSON.
  }

  return fallback
}

export async function register(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, turnstileToken }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(response, `Register failed: ${response.status}`),
    )
  }

  const data = (await response.json()) as { user: AuthUser }
  return data.user
}

export async function login(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, turnstileToken }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(response, `Login failed: ${response.status}`),
    )
  }

  const data = (await response.json()) as { user: AuthUser }
  return data.user
}

export async function requestPasswordReset(
  email: string,
  turnstileToken?: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, turnstileToken }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Password recovery failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

export async function resetPassword(
  token: string,
  password: string,
  turnstileToken?: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password, turnstileToken }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Password reset failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ currentPassword, newPassword }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Password change failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

export async function deleteAccount(
  currentPassword: string,
): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ currentPassword }),
  })

  if (!response.ok) {
    throw new Error(
      await extractErrorMessage(
        response,
        `Account deletion failed: ${response.status}`,
      ),
    )
  }

  const data = (await response.json()) as { message: string }
  return data.message
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Logout failed: ${response.status}`)
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    credentials: 'include',
  })

  if (response.status === 401) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to load session: ${response.status}`)
  }

  const data = (await response.json()) as { user: AuthUser }
  return data.user
}
