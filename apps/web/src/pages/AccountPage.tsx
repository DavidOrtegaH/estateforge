import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'

import {
  getPasswordValidationErrors,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/lib/passwordPolicy'
import { useAuth } from '@/hooks/useAuth'

function AccountPage() {
  const navigate = useNavigate()
  const {
    user,
    changePassword,
    deleteAccount,
  } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changeSubmitting, setChangeSubmitting] = useState(false)
  const [changeMessage, setChangeMessage] = useState<string | null>(null)
  const [changeError, setChangeError] = useState<string | null>(null)

  const [deletePassword, setDeletePassword] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  useEffect(() => {
    document.title = 'Cuenta - EstateForge'
  }, [])

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
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cuenta</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestiona tus credenciales y la eliminación de tu cuenta.
        </p>
      </div>

      <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">Información de la cuenta</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Email asociado a tu cuenta.
        </p>
        <div className="mt-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm font-medium">
          {user.email}
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">Cambiar contraseña</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Por seguridad, tendrás que iniciar sesión de nuevo después del cambio.
        </p>

        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleChangePassword()
          }}
        >
          <div>
            <label htmlFor="current-password" className="text-sm font-medium">
              Contraseña actual
            </label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={changeSubmitting}
              required
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="current-password"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="new-password" className="text-sm font-medium">
              Nueva contraseña
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={changeSubmitting}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="confirm-new-password" className="text-sm font-medium">
              Repetir nueva contraseña
            </label>
            <input
              id="confirm-new-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={changeSubmitting}
              required
              autoComplete="new-password"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {newPassword.length > 0 && validationErrors.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {validationErrors.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          )}

          {confirmPassword.length > 0 && !passwordsMatch && (
            <p className="text-xs text-destructive">
              Las contraseñas nuevas no coinciden.
            </p>
          )}

          {changeMessage && (
            <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {changeMessage}
            </p>
          )}

          {changeError && (
            <p className="text-sm text-destructive">{changeError}</p>
          )}

          <button
            type="submit"
            disabled={
              changeSubmitting ||
              validationErrors.length > 0 ||
              !passwordsMatch
            }
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {changeSubmitting ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-destructive/40 bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-destructive">
          Eliminar cuenta
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Esta acción elimina tu cuenta y los datos asociados a ella. No se puede deshacer desde EstateForge.
        </p>

        {deleteError && (
          <p className="mt-4 text-sm text-destructive">{deleteError}</p>
        )}

        <button
          type="button"
          onClick={() => {
            setDeleteError(null)
            setDeletePassword('')
            setIsDeleteDialogOpen(true)
          }}
          className="mt-5 h-10 rounded-md border border-destructive/50 px-4 text-sm font-medium text-destructive transition hover:bg-destructive/10"
        >
          Eliminar mi cuenta
        </button>
      </section>

      {isDeleteDialogOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !deleteSubmitting) {
              setIsDeleteDialogOpen(false)
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl"
          >
            <h3 id="delete-account-title" className="text-lg font-semibold">
              ¿Eliminar tu cuenta?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Se eliminarán la cuenta, los inmuebles y los anuncios asociados. Introduce tu contraseña actual para confirmar.
            </p>

            <label htmlFor="delete-account-password" className="mt-5 block text-sm font-medium">
              Contraseña actual
            </label>
            <input
              id="delete-account-password"
              type="password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              disabled={deleteSubmitting}
              autoComplete="current-password"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            />

            {deleteError && (
              <p className="mt-3 text-sm text-destructive">{deleteError}</p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={deleteSubmitting}
                onClick={() => setIsDeleteDialogOpen(false)}
                className="h-10 rounded-md border px-4 text-sm font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleteSubmitting || !deletePassword}
                onClick={() => void handleDeleteAccount()}
                className="h-10 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteSubmitting ? 'Eliminando...' : 'Eliminar cuenta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AccountPage
