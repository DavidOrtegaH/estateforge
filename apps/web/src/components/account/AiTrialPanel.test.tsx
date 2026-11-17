import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AiConnection, AiProviderInfo, AiTrial, AiTrialPlan } from '@/services/aiMediaService'

import { trialSummary } from '@/lib/aiTrials'

import { AiTrialPanel } from './AiTrialPanel'

// Pruebas reales controladas (DA-89) y comprobación de conexiones (DA-87) en la web. Ninguna prueba llama a un
// proveedor: fetch está sustituido y solo se comprueba lo que el navegador envía a la API de EstateForge.

const provider: AiProviderInfo = {
  id: 'recraft',
  name: 'Recraft',
  kind: 'direct',
  billing: 'Tu cuenta de Recraft',
  verificationCost: 'unknown',
  simulated: false,
  description: '',
  keyHelp: '',
  capabilities: ['image'],
  models: [{ id: 'recraftv4_1', label: 'Recraft V4.1', maker: 'Recraft', purpose: 'poster', outputs: ['image'], stability: '', maxReferenceImages: 0, pricing: null, notes: '', tier: 'recommended' }],
  moderation: '',
  links: { docs: '', pricing: '', terms: '', privacy: '', keys: '' },
  dataUse: '',
  verification: '',
}
const connection: AiConnection = { id: 'c1', provider: 'recraft', label: '', keyHint: 'A91F', status: 'verified', lastVerifiedAt: null, lastErrorCode: null, algorithm: 'aes-256-gcm', encryptionVersion: 1, createdAt: '2026-11-16T00:00:00.000Z', updatedAt: '2026-11-16T00:00:00.000Z' }

const trial = (overrides: Partial<AiTrial>): AiTrial => ({
  id: 't1',
  connectionId: 'c1',
  provider: 'recraft',
  providerName: 'Recraft',
  model: 'recraftv4_1',
  kind: 'poster',
  status: 'passed',
  statusLabel: 'Superada',
  active: false,
  durationSeconds: null,
  estimatedCostUsd: null,
  contractVersion: '2026-11-16.1',
  moderationProvider: 'simulador',
  failureCode: null,
  message: null,
  report: {},
  createdAt: '2026-11-16T10:00:00.000Z',
  submittedAt: null,
  completedAt: null,
  ...overrides,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('panel de pruebas reales controladas', () => {
  it('sin conexiones no ofrece nada que ejecutar ni pide claves', () => {
    const html = renderToStaticMarkup(<AiTrialPanel providers={[provider]} connections={[]} />)
    expect(html).toContain('data-testid="ai-trial-empty"')
    expect(html).not.toContain('data-testid="ai-trial-run"')
    expect(html).not.toMatch(/type="password"/)
  })

  it('con conexiones: se elige conexión, tipo y modelo; no hay botón de ejecutar hasta revisar el plan', () => {
    const html = renderToStaticMarkup(<AiTrialPanel providers={[provider]} connections={[connection]} />)
    expect(html).toContain('data-testid="ai-trial-connection"')
    expect(html).toContain('Recraft · principal')
    expect(html).toContain('data-testid="ai-trial-prepare"')
    expect(html).not.toContain('data-testid="ai-trial-run"')
    expect(html).toContain('una sola')
    expect(html).toMatch(/inmueble ficticio e imágenes sintéticas/)
  })

  it('resumen del informe: imagen válida, moderación y que no se ha guardado nada', () => {
    const lines = trialSummary(trial({ report: { output: { valid: true, mimeType: 'image/png', width: 928, height: 1152, bytes: 204800, resultHost: 'img.recraft.ai' }, inputModeration: 'passed', outputModeration: 'passed' } }))
    expect(lines).toEqual([
      'Resultado válido: image/png, 928×1152 px, 200 KB, entregado desde img.recraft.ai.',
      'Moderación de la entrada: superada.',
      'Moderación del resultado: superada.',
      'El resultado no se ha guardado ni sustituye ningún material.',
    ])
  })

  it('resumen del informe: vídeo con su duración y códec; texto con su estructura', () => {
    expect(trialSummary(trial({ kind: 'video', report: { output: { valid: true, mimeType: 'video/mp4', durationMs: 4100, videoCodec: 'avc1', hasAudio: true, bytes: 1024 * 900 } } }))[0]).toBe('Resultado válido: video/mp4, 4.1 s, códec avc1 (el audio del modelo se descartaría), 900 KB.')
    expect(trialSummary(trial({ kind: 'text', report: { output: { structured: true, titleLength: 42, highlights: 4 }, durationMs: 2300 } }))).toEqual([
      'Respuesta estructurada válida: título de 42 caracteres, 4 destacados.',
      'Tiempo de respuesta: 2.3 s.',
      'El resultado no se ha guardado ni sustituye ningún material.',
    ])
    // Un estado incierto no dice que se haya validado nada.
    expect(trialSummary(trial({ status: 'uncertain', report: {} }))).toEqual([])
  })
})

describe('servicio: comprobación y pruebas reales', () => {
  it('la comprobación solo envía acknowledgeCost cuando el usuario lo ha aceptado', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify({ status: 'verified' }), { status: 200 }))))
    const { verifyAiConnection } = await import('@/services/aiMediaService')
    await verifyAiConnection('c1')
    await verifyAiConnection('c1', true)
    expect(calls[0].init.body).toBeUndefined()
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ acknowledgeCost: true })
  })

  it('la prueba se confirma con exactamente el proveedor, el modelo, la conexión y el coste del plan', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify({ trial: trial({}) }), { status: 201 }))))
    const { createAiTrial } = await import('@/services/aiMediaService')
    const plan = { provider: { id: 'recraft', name: 'Recraft', kind: 'direct', billing: '' }, model: { id: 'recraftv4_1', label: '', maker: 'Recraft', status: 'unknown' }, connection: { id: 'c1', label: '', status: 'verified' }, estimatedCostMicroUsd: 40000 } as unknown as AiTrialPlan
    await createAiTrial({ connectionId: 'c1', kind: 'poster', model: 'recraftv4_1' }, plan, 'clave-idempotencia-0001')
    expect(calls[0].url).toMatch(/\/api\/account\/ai-trials$/)
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      connectionId: 'c1',
      kind: 'poster',
      model: 'recraftv4_1',
      idempotencyKey: 'clave-idempotencia-0001',
      confirmation: { provider: 'recraft', model: 'recraftv4_1', connectionId: 'c1', estimatedCostMicroUsd: 40000, acceptCharges: true },
    })
  })

  it('el sondeo de una prueba se detiene en cuanto deja de estar en curso', async () => {
    const statuses = [true, true, false]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ trial: trial({ active: statuses.shift()! }) }), { status: 200 })))
    const { pollAiTrial } = await import('@/services/aiMediaService')
    const waits: number[] = []
    const result = await pollAiTrial('t1', () => {}, new AbortController().signal, async ms => void waits.push(ms))
    expect(result.active).toBe(false)
    expect(waits).toEqual([3000, 3000])
  })
})
