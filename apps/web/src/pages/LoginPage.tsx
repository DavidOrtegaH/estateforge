import { useEffect, useState } from 'react'

import {
  Link,
  Navigate,
  useLocation,
} from 'react-router'

import {
  TurnstileField,
  isTurnstileConfigured,
} from '@/components/security/TurnstileField'
import { useAuth } from '@/hooks/useAuth'
import FooterLoginRegister from '@/components/layout/FooterLoginRegister'

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
  const [turnstileToken, setTurnstileToken] =
    useState<string>()

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

    if (
      isTurnstileConfigured() &&
      !turnstileToken
    ) {
      setError(
        'Completa la verificación de seguridad e inténtalo de nuevo.',
      )
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await login(
        email.trim(),
        password,
        turnstileToken,
      )
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-64 w-64 translate-x-1/3 translate-y-1/3 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">

        <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">
              Iniciar sesión
            </h1>

            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Accede a tu cuenta para gestionar tus
              inmuebles y anuncios.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
            className="space-y-5"
          >
            <div>
              <label
                htmlFor="login-email"
                className="text-sm font-medium"
              >
                Correo electrónico
              </label>

              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                disabled={submitting}
                required
                autoComplete="email"
                inputMode="email"
                aria-invalid={Boolean(error)}
                className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="tu@email.com"
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
                  className="shrink-0 text-xs font-medium text-primary transition hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  ¿Has olvidado tu contraseña?
                </Link>
              </div>

              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                disabled={submitting}
                required
                autoComplete="current-password"
                className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Introduce tu contraseña"
              />
            </div>

            <TurnstileField
              onTokenChange={setTurnstileToken}
            />

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? 'Iniciando sesión...'
                : 'Iniciar sesión'}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />

            <span className="text-xs text-muted-foreground">
              o
            </span>

            <div className="h-px flex-1 bg-border" />
          </div>

          <p className="text-center text-sm text-muted-foreground">
            ¿No tienes cuenta?{' '}
            <Link
              to="/registro"
              className="font-semibold text-primary transition hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Crear una cuenta
            </Link>
          </p>
        </section>
        <FooterLoginRegister />
      </div>
    </main>
  )
}

export default LoginPage