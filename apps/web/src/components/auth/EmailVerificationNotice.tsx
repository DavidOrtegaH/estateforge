import { useState } from 'react'

import { ResendVerificationForm } from '@/components/auth/ResendVerificationForm'
import { useAuth } from '@/hooks/useAuth'
import { emailVerificationNotice } from '@/lib/emailVerificationNotice'

/** Aviso sobre el contenido para quien tiene sesión sin haber verificado el email (Fase 0). */
export function EmailVerificationNotice() {
  const { user } = useAuth()
  const [showResend, setShowResend] = useState(false)
  const notice = emailVerificationNotice(user)
  if (!user || !notice) return null

  return (
    <div
      role="status"
      className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">{notice.title}</p>
      <p className="mt-1">{notice.detail}</p>
      {showResend ? (
        <div className="mt-3 max-w-sm">
          <ResendVerificationForm email={user.email} submitLabel={`Enviar el enlace a ${user.email}`} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowResend(true)}
          className="mt-2 font-medium underline underline-offset-2"
        >
          Enviarme el enlace de verificación
        </button>
      )}
    </div>
  )
}
