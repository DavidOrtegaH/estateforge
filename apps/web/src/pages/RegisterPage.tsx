
import { useEffect, useState } from 'react'

import {
  Link,
  Navigate,
} from 'react-router'

import { useAuth } from '@/hooks/useAuth'
import {
  TurnstileField,
  isTurnstileConfigured,
} from '@/components/security/TurnstileField'


import { PasswordInput } from '@/components/ui/PasswordInput'
import { ResendVerificationForm } from '@/components/auth/ResendVerificationForm'
import { APP_HOME } from '@/lib/routes'
import LegalLinks from '@/components/layout/LegalLinks'
import {
  getPasswordValidationErrors,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/lib/passwordPolicy'

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

function RegisterPage() {
  const { register, user } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] =
    useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>()
  // Cuenta creada sin sesión porque falta verificar el email (Fase 0).
  const [pendingVerification, setPendingVerification] =
    useState<{ email: string; message: string } | null>(null)
  const [isDarkMode, setIsDarkMode] =
    useState(getInitialDarkMode)

  useEffect(() => {
    document.title = 'Crear cuenta - EstateForge'
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
    return <Navigate to={APP_HOME} replace />
  }

  async function handleSubmit() {
    if (submitting) {
      return
    }

    if (isTurnstileConfigured() && !turnstileToken) {
      setError('Completa la verificación de seguridad e inténtalo de nuevo.')
      return
    }

    // La misma política que aplica el servidor (12 a 128 caracteres y complejidad).
    const passwordErrors = getPasswordValidationErrors(password)
    if (passwordErrors.length > 0) {
      setError(passwordErrors[0])
      return
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const result = await register(email.trim(), password, turnstileToken)
      if (result.kind === 'verification_required') {
        setPendingVerification({ email: result.email, message: result.message })
      }
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : 'No se ha podido crear la cuenta.',
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
          <h1 className="text-2xl font-bold">
            Crear cuenta
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Regístrate para empezar a usar EstateForge.
          </p>
        </div>

        {pendingVerification ? (
          <div className="space-y-4">
            <div
              role="status"
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
            >
              <p className="font-medium">Revisa tu correo.</p>
              <p className="mt-1">{pendingVerification.message}</p>
              <p className="mt-1 break-all">
                Enviado a <span className="font-medium">{pendingVerification.email}</span>.
              </p>
            </div>

            <p className="text-sm text-muted-foreground">
              ¿No te ha llegado? Revisa la carpeta de spam o pide otro enlace.
            </p>

            <ResendVerificationForm email={pendingVerification.email} />

            <Link
              to="/login"
              className="flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Volver al inicio de sesión
            </Link>
          </div>
        ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="register-email"
              className="text-sm font-medium"
            >
              Email
            </label>

            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              disabled={submitting}
              required
              autoComplete="email"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="register-password"
              className="text-sm font-medium"
            >
              Contraseña
            </label>

            <PasswordInput
              id="register-password"
              
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              disabled={submitting}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
             wrapperClassName="mt-2"  visibilityLabel="contraseña" />

            <p className="mt-1 text-xs text-muted-foreground">
              Entre {MIN_PASSWORD_LENGTH} y {MAX_PASSWORD_LENGTH} caracteres, con al menos una mayúscula, una minúscula, un número y un carácter especial.
            </p>
          </div>

          <div>
            <label
              htmlFor="register-password-confirm"
              className="text-sm font-medium"
            >
              Repite la contraseña
            </label>

            <PasswordInput
              id="register-password-confirm"
              
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
              disabled={submitting}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
             wrapperClassName="mt-2"  visibilityLabel="contraseña" />
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
              ? 'Creando cuenta...'
              : 'Crear cuenta'}
          </button>
        </form>
        )}

        <p className="mt-6 text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{' '}
          <Link
            to="/login"
            className="font-medium text-primary hover:underline"
          >
            Iniciar sesión
          </Link>
        </p>

        <LegalLinks />
      </div>
    </div>
  )
}

export default RegisterPage
