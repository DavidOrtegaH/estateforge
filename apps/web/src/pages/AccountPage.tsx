

import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'

import {
  getPasswordValidationErrors,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/lib/passwordPolicy'
import { emailChangeCompletedMessage } from '@/lib/authSession'
import { useAuth } from '@/hooks/useAuth'
import { useModalDialog } from '@/hooks/useModalDialog'
import { requestEmailChange } from '@/services/authService'
import {
  deleteStoredAIKey,
  getStoredAIKeyStatus,
  saveStoredAIKey,
  type StoredAIKeyProvider,
} from '@/services/aiKeyService'


import { PasswordInput } from '@/components/ui/PasswordInput'

function AccountPage() {
  const navigate = useNavigate()

  const {
    user,
    changePassword,
    deleteAccount,
    updateEmail,
  } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changeSubmitting, setChangeSubmitting] = useState(false)
  const [changeMessage, setChangeMessage] = useState<string | null>(null)
  const [changeError, setChangeError] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)
  const [emailVerifying, setEmailVerifying] = useState(false)
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailVerificationRequested, setEmailVerificationRequested] = useState(false)

  const [deletePassword, setDeletePassword] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const [storedKeys, setStoredKeys] = useState({
    gemini: false,
    openai: false,
  })

  const [aiKeyInputs, setAiKeyInputs] = useState({
    gemini: '',
    openai: '',
  })

  const [savingAIKey, setSavingAIKey] =
    useState<StoredAIKeyProvider | null>(null)

  const [deletingAIKey, setDeletingAIKey] =
    useState<StoredAIKeyProvider | null>(null)

  const [aiKeyMessage, setAiKeyMessage] =
    useState<string | null>(null)

  const [aiKeyError, setAiKeyError] =
    useState<string | null>(null)

  useEffect(() => {
    document.title = 'Cuenta - EstateForge'
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadStoredKeys() {
      try {
        const status = await getStoredAIKeyStatus()

        if (!cancelled) {
          setStoredKeys(status)
        }
      } catch {
        // La página sigue siendo usable aunque no se pueda cargar el estado.
      }
    }

    void loadStoredKeys()

    return () => {
      cancelled = true
    }
  }, [])

  // Foco y teclado del diálogo: Escape no lo cierra mientras se elimina la cuenta.
  // Sin foco inicial indicado, lo recibe el primer control: el campo de contraseña.
  const deleteDialogRef = useModalDialog<HTMLDivElement>({
    open: isDeleteDialogOpen,
    onClose: () => setIsDeleteDialogOpen(false),
    canClose: !deleteSubmitting,
  })

  const validationErrors = useMemo(
    () => getPasswordValidationErrors(newPassword),
    [newPassword],
  )

  if (!user) {
    return <Navigate to="/login" replace />
  }

  const passwordsMatch =
    newPassword.length > 0 &&
    newPassword === confirmPassword

  async function handleChangePassword() {
    if (changeSubmitting) {
      return
    }

    setChangeMessage(null)
    setChangeError(null)

    if (!currentPassword) {
      setChangeError('Introduce tu contraseña actual.')
      return
    }

    if (validationErrors.length > 0) {
      setChangeError(validationErrors[0])
      return
    }

    if (!passwordsMatch) {
      setChangeError('Las contraseñas nuevas no coinciden.')
      return
    }

    setChangeSubmitting(true)

    try {
      const message = await changePassword(
        currentPassword,
        newPassword,
      )

      setChangeMessage(message)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')

      window.setTimeout(() => {
        navigate('/login', { replace: true })
      }, 900)
    } catch (error) {
      setChangeError(
        error instanceof Error
          ? error.message
          : 'No se ha podido cambiar la contraseña.',
      )
    } finally {
      setChangeSubmitting(false)
    }
  }


async function handleRequestEmailChange() {
  if (emailSubmitting || !user) {
    return
  }

  setEmailMessage(null)
  setEmailError(null)

  const normalizedEmail = newEmail.trim().toLowerCase()

  if (!emailCurrentPassword) {
    setEmailError('Introduce tu contraseña actual para confirmar el cambio.')
    return
  }

  if (!normalizedEmail) {
    setEmailError('Introduce el nuevo email.')
    return
  }

  if (normalizedEmail === user.email.toLowerCase()) {
    setEmailError(
      'El nuevo email debe ser diferente al actual.',
    )
    return
  }

  setEmailSubmitting(true)

  try {
    const message = await requestEmailChange(
      normalizedEmail,
      emailCurrentPassword,
    )

    setEmailMessage(message)
    setEmailCode('')
    setEmailVerificationRequested(true)
    setEmailCurrentPassword('')
  } catch (error) {
    setEmailError(
      error instanceof Error
        ? error.message
        : 'No se ha podido solicitar el cambio de email.',
    )
  } finally {
    setEmailSubmitting(false)
  }
}

  async function handleVerifyEmailChange() {
    if (emailSubmitting || emailVerifying) {
      return
    }

    setEmailError(null)
    setEmailMessage(null)

    if (!/^\d{6}$/.test(emailCode.trim())) {
      setEmailError('Introduce el código de 6 dígitos recibido por email.')
      return
    }

    setEmailVerifying(true)

    try {
      // El cambio está hecho aunque no se haya podido avisar a la dirección anterior (decisión D4).
      const result = await updateEmail(emailCode.trim())
      setEmailMessage(emailChangeCompletedMessage(result))
      setEmailCode('')
      setNewEmail('')
      setEmailCurrentPassword('')
      setEmailVerificationRequested(false)
    } catch (error) {
      setEmailError(
        error instanceof Error
          ? error.message
          : 'No se ha podido verificar el cambio de email.',
      )
    } finally {
      setEmailVerifying(false)
    }
  }

  async function handleSaveAIKey(
    provider: StoredAIKeyProvider,
  ) {
    if (savingAIKey || deletingAIKey) {
      return
    }

    const apiKey = aiKeyInputs[provider].trim()

    if (!apiKey) {
      setAiKeyError(
        'Introduce una API key antes de guardarla.',
      )
      setAiKeyMessage(null)
      return
    }

    setSavingAIKey(provider)
    setAiKeyError(null)
    setAiKeyMessage(null)

    try {
      await saveStoredAIKey(provider, apiKey)

      setStoredKeys((current) => ({
        ...current,
        [provider]: true,
      }))

      setAiKeyInputs((current) => ({
        ...current,
        [provider]: '',
      }))

      setAiKeyMessage(
        `La API key de ${
          provider === 'gemini'
            ? 'Gemini'
            : 'OpenAI'
        } se ha guardado de forma cifrada.`,
      )
    } catch (error) {
      setAiKeyError(
        error instanceof Error
          ? error.message
          : 'No se ha podido guardar la API key.',
      )
    } finally {
      setSavingAIKey(null)
    }
  }

  async function handleDeleteAIKey(
    provider: StoredAIKeyProvider,
  ) {
    if (savingAIKey || deletingAIKey) {
      return
    }

    setDeletingAIKey(provider)
    setAiKeyError(null)
    setAiKeyMessage(null)

    try {
      await deleteStoredAIKey(provider)

      setStoredKeys((current) => ({
        ...current,
        [provider]: false,
      }))

      setAiKeyMessage(
        `La API key de ${
          provider === 'gemini'
            ? 'Gemini'
            : 'OpenAI'
        } se ha eliminado.`,
      )
    } catch (error) {
      setAiKeyError(
        error instanceof Error
          ? error.message
          : 'No se ha podido eliminar la API key.',
      )
    } finally {
      setDeletingAIKey(null)
    }
  }

  async function handleDeleteAccount() {
    if (deleteSubmitting) {
      return
    }

    setDeleteSubmitting(true)
    setDeleteError(null)

    try {
      await deleteAccount(deletePassword)
      navigate('/login', { replace: true })
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : 'No se ha podido eliminar la cuenta.',
      )
      setDeleteSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      {/* =========================================================
          CABECERA
          ========================================================= */}

      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"
              />
            </svg>
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Cuenta
            </h1>

            <p className="mt-1 text-sm text-muted-foreground">
              Gestiona tu perfil, seguridad y configuración de IA.
            </p>
          </div>
        </div>
      </div>

      {/* =========================================================
          INFORMACIÓN DE CUENTA
          ========================================================= */}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-5 sm:px-6">
          <h2 className="text-lg font-semibold">
            Información de la cuenta
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            Datos básicos asociados a tu cuenta de EstateForge.
          </p>
        </div>

        <div className="p-5 sm:p-6">
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Correo electrónico
            </p>

            <p
              className="mt-2 break-all text-sm font-medium text-foreground"
              title={user.email}
            >
              {user.email}
            </p>
          </div>
        </div>
      </section>



      {/* =========================================================
          CAMBIO DE EMAIL
          ========================================================= */}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 12 13l9-5.5M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5Z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold">Cambiar email</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Confirma tu contraseña, introduce el nuevo correo y verifica el código que enviaremos a esa dirección. También avisaremos a tu correo actual por seguridad; no tendrás que autorizar el cambio desde allí.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="space-y-5">
            <div>
              <label htmlFor="email-change-current-password" className="text-sm font-medium">Confirma tu contraseña actual</label>
              <PasswordInput
                id="email-change-current-password"
                value={emailCurrentPassword}
                onChange={(event) => setEmailCurrentPassword(event.target.value)}
                disabled={emailSubmitting || emailVerifying}
                required
                maxLength={MAX_PASSWORD_LENGTH}
                autoComplete="current-password"
                className="mt-2 h-11 w-full rounded-xl border bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Introduce tu contraseña actual"
                wrapperClassName="mt-2"
                visibilityLabel="contraseña"
              />
            </div>

            <div>
              <label htmlFor="new-account-email" className="text-sm font-medium">Nuevo email</label>
              <input id="new-account-email" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} disabled={emailSubmitting || emailVerifying} autoComplete="email" inputMode="email" className="mt-2 h-11 w-full rounded-xl border bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50" placeholder="nuevo@email.com" />
            </div>

            <div className="flex justify-end border-t pt-5">
              <button type="button" onClick={() => void handleRequestEmailChange()} disabled={emailSubmitting || emailVerifying} className="h-11 rounded-xl border bg-background px-5 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                {emailSubmitting ? 'Enviando...' : 'Enviar código'}
              </button>
            </div>

            {emailVerificationRequested && (
              <div className="rounded-xl border bg-muted/30 p-4">
                <label htmlFor="email-change-code" className="text-sm font-medium">Código de verificación</label>
                <input id="email-change-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={emailSubmitting || emailVerifying} className="mt-2 h-11 w-full rounded-xl border bg-background px-3.5 text-center text-lg font-semibold tracking-[0.35em] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50" placeholder="000000" />
                <button type="button" onClick={() => void handleVerifyEmailChange()} disabled={emailSubmitting || emailVerifying} className="mt-4 h-11 w-full rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                  {emailVerifying ? 'Verificando...' : 'Confirmar nuevo email'}
                </button>
              </div>
            )}

            {emailMessage && <div role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">{emailMessage}</div>}
            {emailError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{emailError}</div>}
          </div>
        </div>
      </section>

      {/* =========================================================
          CAMBIO DE CONTRASEÑA
          ========================================================= */}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <rect
                  width="14"
                  height="10"
                  x="5"
                  y="10"
                  rx="2"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 10V7a4 4 0 0 1 8 0v3"
                />
              </svg>
            </div>

            <div>
              <h2 className="text-lg font-semibold">
                Cambiar contraseña
              </h2>

              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Actualiza tu contraseña periódicamente para mantener
                protegida tu cuenta.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void handleChangePassword()
            }}
          >
            <div className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <label
                  htmlFor="current-password"
                  className="text-sm font-medium"
                >
                  Contraseña actual
                </label>

                <PasswordInput
                  id="current-password"
                  
                  value={currentPassword}
                  onChange={(event) =>
                    setCurrentPassword(event.target.value)
                  }
                  disabled={changeSubmitting}
                  required
                  maxLength={MAX_PASSWORD_LENGTH}
                  autoComplete="current-password"
                  className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Introduce tu contraseña actual"
                 wrapperClassName="mt-2"  visibilityLabel="contraseña" />
              </div>

              <div>
                <label
                  htmlFor="new-password"
                  className="text-sm font-medium"
                >
                  Nueva contraseña
                </label>

                <PasswordInput
                  id="new-password"
                  
                  value={newPassword}
                  onChange={(event) =>
                    setNewPassword(event.target.value)
                  }
                  disabled={changeSubmitting}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={MAX_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Introduce una nueva contraseña"
                 wrapperClassName="mt-2"  visibilityLabel="contraseña" />
              </div>

              <div>
                <label
                  htmlFor="confirm-new-password"
                  className="text-sm font-medium"
                >
                  Repetir nueva contraseña
                </label>

                <PasswordInput
                  id="confirm-new-password"
                  
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(event.target.value)
                  }
                  disabled={changeSubmitting}
                  required
                  autoComplete="new-password"
                  className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Repite la nueva contraseña"
                 wrapperClassName="mt-2"  visibilityLabel="contraseña" />
              </div>
            </div>

            {newPassword.length > 0 &&
              validationErrors.length > 0 && (
                <div className="rounded-xl border bg-muted/30 p-4">
                  <p className="text-xs font-semibold text-foreground">
                    Requisitos de la contraseña
                  </p>

                  <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                    {validationErrors.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2"
                      >
                        <span
                          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {confirmPassword.length > 0 &&
              !passwordsMatch && (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                >
                  Las contraseñas nuevas no coinciden.
                </div>
              )}

            {changeMessage && (
              <div
                role="status"
                className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground"
              >
                {changeMessage}
              </div>
            )}

            {changeError && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                {changeError}
              </div>
            )}

            <div className="flex justify-end border-t pt-5">
              <button
                type="submit"
                disabled={
                  changeSubmitting ||
                  validationErrors.length > 0 ||
                  !passwordsMatch
                }
                className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {changeSubmitting
                  ? 'Guardando...'
                  : 'Cambiar contraseña'}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* =========================================================
          API KEYS
          ========================================================= */}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 7a5 5 0 1 0-9.9 1H3v4h2v2h3v-2h2.1A5 5 0 0 0 15 7Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18 14h.01M21 17h.01M18 20h.01"
                />
              </svg>
            </div>

            <div>
              <h2 className="text-lg font-semibold">
                Claves de IA
              </h2>

              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Puedes guardar una API key propia para utilizarla como
                respaldo cuando se agote la cuota de la API key proporcionada
                por EstateForge.
              </p>
            </div>
          </div>
            <p className="text-xs mt-4 leading-5 text-muted-foreground">
              Las claves se almacenan cifradas y nunca se muestran de
              nuevo después de guardarlas.
            </p>
        </div>
        <div className="p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {(['gemini', 'openai'] as const).map(
              (provider) => {
                const label =
                  provider === 'gemini'
                    ? 'Google Gemini'
                    : 'OpenAI'

                const configured =
                  storedKeys[provider]

                const busy =
                  savingAIKey === provider ||
                  deletingAIKey === provider

                return (
                  <div
                    key={provider}
                    className="rounded-2xl border bg-background p-4 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="font-semibold">
                          {label}
                        </h3>

                        <div className="mt-2">
                          {configured ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-primary"
                                aria-hidden="true"
                              />
                              API key configurada
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
                                aria-hidden="true"
                              />
                              Sin configurar
                            </span>
                          )}
                        </div>
                      </div>

                      {configured && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleDeleteAIKey(provider)
                          }
                          disabled={busy}
                          className="shrink-0 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingAIKey === provider
                            ? 'Eliminando...'
                            : 'Eliminar'}
                        </button>
                      )}
                    </div>

                    <div className="mt-4">
                      <label
                        htmlFor={`ai-key-${provider}`}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {configured
                          ? 'Nueva API key'
                          : 'API key'}
                      </label>

                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <PasswordInput
                          id={`ai-key-${provider}`}
                          
                          value={aiKeyInputs[provider]}
                          onChange={(event) =>
                            setAiKeyInputs(
                              (current) => ({
                                ...current,
                                [provider]:
                                  event.target.value,
                              }),
                            )
                          }
                          disabled={busy}
                          placeholder={
                            configured
                              ? 'Introduce una nueva key'
                              : 'Pega aquí tu API key'
                          }
                          autoComplete="off"
                          className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                         wrapperClassName="min-w-0 flex-1"  visibilityLabel="clave API" />

                        <button
                          type="button"
                          onClick={() =>
                            void handleSaveAIKey(provider)
                          }
                          disabled={
                            busy ||
                            !aiKeyInputs[
                              provider
                            ].trim()
                          }
                          className="h-11 shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingAIKey === provider
                            ? 'Guardando...'
                            : configured
                              ? 'Reemplazar'
                              : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              },
            )}
          </div>

          {aiKeyMessage && (
            <div
              role="status"
              className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground"
            >
              {aiKeyMessage}
            </div>
          )}

          {aiKeyError && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {aiKeyError}
            </div>
          )}
        </div>
      </section>

      {/* =========================================================
          ELIMINACIÓN DE CUENTA
          ========================================================= */}

      <section className="overflow-hidden rounded-2xl border border-destructive/30 bg-card shadow-sm">
        <div className="border-b border-destructive/10 px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
                />
              </svg>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-destructive">
                Eliminar cuenta
              </h2>

              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Esta acción elimina tu cuenta y los datos asociados.
                No se puede deshacer desde EstateForge.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {deleteError && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {deleteError}
            </div>
          )}

          <div className="flex flex-col gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">
                Zona de peligro
              </p>

              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Tendrás que introducir tu contraseña actual para
                confirmar la eliminación.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setDeleteError(null)
                setDeletePassword('')
                setIsDeleteDialogOpen(true)
              }}
              className="h-10 shrink-0 rounded-xl border border-destructive/40 px-4 text-sm font-semibold text-destructive transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
            >
              Eliminar mi cuenta
            </button>
          </div>
        </div>
      </section>

      {/* =========================================================
          MODAL ELIMINAR CUENTA
          ========================================================= */}

      {isDeleteDialogOpen && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.currentTarget === event.target &&
              !deleteSubmitting
            ) {
              setIsDeleteDialogOpen(false)
            }
          }}
        >
          <div
            ref={deleteDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            aria-describedby="delete-account-description"
            className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v4m0 4h.01M10.3 3.8 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"
                  />
                </svg>
              </div>

              <div>
                <h3
                  id="delete-account-title"
                  className="text-lg font-semibold"
                >
                  ¿Eliminar tu cuenta?
                </h3>

                <p
                  id="delete-account-description"
                  className="mt-1 text-sm leading-6 text-muted-foreground"
                >
                  Se eliminarán la cuenta, los inmuebles y los
                  anuncios asociados. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <label
                htmlFor="delete-account-password"
                className="text-sm font-medium"
              >
                Contraseña actual
              </label>

              <PasswordInput
                id="delete-account-password"
                
                value={deletePassword}
                onChange={(event) =>
                  setDeletePassword(event.target.value)
                }
                disabled={deleteSubmitting}
                required
                autoComplete="current-password"
                className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm outline-none transition focus:border-destructive focus:ring-2 focus:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Introduce tu contraseña"
               wrapperClassName="mt-2"  visibilityLabel="contraseña" />
            </div>

            {deleteError && (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                {deleteError}
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={deleteSubmitting}
                onClick={() =>
                  setIsDeleteDialogOpen(false)
                }
                className="h-11 rounded-xl border px-4 text-sm font-semibold transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={
                  deleteSubmitting ||
                  !deletePassword
                }
                onClick={() =>
                  void handleDeleteAccount()
                }
                className="h-11 rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground transition hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteSubmitting
                  ? 'Eliminando...'
                  : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AccountPage


