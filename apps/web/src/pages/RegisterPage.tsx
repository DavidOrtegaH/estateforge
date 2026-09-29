import { useEffect, useMemo, useState } from 'react'

import {
  Link,
  Navigate,
} from 'react-router'

import {
  TurnstileField,
  isTurnstileConfigured,
} from '@/components/security/TurnstileField'
import { useAuth } from '@/hooks/useAuth'
import {
  getPasswordValidationErrors,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/lib/passwordPolicy'
import FooterLoginRegister from '@/components/layout/FooterLoginRegister'

function RegisterPage() {
  const { register, user } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] =
    useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] =
    useState<string>()

  const passwordErrors = useMemo(
    () => getPasswordValidationErrors(password),
    [password],
  )

  useEffect(() => {
    document.title = 'Crear cuenta - EstateForge'
  }, [])

  if (user) {
    return <Navigate to="/" replace />
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
      await register(
        email.trim(),
        password,
        turnstileToken,
      )
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="mt-2 text-2xl font-bold">
            Crear cuenta
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Regístrate para empezar a usar EstateForge.
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
              htmlFor="register-email"
              className="text-sm font-medium"
            >
              Correo electrónico
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
              inputMode="email"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="register-password"
              className="text-sm font-medium"
            >
              Contraseña
            </label>

            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              disabled={submitting}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              aria-invalid={
                password.length > 0 &&
                passwordErrors.length > 0
              }
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            />

            <div className="mt-2 space-y-1">
              <p className="text-xs text-muted-foreground">
                La contraseña debe cumplir estos requisitos:
              </p>

              <ul className="space-y-1 text-xs">
                <li
                  className={
                    password.length >= MIN_PASSWORD_LENGTH &&
                      password.length <= MAX_PASSWORD_LENGTH
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-muted-foreground'
                  }
                >
                  • Entre {MIN_PASSWORD_LENGTH} y{' '}
                  {MAX_PASSWORD_LENGTH} caracteres
                </li>

                <li
                  className={
                    /\p{Ll}/u.test(password)
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-muted-foreground'
                  }
                >
                  • Una letra minúscula
                </li>

                <li
                  className={
                    /\p{Lu}/u.test(password)
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-muted-foreground'
                  }
                >
                  • Una letra mayúscula
                </li>

                <li
                  className={
                    /\p{N}/u.test(password)
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-muted-foreground'
                  }
                >
                  • Un número
                </li>

                <li
                  className={
                    /[^\p{L}\p{N}\s]/u.test(password)
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-muted-foreground'
                  }
                >
                  • Un carácter especial
                </li>
              </ul>
            </div>
          </div>

          <div>
            <label
              htmlFor="register-password-confirm"
              className="text-sm font-medium"
            >
              Repite la contraseña
            </label>

            <input
              id="register-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
              disabled={submitting}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              aria-invalid={
                confirmPassword.length > 0 &&
                confirmPassword !== password
              }
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <TurnstileField
            onTokenChange={setTurnstileToken}
          />

          {error && (
            <p
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? 'Creando cuenta...'
              : 'Crear cuenta'}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{' '}
          <Link
            to="/login"
            className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Iniciar sesión
          </Link>
        </p>
      </div>

      <FooterLoginRegister />
    </div>
  )
}

export default RegisterPage