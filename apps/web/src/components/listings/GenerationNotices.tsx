import { Info } from 'lucide-react'

import { FREE_TEXT_NOT_INCLUDED, type GenerationNotice } from '@estateforge/shared'

// Avisos de la API sobre el contenido generado. Hoy solo uno: la plantilla local inglesa no traduce ni
// copia las observaciones del inmueble (texto libre del usuario), así que se indica al usuario que puede
// añadir su versión inglesa editando el anuncio. No se promete ninguna traducción automática.

const MESSAGES: Record<GenerationNotice, string> = {
  [FREE_TEXT_NOT_INCLUDED]:
    'Las observaciones del inmueble no se han incluido en el anuncio en inglés: son un texto que escribiste tú y la plantilla local no traduce. Si quieres que aparezcan, edita el anuncio y añade su versión en inglés. El título y el resto del contenido se han redactado en inglés a partir de los datos del inmueble.',
}

export function GenerationNotices({ notices }: { notices: readonly string[] | null | undefined }) {
  const known = (notices ?? []).filter((code): code is GenerationNotice => code in MESSAGES)
  if (known.length === 0) return null
  return (
    <div role="status" className="mt-4 space-y-2" data-generation-notices>
      {known.map(code => (
        <p key={code} className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{MESSAGES[code]}</span>
        </p>
      ))}
    </div>
  )
}
