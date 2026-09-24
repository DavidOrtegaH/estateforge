import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { requestPasswordReset } from '@/services/authService'
import {
  TurnstileField,
  isTurnstileConfigured,
} from '@/components/security/TurnstileField'

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>()

  useEffect(() => {
    document.title = 'Recuperar contraseña - EstateForge'
  }, [])

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
    setMessage(null)

    try {
      const responseMessage = await requestPasswordReset(
        email.trim(),
        turnstileToken,
      )
      setMessage(responseMessage)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se ha podido procesar la solicitud.',
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
            Recuperar contraseña
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Introduce el email de tu cuenta y te indicaremos cómo restablecerla.
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
              htmlFor="forgot-email"
              className="text-sm font-medium"
            >
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              required
              autoComplete="email"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {message && (
            <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {message}
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
            disabled={submitting}
            className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? 'Procesando...'
              : 'Enviar instrucciones'}
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

export default ForgotPasswordPage
