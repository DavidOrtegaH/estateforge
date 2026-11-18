
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import {
  getPasswordValidationErrors,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/lib/passwordPolicy'
import {
  goToLoginAfterPasswordReset,
  submitPasswordReset,
} from '@/lib/passwordReset'
import { resetPassword } from '@/services/authService'
import {
  TurnstileField,
  isTurnstileConfigured,
} from '@/components/security/TurnstileField'


import { PasswordInput } from '@/components/ui/PasswordInput'

function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
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
    setSubmitting(true)

    const result = await submitPasswordReset({
      token,
      password,
      confirmPassword,
      turnstileRequired: isTurnstileConfigured(),
      turnstileToken,
      reset: resetPassword,
    })

    if (result.ok) {
      // Sin esperas: al login reemplazando el enlace con el token. Solo viaja un booleano
      // (ni token, ni email, ni contraseña, ni texto de la API) y no se inicia sesión.
      goToLoginAfterPasswordReset(navigate)
      return
    }

    setError(result.error)
    setSubmitting(false)
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
            <PasswordInput
              id="reset-password"
              
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting || !token}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
             wrapperClassName="mt-2"  visibilityLabel="contraseña" />
          </div>

          <div>
            <label
              htmlFor="reset-password-confirm"
              className="text-sm font-medium"
            >
              Repetir contraseña
            </label>
            <PasswordInput
              id="reset-password-confirm"
              
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
              disabled={submitting || !token}
              required
              autoComplete="new-password"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
             wrapperClassName="mt-2"  visibilityLabel="contraseña" />
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
