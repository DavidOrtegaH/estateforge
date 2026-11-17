// Enlaces a las páginas públicas estáticas (fuera de la SPA, por eso son <a> y no <Link>).
function LegalLinks() {
  return (
    <nav aria-label="Información legal" className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <a href="/" className="hover:underline">
        Inicio
      </a>
      <a href="/privacidad" className="hover:underline">
        Privacidad y cookies
      </a>
      <a href="/condiciones" className="hover:underline">
        Condiciones de uso
      </a>
    </nav>
  )
}

export default LegalLinks
