import { Cpu } from 'lucide-react'

import { providerLogo } from '@/lib/providerLogos'

// Logotipo del proveedor que recibe la API key y factura (DA-91). Nunca es el único medio de identificación:
// el nombre se muestra siempre al lado. Dimensiones fijas (sin saltos de maquetación) y placa con contraste
// propio, válida en tema claro y oscuro. Sin recurso verificable, un respaldo neutro que no imita ninguna marca.

const SIZES = { sm: { box: 28, icon: 18 }, md: { box: 40, icon: 26 }, lg: { box: 48, icon: 32 } } as const

export function ProviderLogo({ providerId, name, size = 'md' }: { providerId: string; name: string; size?: keyof typeof SIZES }) {
  const asset = providerLogo(providerId)
  const { box, icon } = SIZES[size]
  if (!asset) {
    return (
      <span
        role="img"
        aria-label={`${name} (sin logotipo verificado)`}
        title={name}
        data-provider-logo={providerId}
        data-logo-kind="fallback"
        className="inline-flex shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted text-muted-foreground"
        style={{ width: box, height: box }}
      >
        <Cpu aria-hidden="true" width={Math.round(icon * 0.8)} height={Math.round(icon * 0.8)} />
      </span>
    )
  }
  const width = asset.ratio >= 1 ? icon : Math.round(icon * asset.ratio)
  const height = asset.ratio >= 1 ? Math.round(icon / asset.ratio) : icon
  return (
    <span
      data-provider-logo={providerId}
      data-logo-kind="brand"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border ${asset.tile === 'dark' ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}
      style={{ width: box, height: box }}
    >
      <img src={asset.src} alt={`Logotipo de ${name}`} width={width} height={height} className="block max-h-full max-w-full object-contain" draggable={false} />
    </span>
  )
}
