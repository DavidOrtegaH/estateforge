import { useEffect, useState } from 'react'

import {
  Link,
  Navigate,
  useLocation,
} from 'react-router'

import { useAuth } from '@/hooks/useAuth'
import {
  TurnstileField,
  isTurnstileConfigured,
} from '@/components/security/TurnstileField'

interface LocationState {
  from?: {
    pathname: string
  }
}

function LoginPage() {
  const location = useLocation()
  const { login, user } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>()

  useEffect(() => {
    document.title = 'Iniciar sesión - EstateForge'
  }, [])

  if (user) {
    const state = location.state as
      | LocationState
      | undefined

    const target = state?.from?.pathname ?? '/'

    return <Navigate to={target} replace />
  }

  async function handleSubmit() {
    if (submitting) {
      return
    }

    if (isTurnstileConfigured() && !turnstileToken) {
      setError('Completa la verificación de seguridad e inténtalo de nuevo.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await login(email.trim(), password, turnstileToken)
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'No se ha podido iniciar sesión.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">
            EstateForge
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            Iniciar sesión
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Accede a tu cuenta de EstateForge.
          </p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="login-email"
              className="text-sm font-medium"
            >
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              required
              autoComplete="email"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="login-password"
                className="text-sm font-medium"
              >
                Contraseña
              </label>
              <Link
                to="/recuperar-contrasena"
                className="text-xs font-medium text-primary hover:underline"
              >
                ¿Has olvidado tu contraseña?
              </Link>
            </div>

            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
              autoComplete="current-password"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <TurnstileField onTokenChange={setTurnstileToken} />

          {error && (
            <p className="text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? 'Iniciando...'
              : 'Iniciar sesión'}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          ¿No tienes cuenta?{' '}
          <Link
            to="/registro"
            className="font-medium text-primary hover:underline"
          >
            Crear una cuenta
          </Link>
        </p>
      </div>
    </div>
  )
}

export default LoginPage
