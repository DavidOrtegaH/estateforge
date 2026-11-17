import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ProviderLogo } from '@/components/ai/ProviderLogo'
import { trialSummary } from '@/lib/aiTrials'
import { PROVIDER_LOGOS } from '@/lib/providerLogos'
import type { AiTrial, AiTrialPreset } from '@/services/aiMediaService'

import { AiTrialPresets } from './AiTrialPresets'

// Logotipos de proveedores (DA-91) y las seis pruebas propuestas (DA-93) en la web. Sin llamadas: solo se
// comprueba lo que se pinta.

describe('logotipo del proveedor', () => {
  it('con recurso local: imagen con texto alternativo y dimensiones fijas (sin saltos de maquetación)', () => {
    const html = renderToStaticMarkup(<ProviderLogo providerId="anthropic" name="Anthropic (Claude)" />)
    expect(html).toContain('data-logo-kind="brand"')
    expect(html).toMatch(/<img [^>]*alt="Logotipo de Anthropic \(Claude\)"/)
    expect(html).toMatch(/width="26" height="26"/)
    expect(html).not.toMatch(/src="https?:\/\//)
  })

  it('sin recurso verificable: respaldo neutro con el nombre, sin imitar ninguna marca', () => {
    for (const id of ['openai', 'xai', 'groq', 'runway', 'fal', 'stability', 'ideogram', 'recraft', 'simulador', 'desconocido']) {
      const html = renderToStaticMarkup(<ProviderLogo providerId={id} name={`Proveedor ${id}`} size="sm" />)
      expect(html, id).toContain('data-logo-kind="fallback"')
      expect(html, id).toContain(`aria-label="Proveedor ${id} (sin logotipo verificado)"`)
      expect(html, id).not.toContain('<img')
    }
  })

  it('el registro es único y solo tiene recursos locales de los proveedores verificados', () => {
    expect(Object.keys(PROVIDER_LOGOS).sort()).toEqual(['anthropic', 'bfl', 'deepseek', 'gemini', 'mistral', 'openrouter', 'replicate'])
    expect(Object.values(PROVIDER_LOGOS).every(asset => !/^https?:/.test(asset.src))).toBe(true)
    // El gris de OpenRouter va sobre placa oscura para tener contraste.
    expect(PROVIDER_LOGOS.openrouter.tile).toBe('dark')
  })
})

const base: AiTrialPreset = {
  id: 'video-agregador',
  title: 'Vídeo · agregador',
  kind: 'video',
  provider: 'runway',
  model: 'gemini_omni_flash_1.2',
  capability: 'Vídeo de 4 s a 360p',
  durationSeconds: 4,
  resolution: '360p',
  references: 1,
  notes: 'Siempre genera audio: EstateForge lo descarta.',
  providerName: 'Runway',
  providerKind: 'aggregator',
  billing: 'Tu cuenta de Runway',
  maker: 'Google',
  modelLabel: 'Gemini Omni 1.2 Flash',
  modelStatus: 'unknown',
  available: true,
  unavailableReason: null,
  connections: [],
  moderation: null,
  moderationRequired: true,
  moderationMissing: true,
  cost: { lines: [{ concept: 'Generación (4 s a 360p)', usd: 0.08, detail: '0,02 $ por segundo' }, { concept: 'Imágenes de referencia (1)', usd: 0.01, detail: '0,01 $ por imagen' }, { concept: 'Clasificador de seguridad (Google Gemini, con tu clave)', usd: null, detail: 'no se puede estimar' }], knownUsd: 0.09, complete: false, priceConsultedAt: '2026-11-15', priceAgeDays: 0, priceStale: false },
  lastTrial: null,
}
const render = (presets: AiTrialPreset[]) => renderToStaticMarkup(<AiTrialPresets presets={presets} busy={false} onPrepare={() => {}} />)

describe('las seis pruebas propuestas', () => {
  it('se agrupan por modalidad', () => {
    const html = render([{ ...base, id: 't', kind: 'text', title: 'Texto · API directa' }, { ...base, id: 'i', kind: 'poster', title: 'Imagen · API directa' }, base])
    expect(html.indexOf('Pruebas de texto')).toBeLessThan(html.indexOf('Pruebas de imagen'))
    expect(html.indexOf('Pruebas de imagen')).toBeLessThan(html.indexOf('Pruebas de vídeo'))
  })

  it('sin conexión: pendiente de credenciales, enlace a la tarjeta del proveedor y sin poder preparar', () => {
    const html = render([base])
    expect(html).toContain('data-preset-state="pendiente-credenciales"')
    expect(html).toContain('href="#ai-provider-runway"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="ai-trial-preset-prepare"/)
  })

  it('distingue quien factura del fabricante y muestra el desglose del coste, con lo no estimable', () => {
    const html = render([base])
    expect(html).toContain('Proveedor de la API y factura: <strong class="text-foreground">Runway</strong> (agregador)')
    expect(html).toContain('Fabricante del modelo: Google')
    expect(html).toContain('data-provider-logo="runway"')
    expect(html).toMatch(/Clasificador de seguridad \(Google Gemini, con tu clave\): <strong>no estimable<\/strong>/)
    expect(html).toContain('Total calculable: <strong>0,09')
    expect(html).toContain('más lo no estimable')
  })

  it('con conexión pero sin clasificador: bloqueada; con todo, la cuenta no viene elegida', () => {
    const connections = [{ id: 'c1', label: 'Trabajo', status: 'verified' as const, modelNotListed: false }]
    const noClassifier = render([{ ...base, connections }])
    expect(noClassifier).toContain('data-preset-state="sin-clasificador"')
    expect(noClassifier).toContain('Falta: elige en «Clasificador de seguridad»')
    const ready = render([{ ...base, connections, moderation: { provider: 'gemini', name: 'Google Gemini', external: true }, moderationMissing: false }])
    expect(ready).toContain('data-preset-state="lista"')
    expect(ready).toMatch(/<option value="" selected="">Elige una de tus conexiones de Runway<\/option>/)
    // Sin elegir cuenta, «Preparar» sigue desactivado.
    expect(ready).toMatch(/<button[^>]*disabled=""[^>]*data-testid="ai-trial-preset-prepare"/)
  })

  it('un modelo retirado no se sustituye: se dice y no se puede preparar', () => {
    const html = render([{ ...base, available: false, unavailableReason: 'El modelo ya no está en el catálogo. No se sustituye por otro.' }])
    expect(html).toContain('data-preset-state="no-disponible"')
    expect(html).toContain('No se sustituye por otro')
  })
})

describe('informe de una prueba de texto', () => {
  const trial: AiTrial = { id: 't', connectionId: 'c', provider: 'groq', providerName: 'Groq', model: 'openai/gpt-oss-20b', kind: 'text', status: 'passed', statusLabel: 'Superada', active: false, durationSeconds: null, estimatedCostUsd: null, contractVersion: 'x', moderationProvider: null, failureCode: null, message: null, report: {}, createdAt: '2026-11-15T10:00:00.000Z', submittedAt: null, completedAt: null }
  it('muestra los tokens devueltos por la API y su coste estimado; si no los hay, lo dice', () => {
    expect(trialSummary({ ...trial, report: { output: { structured: true, titleLength: 20, highlights: 3 }, usage: { reported: true, inputTokens: 812, outputTokens: 230, estimatedUsd: 0.000130 } } }).join(' ')).toMatch(/812 de entrada y 230 de salida; coste estimado 0,00013.*no es la factura/)
    expect(trialSummary({ ...trial, report: { usage: { reported: false, note: 'El proveedor no ha devuelto los tokens consumidos.' } } })).toContain('El proveedor no ha devuelto los tokens consumidos.')
  })
})
