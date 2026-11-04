import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import {
  getPasswordValidationErrors,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/lib/passwordPolicy'
import {
  completeSecurityRecovery,
  SecurityRecoveryError,
  type SecurityRecoveryErrorKind,
} from '@/services/authService'
import {
  TurnstileField,
  isTurnstileConfigured,
} from '@/components/security/TurnstileField'
import { PasswordInput } from '@/components/ui/PasswordInput'

// Recuperación obligatoria tras un incidente de seguridad (E2.5). El destino ya lo
// conoce la API: aquí solo se pide la contraseña nueva.

// Errores que cierran el enlace: se muestran textos propios, nunca detalles del servidor.
type ClosedLinkKind = Extract<
  SecurityRecoveryErrorKind,
  'invalid_link' | 'link_no_longer_valid' | 'email_unavailable'
>

const CLOSED_LINK_MESSAGES: Record<ClosedLinkKind | 'missing_token', string> = {
  missing_token:
    'El enlace de recuperación no es válido. Usa el enlace completo que recibiste por email.',
  invalid_link:
    'El enlace de recuperación no es válido o ha caducado.',
  link_no_longer_valid:
    'Este enlace ya no permite completar la recuperación de la cuenta. Contacta con soporte si sigues sin poder acceder.',
  email_unavailable:
    'No se ha podido completar la recuperación porque el email de recuperación no está disponible. Contacta con soporte.',
}

// Solo un enlace ausente, inválido o caducado se resuelve pidiendo otro; en los demás
// estados el texto remite a soporte.
const REQUEST_NEW_LINK_REASONS: readonly (ClosedLinkKind | 'missing_token')[] = [
  'missing_token',
  'invalid_link',
]

const UNEXPECTED_ERROR_MESSAGE =
  'No se ha podido completar la recuperación. Inténtalo de nuevo en unos minutos.'

type PageState =
  | { status: 'form' }
  | { status: 'success'; message: string }
  | { status: 'closed'; reason: ClosedLinkKind | 'missing_token' }

function isClosedLinkKind(kind: SecurityRecoveryErrorKind): kind is ClosedLinkKind {
  return kind === 'invalid_link' || kind === 'link_no_longer_valid' || kind === 'email_unavailable'
}

function RecoverAccountPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>()
  // Cambiarla vuelve a montar TurnstileField, que crea un widget y un token nuevos.
  const [turnstileKey, setTurnstileKey] = useState(0)
  // Bloqueo síncrono: el estado submitting no se actualiza a tiempo si se envía dos veces seguidas.
  const submittingRef = useRef(false)
  const [pageState, setPageState] = useState<PageState>(
    token ? { status: 'form' } : { status: 'closed', reason: 'missing_token' },
  )

  useEffect(() => {
    document.title = 'Recuperar acceso - EstateForge'
  }, [])

  const validationErrors = useMemo(
    () => getPasswordValidationErrors(password),
    [password],
  )

  const passwordsMatch =
    password === confirmPassword

  // El servidor ya ha gastado el token de Turnstile y el widget no lo sabe:
  // para reintentar hace falta uno nuevo.
  function renewTurnstile() {
    setTurnstileToken(undefined)
    setTurnstileKey((key) => key + 1)
  }

  async function handleSubmit() {
    if (submittingRef.current || submitting || pageState.status !== 'form') {
      return
    }

    setError(null)

    if (isTurnstileConfigured() && !turnstileToken) {
      setError('Completa la verificación de seguridad e inténtalo de nuevo.')
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

    submittingRef.current = true
    setSubmitting(true)

    try {
      const responseMessage = await completeSecurityRecovery(
        token,
        password,
        turnstileToken,
      )
      setPassword('')
      setConfirmPassword('')
      setPageState({ status: 'success', message: responseMessage })
    } catch (recoveryError) {
      if (recoveryError instanceof SecurityRecoveryError) {
        if (isClosedLinkKind(recoveryError.kind)) {
          setPassword('')
          setConfirmPassword('')
          setPageState({ status: 'closed', reason: recoveryError.kind })
        } else if (recoveryError.kind === 'rejected') {
          // Validación o Turnstile: la API explica qué corregir.
          setError(recoveryError.message)
          renewTurnstile()
        } else {
          setError(UNEXPECTED_ERROR_MESSAGE)
          renewTurnstile()
        }
      } else {
        // Fallo de red u otro error del navegador.
        setError(UNEXPECTED_ERROR_MESSAGE)
        renewTurnstile()
      }
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
            Recuperar acceso
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tras revisar el incidente de seguridad de tu cuenta, establece una contraseña nueva para volver a acceder.
          </p>
        </div>

        {pageState.status === 'success' && (
          <div
            role="status"
            className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
          >
            {pageState.message}{' '}
            <Link
              to="/login"
              className="font-medium text-primary hover:underline"
            >
              Iniciar sesión
            </Link>
          </div>
        )}

        {pageState.status === 'closed' && (
          <p role="alert" className="text-sm text-destructive">
            {CLOSED_LINK_MESSAGES[pageState.reason]}
          </p>
        )}

        {pageState.status === 'closed' &&
          REQUEST_NEW_LINK_REASONS.includes(pageState.reason) && (
            <p className="mt-3 text-sm">
              <Link
                to="/recuperar-cuenta/solicitar"
                className="font-medium text-primary hover:underline"
              >
                Solicitar un enlace nuevo
              </Link>
            </p>
          )}

        {pageState.status === 'form' && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="recover-password"
                className="text-sm font-medium"
              >
                Nueva contraseña
              </label>
              <PasswordInput
                id="recover-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                required
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                autoComplete="new-password"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                wrapperClassName="mt-2"
                visibilityLabel="contraseña"
              />
            </div>

            <div>
              <label
                htmlFor="recover-password-confirm"
                className="text-sm font-medium"
              >
                Repetir contraseña
              </label>
              <PasswordInput
                id="recover-password-confirm"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                disabled={submitting}
                required
                autoComplete="new-password"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                wrapperClassName="mt-2"
                visibilityLabel="contraseña"
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
              disabled={
                submitting ||
                validationErrors.length > 0 ||
                !passwordsMatch
              }
              className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? 'Guardando...'
                : 'Establecer contraseña'}
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

export default RecoverAccountPage
