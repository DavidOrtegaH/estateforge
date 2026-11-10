import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { ResendVerificationForm } from '@/components/auth/ResendVerificationForm'
import { useAuth } from '@/hooks/useAuth'
import { verifyEmail, type VerifyEmailResult } from '@/services/authService'

// Formato del token del enlace (64 caracteres hexadecimales), como lo comprueba la API.
const TOKEN_FORMAT = /^[0-9a-f]{64}$/

/**
 * Confirmación del email desde el enlace del correo (Fase 0). El token solo se envía al pulsar
 * el botón, para que un escáner de enlaces del correo no lo consuma al abrir la página. La
 * verificación no inicia sesión.
 */
function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const tokenLooksValid = TOKEN_FORMAT.test(token)
  const { user } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<VerifyEmailResult | null>(null)

  useEffect(() => {
    document.title = 'Verificar email - EstateForge'
  }, [])

  async function handleVerify() {
    if (submitting || !tokenLooksValid) return
    setSubmitting(true)
    try {
      setResult(await verifyEmail(token))
    } finally {
      setSubmitting(false)
    }
  }

  const failed = result !== null && !result.ok
  const showResend = !tokenLooksValid || (failed && (result.reason === 'expired' || result.reason === 'invalid'))

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">EstateForge</p>
          <h1 className="mt-2 text-2xl font-bold">Verificar email</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirma que este email es tuyo para poder usar tu cuenta.
          </p>
        </div>

        {result?.ok ? (
          <div className="space-y-4">
            <div
              role="status"
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
            >
              {result.message}
            </div>
            {user ? (
              // Recarga completa: la sesión abierta vuelve a leer el estado del email.
              <a
                href="/"
                className="flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                Ir a EstateForge
              </a>
            ) : (
              <Link
                to="/login"
                className="flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                Iniciar sesión
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {!tokenLooksValid && (
              <p role="alert" className="text-sm text-destructive">
                El enlace de verificación no es válido. Comprueba que lo has copiado entero o pide uno nuevo.
              </p>
            )}

            {failed && (
              <p role="alert" className="text-sm text-destructive">
                {result.message}
              </p>
            )}

            {tokenLooksValid && !showResend && (
              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={submitting}
                className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Verificando...' : 'Verificar mi email'}
              </button>
            )}

            {showResend && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Escribe el email de tu cuenta y te enviaremos un enlace nuevo.
                </p>
                <ResendVerificationForm email={user?.email ?? ''} editable />
              </div>
            )}

            <p className="text-sm">
              <Link to="/login" className="font-medium text-primary hover:underline">
                Volver al inicio de sesión
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default VerifyEmailPage
