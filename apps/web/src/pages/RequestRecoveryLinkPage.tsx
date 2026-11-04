import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import {
  requestSecurityRecoveryLink,
  SecurityRecoveryRequestError,
} from '@/services/authService'
import {
  TurnstileField,
  isTurnstileConfigured,
} from '@/components/security/TurnstileField'

// Solicitud de un enlace nuevo de recuperación obligatoria (E4.1). La API responde
// siempre lo mismo y elige el destino: aquí no se muestra el email ni ningún destino.

const UNEXPECTED_ERROR_MESSAGE =
  'No se ha podido enviar la solicitud. Inténtalo de nuevo en unos minutos.'

function RequestRecoveryLinkPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Mensaje genérico de la API tras una solicitud aceptada; oculta el formulario.
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>()
  // Cambiarla vuelve a montar TurnstileField, que crea un widget y un token nuevos.
  const [turnstileKey, setTurnstileKey] = useState(0)
  // Bloqueo síncrono: el estado submitting no se actualiza a tiempo si se envía dos veces seguidas.
  const submittingRef = useRef(false)

  useEffect(() => {
    document.title = 'Solicitar enlace de recuperación - EstateForge'
  }, [])

  // El servidor ya ha gastado el token de Turnstile y el widget no lo sabe:
  // para reintentar hace falta uno nuevo.
  function renewTurnstile() {
    setTurnstileToken(undefined)
    setTurnstileKey((key) => key + 1)
  }

  function showFormAgain() {
    setSuccessMessage(null)
    setError(null)
    setEmail('')
    renewTurnstile()
  }

  async function handleSubmit() {
    if (submittingRef.current || submitting || successMessage !== null) {
      return
    }

    setError(null)

    if (isTurnstileConfigured() && !turnstileToken) {
      setError('Completa la verificación de seguridad e inténtalo de nuevo.')
      return
    }

    submittingRef.current = true
    setSubmitting(true)

    try {
      const responseMessage = await requestSecurityRecoveryLink(
        email.trim(),
        turnstileToken,
      )
      setEmail('')
      setSuccessMessage(responseMessage)
    } catch (requestError) {
      // Los mensajes del servicio no incluyen el email ni detalles del servidor.
      setError(
        requestError instanceof SecurityRecoveryRequestError
          ? requestError.message
          : UNEXPECTED_ERROR_MESSAGE,
      )
      renewTurnstile()
    } finally {
      submittingRef.current = false
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
            Solicitar enlace de recuperación
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Introduce el email de tu cuenta. Si tiene una recuperación pendiente, enviaremos un enlace nuevo al destino de recuperación registrado.
          </p>
        </div>

        {successMessage !== null ? (
          <div className="space-y-4">
            <div
              role="status"
              className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              {successMessage}
            </div>
            <button
              type="button"
              onClick={showFormAgain}
              className="text-sm font-medium text-primary hover:underline"
            >
              Enviar otra solicitud
            </button>
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
                htmlFor="request-recovery-email"
                className="text-sm font-medium"
              >
                Email
              </label>
              <input
                id="request-recovery-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
                required
                autoComplete="email"
                inputMode="email"
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <TurnstileField
              key={turnstileKey}
              onTokenChange={setTurnstileToken}
            />

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Enviando...' : 'Enviar enlace'}
            </button>
          </form>
        )}

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

export default RequestRecoveryLinkPage
