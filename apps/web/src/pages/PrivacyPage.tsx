import { useEffect } from 'react'
import { Link } from 'react-router'

function PrivacyPage() {
  useEffect(() => {
    document.title = 'Privacidad y cookies - EstateForge'
  }, [])

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <Link
            to="/login"
            className="text-sm font-medium text-primary hover:underline"
          >
            ← Volver al acceso
          </Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">
            Privacidad y cookies
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Información sobre el almacenamiento técnico utilizado actualmente
            por EstateForge.
          </p>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Cookies utilizadas</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Actualmente EstateForge utiliza una cookie técnica necesaria para
              mantener la sesión iniciada de los usuarios autenticados.
            </p>

            <div className="mt-5 overflow-hidden rounded-lg border">
              <div className="grid gap-3 border-b bg-muted/40 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Nombre
                  </p>
                  <p className="mt-1 font-mono text-sm">
                    estateforge_session
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Finalidad
                  </p>
                  <p className="mt-1 text-sm">Autenticación y sesión.</p>
                </div>
              </div>

              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tipo
                  </p>
                  <p className="mt-1 text-sm">Técnica / necesaria.</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Duración
                  </p>
                  <p className="mt-1 text-sm">Hasta 7 días como máximo.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Medidas técnicas</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <li>
                La cookie de sesión se marca como <strong>HttpOnly</strong>, de
                forma que JavaScript del navegador no puede leer directamente
                su valor.
              </li>
              <li>
                Se utiliza <strong>SameSite=Lax</strong> para limitar el envío
                de la cookie en solicitudes entre sitios.
              </li>
              <li>
                En entornos de producción se añade el atributo{' '}
                <strong>Secure</strong>, por lo que la cookie solo se transmite
                mediante HTTPS.
              </li>
              <li>
                EstateForge no utiliza actualmente cookies de publicidad,
                seguimiento comercial ni analítica de terceros.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Almacenamiento local</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              La aplicación también puede utilizar el almacenamiento local del
              navegador para recordar preferencias de interfaz, como el modo
              claro u oscuro. Esto es distinto de una cookie y no contiene la
              sesión de autenticación.
            </p>
          </section>

          <section className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold">
              Cambios futuros
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Si EstateForge incorpora en el futuro cookies o tecnologías de
              almacenamiento que no sean necesarias para prestar el servicio,
              esta información deberá actualizarse y deberá implantarse el
              mecanismo de información y consentimiento que corresponda antes
              de activarlas.
            </p>
          </section>
        </div>

        <p className="mt-8 text-xs leading-5 text-muted-foreground">
          Esta página describe el comportamiento técnico actual de la
          aplicación. Los textos y mecanismos jurídicos definitivos deberán
          revisarse antes de una puesta en producción real.
        </p>
      </div>
    </main>
  )
}

export default PrivacyPage
