import { useEffect, useState } from 'react'
import { Link } from 'react-router'

const COOKIE_NOTICE_KEY = 'estateforge-cookie-notice-seen'

function CookieNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(
      window.localStorage.getItem(COOKIE_NOTICE_KEY) !== 'true',
    )
  }, [])

  if (!visible) {
    return null
  }

  const dismiss = () => {
    window.localStorage.setItem(COOKIE_NOTICE_KEY, 'true')
    setVisible(false)
  }

  return (
    <aside
      aria-label="Información sobre cookies"
      className="fixed inset-x-3 bottom-3 z-100 rounded-xl border bg-card p-4 shadow-lg sm:inset-x-auto sm:right-5 sm:max-w-xl"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Información sobre cookies</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            EstateForge utiliza una cookie técnica necesaria para mantener tu
            sesión. No usamos actualmente cookies de publicidad ni analítica.
          </p>
          <Link
            to="/privacidad"
            className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
          >
            Más información sobre privacidad y cookies
          </Link>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Entendido
        </button>
      </div>
    </aside>
  )
}

export default CookieNotice
