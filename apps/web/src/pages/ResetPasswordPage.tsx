import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import {
  getPasswordValidationErrors,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/lib/passwordPolicy'
import { resetPassword } from '@/services/authService'
import {
  TurnstileField,
  isTurnstileConfigured,
} from '@/components/security/TurnstileField'

function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>()

  useEffect(() => {
    document.title = 'Restablecer contraseña - EstateForge'
  }, [])

  const validationErrors = useMemo(
    () => getPasswordValidationErrors(password),
    [password],
  )

  const passwordsMatch =
    password === confirmPassword

  async function handleSubmit() {
    if (submitting) {
      return
    }

    setError(null)
    setMessage(null)

    if (isTurnstileConfigured() && !turnstileToken) {
      setError('Completa la verificación de seguridad e inténtalo de nuevo.')
      return
    }

    if (!token) {
      setError(
        'El enlace de recuperación no contiene un token válido.',
      )
      return
    }

    if (validationErrors.length > 0) {
      setError(validationErrors[0])
      return
    }

    if (!passwordsMatch) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setSubmitting(true)

    try {
      const responseMessage = await resetPassword(
        token,
        password,
        turnstileToken,
      )
      setMessage(responseMessage)
      setPassword('')
      setConfirmPassword('')
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : 'No se ha podido restablecer la contraseña.',
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
            Nueva contraseña
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea una contraseña nueva para volver a acceder a tu cuenta.
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
              htmlFor="reset-password"
              className="text-sm font-medium"
            >
              Nueva contraseña
            </label>
            <input
              id="reset-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting || !token}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="reset-password-confirm"
              className="text-sm font-medium"
            >
              Repetir contraseña
            </label>
            <input
              id="reset-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
              disabled={submitting || !token}
              required
              autoComplete="new-password"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {password.length > 0 && validationErrors.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {validationErrors.map((validationError) => (
                <li key={validationError}>• {validationError}</li>
              ))}
            </ul>
          )}

          {confirmPassword.length > 0 && !passwordsMatch && (
            <p className="text-xs text-destructive">
              Las contraseñas no coinciden.
            </p>
          )}

          {message && (
            <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {message}{' '}
              <Link
                to="/login"
                className="font-medium text-primary hover:underline"
              >
                Iniciar sesión
              </Link>
            </div>
          )}

          <TurnstileField onTokenChange={setTurnstileToken} />

          {error && (
            <p className="text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              !token ||
              validationErrors.length > 0 ||
              !passwordsMatch
            }
            className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? 'Guardando...'
              : 'Restablecer contraseña'}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          <Link
            to="/login"
            className="font-medium text-primary hover:underline"
          >
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}

export default ResetPasswordPage
