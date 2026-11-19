import { Globe } from 'lucide-react'
import { useState } from 'react'

import type { PortalIconAsset } from '@/lib/portalIcons'

// Casilla del icono de un portal en la checklist. El registro y su procedencia están en lib/portalIcons.ts.

const tileClass = 'flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-md border'

/**
 * Casilla de 32×32 o placa de 112×32 para un logotipo textual, con proporción conservada y fondo claro
 * en ambos temas. Si no hay recurso o no carga, el genérico. Siempre decorativa: el nombre visible junto
 * a ella ya identifica el portal, así que no se repite para los lectores de pantalla.
 */
export function PortalIcon({ icon }: { icon: PortalIconAsset | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const wordmark = icon?.presentation === 'wordmark'
  const widthClass = wordmark ? 'w-28' : 'w-8'
  const small = icon?.size === 16
  if (icon && failedSrc !== icon.src) {
    return (
      <span className={`${tileClass} ${widthClass} bg-white`} data-portal-icon="brand">
        <img src={icon.src} alt="" aria-hidden="true" width={wordmark ? 100 : small ? 16 : 24} height={small ? 16 : 24} loading="lazy" decoding="async" className={`${small ? 'h-4 w-4' : wordmark ? 'h-6 w-[100px]' : 'h-6 w-6'} object-contain`} onLoad={() => setFailedSrc(null)} onError={() => setFailedSrc(icon.src)} />
      </span>
    )
  }
  return (
    <span className={`${tileClass} ${widthClass} bg-muted/70 text-muted-foreground`} data-portal-icon="generic">
      <Globe aria-hidden="true" className="h-5 w-5" />
    </span>
  )
}
