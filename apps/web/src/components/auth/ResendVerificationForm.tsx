import { useId, useState, type FormEvent } from 'react'

import { requestEmailVerification } from '@/services/authService'

interface ResendVerificationFormProps {
  // Email al que se pide el enlace. Si es editable, el usuario puede corregirlo.
  email?: string
  editable?: boolean
  // Texto del botón; por defecto «Enviar un enlace nuevo».
  submitLabel?: string
}

/**
 * Pide un enlace de verificación nuevo (Fase 0). La API responde lo mismo exista o no la
 * cuenta, así que el mensaje de confirmación tampoco lo revela.
 */
export function ResendVerificationForm({ email = '', editable = false, submitLabel = 'Enviar un enlace nuevo' }: ResendVerificationFormProps) {
  const inputId = useId()
  const [value, setValue] = useState(email)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    const target = (editable ? value : email).trim()
    if (!target) {
      setError('Escribe el email de tu cuenta.')
      return
    }
    setSending(true)
    setError(null)
    setNotice(null)
    try {
      setNotice(await requestEmailVerification(target))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se ha podido solicitar el enlace.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3" noValidate>
      {editable && (
        <div>
          <label htmlFor={inputId} className="text-sm font-medium">
            Email
          </label>
          <input
            id={inputId}
            type="email"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={sending}
            required
            autoComplete="email"
            className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={sending}
        className="h-10 w-full rounded-md border text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sending ? 'Enviando...' : submitLabel}
      </button>

      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
