import { useEffect, useState } from 'react'

import {
  Link,
  Navigate,
} from 'react-router'

import { useAuth } from '@/hooks/useAuth'

function RegisterPage() {
  const { register, user } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] =
    useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

    if (password.length < 8) {
      setError(
        'La contraseña debe tener al menos 8 caracteres.',
      )
      return
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await register(email.trim(), password)
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">
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

            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              disabled={submitting}
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />

            <p className="mt-1 text-xs text-muted-foreground">
              Mínimo 8 caracteres.
            </p>
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
              minLength={8}
              autoComplete="new-password"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

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

        <p className="mt-6 text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{' '}
          <Link
            to="/login"
            className="font-medium text-primary hover:underline"
          >
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}

export default RegisterPage