
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

import { PasswordInput } from '@/components/ui/PasswordInput'
import { isEmailNotVerifiedMessage, isSecurityRecoveryRequiredMessage } from '@/services/authService'
import { ResendVerificationForm } from '@/components/auth/ResendVerificationForm'
import { sessionEndedNotice } from '@/lib/sessionAccess'
import { APP_HOME } from '@/lib/routes'
import LegalLinks from '@/components/layout/LegalLinks'

interface LocationState {
  from?: {
    pathname: string
  }
  // Motivo con el que la API cerró la sesión (lo pasa ProtectedRoute al redirigir).
  sessionEndedReason?: string
}


function getInitialDarkMode(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const storedTheme = window.localStorage.getItem(
    'estateforge-theme',
  )

  if (storedTheme === 'dark') {
    return true
  }

  if (storedTheme === 'light') {
    return false
  }

  return window.matchMedia(
    '(prefers-color-scheme: dark)',
  ).matches
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.42 1.42" />
      <path d="m17.65 17.65 1.42 1.42" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.35 17.65-1.42 1.42" />
      <path d="m19.07 4.93-1.42 1.42" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M20.8 14.4A8.7 8.7 0 0 1 9.6 3.2 8.7 8.7 0 1 0 20.8 14.4Z" />
    </svg>
  )
}

function LoginPage() {
  const location = useLocation()
  const { login, user } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>()
  const [isDarkMode, setIsDarkMode] =
    useState(getInitialDarkMode)

  useEffect(() => {
    document.title = 'Iniciar sesión - EstateForge'
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle(
      'dark',
      isDarkMode,
    )
  }, [isDarkMode])

  function handleToggleTheme() {
    setIsDarkMode((previous) => {
      const nextTheme = !previous

      document.documentElement.classList.toggle(
        'dark',
        nextTheme,
      )

      window.localStorage.setItem(
        'estateforge-theme',
        nextTheme ? 'dark' : 'light',
      )

      return nextTheme
    })
  }

  if (user) {
    const state = location.state as
      | LocationState
      | undefined

    const target = state?.from?.pathname ?? APP_HOME

    return <Navigate to={target} replace />
  }

  // Solo hay aviso si se llega desde una ruta privada tras cerrar la API la sesión. El motivo
  // viaja en el estado del historial, así que se conserva al recargar la página.
  const sessionNotice = sessionEndedNotice(location.state)
  const showRecoveryLink = [error, sessionNotice].some(
    (message) => message !== null && isSecurityRecoveryRequiredMessage(message),
  )
  // Fase 0: falta verificar el email; se ofrece pedir un enlace nuevo.
  const showVerificationResend = [error, sessionNotice].some(
    (message) => message !== null && isEmailNotVerifiedMessage(message),
  )

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
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <button
        type="button"
        onClick={handleToggleTheme}
        aria-label={
          isDarkMode
            ? 'Cambiar a modo claro'
            : 'Cambiar a modo oscuro'
        }
        title={
          isDarkMode
            ? 'Modo claro'
            : 'Modo oscuro'
        }
        className={[
          'absolute right-4 top-4 z-10',
          'flex h-10 w-10 items-center justify-center',
          'rounded-xl border border-border/80',
          'bg-card text-muted-foreground shadow-sm',
          'transition-colors',
          'hover:bg-accent hover:text-foreground',
          'focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring',
          'focus-visible:ring-offset-2',
          'focus-visible:ring-offset-background',
        ].join(' ')}
      >
        {isDarkMode ? <SunIcon /> : <MoonIcon />}
      </button>

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

        {sessionNotice && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          >
            <p className="font-medium">Se ha cerrado tu sesión.</p>
            <p className="mt-1">{sessionNotice}</p>
          </div>
        )}

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

            <PasswordInput
              id="login-password"
              
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
              autoComplete="current-password"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
             wrapperClassName="mt-2"  visibilityLabel="contraseña" />
          </div>

          <TurnstileField onTokenChange={setTurnstileToken} />

          {error && (
            <p className="text-sm text-destructive">
              {error}
            </p>
          )}

          {showRecoveryLink && (
            <p className="text-sm">
              <Link
                to="/recuperar-cuenta/solicitar"
                className="font-medium text-primary hover:underline"
              >
                Solicitar un enlace de recuperación
              </Link>
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

        {showVerificationResend && (
          <div className="mt-4 space-y-2 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              ¿No encuentras el correo de verificación? Te enviamos un enlace nuevo.
            </p>
            <ResendVerificationForm email={email.trim()} editable />
          </div>
        )}

        <p className="mt-6 text-sm text-muted-foreground">
          ¿No tienes cuenta?{' '}
          <Link
            to="/registro"
            className="font-medium text-primary hover:underline"
          >
            Crear una cuenta
          </Link>
        </p>

        <LegalLinks />
      </div>
    </div>
  )
}

export default LoginPage
