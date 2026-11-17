import anthropic from '@/assets/providers/anthropic.svg'
import bfl from '@/assets/providers/bfl.svg'
import deepseek from '@/assets/providers/deepseek.svg'
import gemini from '@/assets/providers/gemini.svg'
import mistral from '@/assets/providers/mistral.svg'
import openrouter from '@/assets/providers/openrouter.svg'
import replicate from '@/assets/providers/replicate.svg'

// Registro único de logotipos de proveedores (DA-91). La clave es el identificador estable del proveedor en
// el catálogo de la API (el que recibe la API key y factura), nunca el fabricante del modelo. Los archivos son
// locales: ninguna tarjeta depende de una imagen externa. Procedencia y licencia de cada uno en
// docs/proveedores-ia.md («Logotipos»). Un proveedor sin recurso verificable no tiene entrada: el componente
// muestra un respaldo neutro y su nombre, sin inventar una identidad gráfica.

export interface ProviderLogoAsset {
  src: string
  /** Fondo de la placa que da contraste suficiente al color de marca, en tema claro y oscuro. */
  tile: 'light' | 'dark'
  /** Proporción ancho/alto del recurso (para fijar sus dimensiones y evitar saltos de maquetación). */
  ratio: number
  source: string
}

const SIMPLE_ICONS = 'Simple Icons 16.36.0 (CC0)'

export const PROVIDER_LOGOS: Readonly<Record<string, ProviderLogoAsset>> = {
  gemini: { src: gemini, tile: 'light', ratio: 1, source: SIMPLE_ICONS },
  anthropic: { src: anthropic, tile: 'light', ratio: 1, source: SIMPLE_ICONS },
  deepseek: { src: deepseek, tile: 'light', ratio: 1, source: SIMPLE_ICONS },
  mistral: { src: mistral, tile: 'light', ratio: 1, source: SIMPLE_ICONS },
  // El gris de marca de OpenRouter no llega al contraste 3:1 sobre blanco: va sobre una placa oscura.
  openrouter: { src: openrouter, tile: 'dark', ratio: 1, source: SIMPLE_ICONS },
  replicate: { src: replicate, tile: 'light', ratio: 1, source: SIMPLE_ICONS },
  bfl: { src: bfl, tile: 'light', ratio: 196 / 140, source: 'Kit de marca oficial de Black Forest Labs (bfl.ai/brand), sin modificar' },
}

export function providerLogo(providerId: string): ProviderLogoAsset | null {
  return PROVIDER_LOGOS[providerId] ?? null
}
