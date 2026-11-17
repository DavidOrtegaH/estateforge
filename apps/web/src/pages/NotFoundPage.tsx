import { useEffect } from 'react'
import { Link } from 'react-router'

import { APP_HOME } from '@/lib/routes'

// Ruta de la aplicación que no existe (por ejemplo, /inmuebles/1/otra). Las rutas ajenas a la
// aplicación no llegan aquí: el servidor responde con la página 404 estática.
function NotFoundPage() {
  useEffect(() => {
    document.title = 'Página no encontrada - EstateForge'
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-muted-foreground">Error 404</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Esta página no existe</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Puede que el enlace esté mal escrito o que el contenido ya no esté disponible.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to={APP_HOME}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Ir al panel
          </Link>
          <a href="/" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
            Página principal
          </a>
        </div>
      </div>
    </main>
  )
}

export default NotFoundPage
