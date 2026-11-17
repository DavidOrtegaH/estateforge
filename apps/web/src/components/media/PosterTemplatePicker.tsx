import { Dices, Sparkles } from 'lucide-react'
import { Link } from 'react-router'

import { AI_POSTER_TEMPLATE_ID, POSTER_TEMPLATES, type PosterTemplateId } from '@estateforge/shared'

import { drawPosterPreview } from '@/lib/posterRenderer'
import type { PromoContent } from '@/lib/promoContent'

// Selector de plantilla del cartel (DA-52). Cada miniatura es una vista previa real: la plantilla
// dibujada con los datos de este anuncio y sus fotografías, a escala. «Aleatoria» no es una plantilla:
// es un modo en el que la API sortea una entre las seis. «Generación con IA» (DA-72) es otra opción,
// diferenciada y que solo se usa si se elige expresamente: nunca entra en el sorteo.
//
// Maquetación (DA-76): un <fieldset> tiene min-inline-size: min-content por defecto y cada <canvas>
// aporta su ancho intrínseco (216 px) al mínimo de su columna; juntos ensanchaban la rejilla por encima
// de su contenedor y las tarjetas y sus descripciones se salían. Ahora todo tiene min-width: 0, las
// columnas se adaptan al ancho disponible y el texto se parte y hace crecer la tarjeta (nunca se oculta).

export type TemplateChoice = PosterTemplateId | 'random' | typeof AI_POSTER_TEMPLATE_ID

export interface AiPosterOption {
  available: boolean
  /** Por qué no está disponible (sin proveedor o sin clave). */
  reason: string | null
  provider: string | null
  model: string | null
}

const CARD = 'flex h-full min-w-0 cursor-pointer flex-col gap-2 rounded-md border p-2 text-sm'
const DESCRIPTION = 'block min-w-0 text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere] hyphens-auto'

function Preview({ content, images, templateId, width, label }: { content: PromoContent | null; images: ImageBitmap[]; templateId: PosterTemplateId; width: number; label: string }) {
  // Ref de función: dibuja al montar y cada vez que cambian los datos, sin estado propio.
  const draw = (canvas: HTMLCanvasElement | null) => {
    if (canvas && content && images.length) drawPosterPreview(canvas, content, images, templateId)
  }
  return <canvas ref={draw} width={width} height={Math.round(width * 1.25)} className="block h-auto w-full min-w-0 max-w-full rounded border bg-muted" role="img" aria-label={label} />
}

export function PosterTemplatePicker({
  value,
  onChange,
  content,
  images,
  loading,
  disabled,
  ai,
}: {
  value: TemplateChoice
  onChange: (value: TemplateChoice) => void
  content: PromoContent | null
  images: ImageBitmap[]
  loading: boolean
  disabled?: boolean
  ai?: AiPosterOption
}) {
  const selected = value === 'random' || value === AI_POSTER_TEMPLATE_ID ? null : POSTER_TEMPLATES.find(template => template.id === value)
  return (
    <fieldset className="min-w-0 space-y-3" disabled={disabled} data-testid="poster-template-picker" lang="es">
      <legend className="text-sm font-semibold">Diseño del cartel</legend>
      {loading && <p className="text-sm text-muted-foreground">Preparando las vistas previas…</p>}
      <ul className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] gap-3">
        <li className="min-w-0">
          <label className={`${CARD} ${value === 'random' ? 'border-primary ring-2 ring-primary/40' : ''}`} data-template="random">
            <input type="radio" name="poster-template" className="sr-only" checked={value === 'random'} onChange={() => onChange('random')} />
            <span className="flex aspect-[4/5] items-center justify-center rounded border border-dashed bg-muted">
              <Dices className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="font-medium [overflow-wrap:anywhere]">Aleatoria</span>
            <span className={DESCRIPTION}>Elegir una variante al azar entre las {POSTER_TEMPLATES.length} plantillas (nunca la de IA).</span>
          </label>
        </li>
        {POSTER_TEMPLATES.map(template => (
          <li key={template.id} className="min-w-0">
            <label className={`${CARD} ${value === template.id ? 'border-primary ring-2 ring-primary/40' : ''}`} data-template={template.id}>
              <input type="radio" name="poster-template" className="sr-only" checked={value === template.id} onChange={() => onChange(template.id)} />
              <Preview content={content} images={images} templateId={template.id} width={216} label={`Vista previa de la plantilla ${template.name}`} />
              <span className="font-medium [overflow-wrap:anywhere]">{template.name}</span>
              <span className={DESCRIPTION}>{template.description}</span>
            </label>
          </li>
        ))}
        {ai && (
          <li className="min-w-0">
            {ai.available ? (
              <label className={`${CARD} border-violet-400 bg-violet-50/60 dark:bg-violet-950/30 ${value === AI_POSTER_TEMPLATE_ID ? 'ring-2 ring-violet-500/60' : ''}`} data-template="ai">
                <input type="radio" name="poster-template" className="sr-only" checked={value === AI_POSTER_TEMPLATE_ID} onChange={() => onChange(AI_POSTER_TEMPLATE_ID)} />
                <span className="flex aspect-[4/5] items-center justify-center rounded border border-dashed border-violet-400 bg-gradient-to-br from-violet-200 via-fuchsia-100 to-sky-200 dark:from-violet-900 dark:to-sky-900">
                  <Sparkles className="h-10 w-10 text-violet-700 dark:text-violet-200" aria-hidden="true" />
                </span>
                <span className="font-medium [overflow-wrap:anywhere]">Generación con IA</span>
                <span className={DESCRIPTION}>
                  Fondo diseñado por IA con tu proveedor ({ai.provider}); los datos y las fotografías son los reales del anuncio. Revisas la propuesta antes de usarla. Puede tener coste en tu cuenta.
                </span>
              </label>
            ) : (
              <div className={`${CARD} cursor-default border-dashed opacity-80`} data-template="ai" aria-disabled="true">
                <span className="flex aspect-[4/5] items-center justify-center rounded border border-dashed bg-muted">
                  <Sparkles className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
                </span>
                <span className="font-medium [overflow-wrap:anywhere]">Generación con IA (no disponible)</span>
                <span className={DESCRIPTION}>
                  {ai.reason ?? 'Configura un proveedor de IA para carteles.'}{' '}
                  <Link to="/cuenta" className="underline">
                    Ir a Ajustes
                  </Link>
                </span>
              </div>
            )}
          </li>
        )}
      </ul>
      {selected && content && images.length > 0 && (
        <details className="rounded-md border p-3" data-testid="poster-large-preview">
          <summary className="cursor-pointer text-sm font-medium">Ver la vista previa de «{selected.name}» más grande</summary>
          <div className="mx-auto mt-3 max-w-sm">
            <Preview content={content} images={images} templateId={selected.id} width={540} label={`Vista previa ampliada de ${selected.name}`} />
          </div>
        </details>
      )}
    </fieldset>
  )
}
