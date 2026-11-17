import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { EMPTY_TEXT_CHOICE, LOCAL_TEMPLATE, type TextAiOption, type TextAiState } from '@/hooks/useTextAi'
import { aiOptions, describeCost, describePricing, TIER_LABELS, type AiConnection, type AiModelInfo, type AiProviderInfo } from '@/services/aiMediaService'

import { TextAiChoice, TextAiNotice, TextProviderOptions } from './TextAi'

// BYOK obligatorio para el texto (DA-77): sin la API key del usuario la IA no se puede elegir, la
// plantilla local sigue disponible y se indica dónde configurar la clave.

const model: AiModelInfo = {
  id: 'gemini-3.6-flash',
  label: 'Gemini 3.6 Flash',
  purpose: 'text',
  stability: 'Estable',
  maxReferenceImages: 0,
  pricing: { usd: 0.75, unit: 'million-tokens', detail: '0,75 $ por millón de tokens de entrada', source: 'https://example.test/precios', consultedAt: '2026-11-11' },
  notes: '',
}

const connection = (id: string, provider: string, label = ''): AiConnection => ({ id, provider, label, keyHint: 'A91F', status: 'verified', lastVerifiedAt: null, lastErrorCode: null, algorithm: 'aes-256-gcm', encryptionVersion: 1, createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z' })
const opt = (id: TextAiOption['id'], label: string, enabled: boolean, defaultModel: AiModelInfo | null, extra: Partial<TextAiOption> = {}): TextAiOption => ({ id, label, enabled, model: defaultModel, models: defaultModel ? [defaultModel] : [], connections: enabled ? [connection(`c-${id}`, id)] : [], provider: null, ...extra })

const noKeys: TextAiState = {
  ready: true,
  preferred: null,
  preference: null,
  options: [LOCAL_TEMPLATE, opt('gemini', 'Google Gemini', false, model), opt('openai', 'OpenAI', false, null)],
}

const withGemini: TextAiState = {
  ready: true,
  preferred: 'gemini',
  preference: null,
  options: [LOCAL_TEMPLATE, opt('gemini', 'Google Gemini', true, model), opt('openai', 'OpenAI', false, null)],
}

const notice = (provider: 'mock' | 'gemini' | 'openai', state: TextAiState, errorCode?: string) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <TextAiNotice provider={provider} state={state} errorCode={errorCode} />
    </MemoryRouter>,
  )

const options = (state: TextAiState) =>
  renderToStaticMarkup(
    <select>
      <TextProviderOptions options={state.options} />
    </select>,
  )

describe('selector de proveedor de texto', () => {
  it('sin claves: la plantilla local está disponible y los proveedores de IA, deshabilitados', () => {
    const html = options(noKeys)
    expect(html).toMatch(/<option value="mock"[^>]*>Plantilla local \(sin IA\)<\/option>/)
    expect(html).not.toMatch(/<option value="mock"[^>]*disabled/)
    expect(html).toMatch(/<option value="gemini" disabled="">Google Gemini — requiere tu API key<\/option>/)
    expect(html).toMatch(/<option value="openai" disabled="">OpenAI — requiere tu API key<\/option>/)
    expect(html).not.toContain('>Mock<')
  })

  it('con clave de Gemini: solo ese proveedor queda habilitado', () => {
    const html = options(withGemini)
    expect(html).toMatch(/<option value="gemini">Google Gemini<\/option>/)
    expect(html).toMatch(/<option value="openai" disabled="">/)
  })
})

describe('aviso bajo el selector', () => {
  it('sin claves: explica que EstateForge no aporta claves, quién factura y enlaza con Ajustes', () => {
    const html = notice('mock', noKeys)
    expect(html).toContain('La plantilla local no usa IA ni consume ninguna API.')
    expect(html).toContain('necesitas tu propia API key')
    expect(html).toContain('EstateForge no aporta claves')
    expect(html).toContain('el proveedor te factura el consumo directamente')
    expect(html).toContain('href="/cuenta"')
  })

  it('con alguna clave y la plantilla local elegida no insiste en configurar', () => {
    const html = notice('mock', withGemini)
    expect(html).toContain('La plantilla local no usa IA')
    expect(html).not.toContain('href="/cuenta"')
  })

  it('con IA elegida: indica que se usa la clave del usuario, el modelo, los datos enviados y el coste', () => {
    const html = notice('gemini', withGemini)
    expect(html).toContain('Se usará tu API key de Google Gemini con el modelo Gemini 3.6 Flash')
    expect(html).toContain('sin tu contacto')
    expect(html).toContain('El proveedor factura el consumo en tu cuenta')
    expect(html).toContain('0,75 $ por millón de tokens de entrada (consultado el 11/11/2026)')
  })

  it('sin precio verificado remite a los precios oficiales, sin inventar una cifra', () => {
    const state: TextAiState = { ...withGemini, options: [LOCAL_TEMPLATE, opt('openai', 'OpenAI', true, { ...model, id: 'gpt-5.5', label: 'GPT-5.5', pricing: null })] }
    const html = notice('openai', state)
    expect(html).toContain('consulta su tarifa oficial')
    expect(html).not.toMatch(/\d+,\d+ \$/)
  })

  it.each(['AI_KEY_REQUIRED', 'AI_KEY_UNREADABLE', 'AI_INVALID_API_KEY'])('tras %s lleva a Ajustes', code => {
    const html = notice('gemini', withGemini, code)
    expect(html).toContain('Revisa la API key de este proveedor')
    expect(html).toContain('href="/cuenta"')
  })

  it('describeCost con precio por tokens no calcula un importe por unidad', () => {
    const text = describeCost(model)
    expect(text).toContain('Precio publicado: 0,75 $ por millón de tokens de entrada')
    expect(text).toContain('Lo factura el proveedor en tu cuenta')
    expect(text).toContain('No se puede calcular un importe por adelantado')
    expect(text).not.toContain('Coste aproximado')
  })
})

describe('auditoría de la web: la clave solo se introduce en Ajustes', () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')

  it.each(['pages/NewPropertyPage.tsx', 'pages/PropertyDetailPage.tsx', 'services/propertyGenerationService.ts', 'services/generationService.ts'])('%s no maneja ninguna API key', path => {
    const source = read(path)
    expect(source).not.toMatch(/apiKey|ApiKey|PasswordInput|Usar mi propia API key/)
  })

  it('la página de cuenta solo tiene la sección de integraciones, sin el antiguo «respaldo» de la clave del servidor', () => {
    const source = read('pages/AccountPage.tsx')
    expect(source).toContain('<AiIntegrationsSection />')
    expect(source).not.toMatch(/respaldo|proporcionada\s+por EstateForge|aiKeyService|handleSaveAIKey/)
  })

  it('las pantallas de generación empiezan en la plantilla local, no en un proveedor de IA', () => {
    for (const path of ['pages/NewPropertyPage.tsx', 'pages/PropertyDetailPage.tsx']) {
      const source = read(path)
      expect(source).toContain("useState<AIProviderType>('mock')")
      expect(source).not.toContain("useState<AIProviderType>('gemini')")
    }
  })

  it('el texto de Ajustes declara el modelo económico', () => {
    const source = read('components/account/AiIntegrationsSection.tsx')
    expect(source).toContain('EstateForge no proporciona claves de IA ni paga el consumo de IA de sus usuarios')
    expect(source).toContain("text: 'Textos con IA'")
  })
})

describe('precios del catálogo (MD-35): la web solo presenta lo que publica la API', () => {
  const pricing = { usd: 1, unit: 'million-tokens' as const, currency: 'USD' as const, status: 'confirmed' as const, tokens: { inputUsd: 1, cachedInputUsd: 0.05, outputUsd: 5 }, context: 'Proceso estándar', detail: '1,00 $ por millón de tokens de entrada, 0,05 $ de entrada en caché y 5,00 $ de salida', source: 'https://developers.openai.com/api/docs/models/gpt-6.1-terra', consultedAt: '2026-11-12' }

  it('describe el precio con su modalidad, su fuente y la fecha de consulta', () => {
    const text = describePricing(pricing)
    expect(text).toContain('1,00 $ por millón de tokens de entrada, 0,05 $ de entrada en caché y 5,00 $ de salida')
    expect(text).toContain('Modalidad: Proceso estándar.')
    expect(text).toContain('Fuente: https://developers.openai.com/api/docs/models/gpt-6.1-terra (consultada el 12/11/2026).')
    expect(text).not.toContain('Precio temporal')
  })

  it('un precio temporal indica hasta cuándo está vigente', () => {
    expect(describePricing({ ...pricing, status: 'temporary', validUntil: '2026-12-31' })).toContain('Precio temporal, vigente hasta el 31/12/2026.')
  })

  it('etiquetas de recomendación y ningún precio escrito en el código de la web', () => {
    expect(TIER_LABELS).toEqual({ recommended: 'Recomendado', alternative: 'Alternativo', legacy: 'Heredado' })
    const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')
    for (const path of ['components/account/AiIntegrationsSection.tsx', 'components/ai/TextAi.tsx', 'hooks/useTextAi.ts', 'services/aiMediaService.ts']) {
      expect(read(path)).not.toMatch(/gpt-[0-9]|gemini-[0-9]|[0-9],[0-9]+ \$/)
    }
  })

  it('la estimación de imagen o vídeo avisa de que no incluye la entrada ni el clasificador', () => {
    const video: AiModelInfo = { ...model, purpose: 'video', pricing: { usd: 0.0695, unit: 'second', detail: 'x', source: 's', consultedAt: '2026-11-12' } }
    const text = describeCost(video, 6)
    expect(text).toContain('Coste aproximado')
    expect(text).toContain('no incluye los tokens de entrada ni el clasificador de seguridad')
    expect(text).toContain('El importe definitivo lo factura el proveedor')
  })
})

describe('catálogo amplio (DA-82): elección de modelo y cuenta para una generación', () => {
  const haiku: AiModelInfo = { ...model, id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', maker: 'Anthropic', tier: 'alternative', pricing: { usd: 0.1, unit: 'million-tokens', detail: '0,10 $ por millón de tokens de entrada', source: 'https://example.test/a', consultedAt: '2026-11-12', context: 'Proceso estándar' } }
  const sonnet: AiModelInfo = { ...haiku, id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'recommended' }
  const anthropic: AiProviderInfo = { id: 'anthropic', name: 'Anthropic (Claude)', kind: 'direct', billing: 'Tu cuenta de la consola de Anthropic', simulated: false, description: '', keyHelp: '', capabilities: ['text'], models: [sonnet, haiku], moderation: '', links: { docs: '', pricing: '', terms: '', privacy: '', keys: '' }, dataUse: '', verification: '' }
  const state = (connections: AiConnection[]): TextAiState => ({ ready: true, preferred: 'anthropic', preference: null, options: [LOCAL_TEMPLATE, opt('anthropic', 'Anthropic (Claude)', true, sonnet, { models: [sonnet, haiku], connections, provider: anthropic })] })
  const choice = (s: TextAiState, value = EMPTY_TEXT_CHOICE, provider: 'mock' | 'anthropic' = 'anthropic') => renderToStaticMarkup(<TextAiChoice provider={provider} state={s} value={value} onChange={() => {}} />)

  it('con la plantilla local o sin clave no aparece: no hay nada que confirmar', () => {
    expect(choice(state([connection('c1', 'anthropic')]), EMPTY_TEXT_CHOICE, 'mock')).toBe('')
    expect(renderToStaticMarkup(<TextAiChoice provider="openai" state={noKeys} value={EMPTY_TEXT_CHOICE} onChange={() => {}} />)).toBe('')
  })

  it('una cuenta: modelos del proveedor, coste con su fuente, a quién se factura y confirmación sin marcar', () => {
    const html = choice(state([connection('c1', 'anthropic')]))
    expect(html).toContain('data-testid="text-ai-model"')
    // La recomendación va fuera de la opción (DA-90): el texto de la opción no se recorta en móvil.
    expect(html).toMatch(/<option value="claude-sonnet-5-5" selected="">Claude Sonnet 5.5<\/option>/)
    expect(html).toContain('Recomendado por EstateForge')
    expect(html).toContain('<option value="claude-haiku-5-5">Claude Haiku 5.5</option>')
    expect(html).not.toContain('data-testid="text-ai-connection"')
    expect(html).toContain('Factura: Tu cuenta de la consola de Anthropic.')
    expect(html).toContain('Fuente: https://example.test/a (consultada el 12/11/2026).')
    expect(html).toMatch(/<input type="checkbox"[^>]*data-testid="text-ai-consent"/)
    expect(html).not.toMatch(/<input type="checkbox" checked=""/)
    expect(html).toContain('Acepto enviar los datos del inmueble a Anthropic (Claude)')
  })

  it('varias cuentas del mismo proveedor: se puede elegir cuál; por defecto, la principal', () => {
    const html = choice(state([connection('c1', 'anthropic'), connection('c2', 'anthropic', 'Profesional')]))
    expect(html).toContain('data-testid="text-ai-connection"')
    expect(html).toMatch(/<option value="c1" selected="">Conexión principal<\/option>/)
    expect(html).toContain('<option value="c2">Profesional</option>')
    const chosen = choice(state([connection('c1', 'anthropic'), connection('c2', 'anthropic', 'Profesional')]), { model: 'claude-haiku-5-5', connectionId: 'c2', consent: true })
    expect(chosen).toMatch(/<option value="c2" selected="">Profesional<\/option>/)
    expect(chosen).toMatch(/<option value="claude-haiku-5-5" selected="">/)
    expect(chosen).toMatch(/<input type="checkbox"[^>]*checked=""/)
    // Sin principal ni preferencia: se pide elegir.
    expect(choice(state([connection('c2', 'anthropic', 'a'), connection('c3', 'anthropic', 'b')]))).toContain('Elige una conexión')
  })

  it('el aviso usa el modelo elegido para esta generación', () => {
    const s = state([connection('c1', 'anthropic')])
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TextAiNotice provider="anthropic" state={s} value={{ model: 'claude-haiku-5-5', connectionId: null, consent: false }} />
      </MemoryRouter>,
    )
    expect(html).toContain('con el modelo Claude Haiku 5.5')
  })

  it('agregador: se indica el fabricante y que la API y la factura son del agregador', () => {
    const viaRouter: AiModelInfo = { ...sonnet, id: '~anthropic/claude-sonnet-latest', label: 'Claude Sonnet', maker: 'Anthropic', pricing: null }
    const router: AiProviderInfo = { ...anthropic, id: 'openrouter', name: 'OpenRouter', kind: 'aggregator', billing: 'Tu cuenta de OpenRouter', models: [viaRouter] }
    const s: TextAiState = { ready: true, preferred: 'openrouter', preference: null, options: [LOCAL_TEMPLATE, opt('openrouter', 'OpenRouter', true, viaRouter, { provider: router })] }
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TextAiNotice provider="openrouter" state={s} />
      </MemoryRouter>,
    )
    expect(html).toContain('fabricante: Anthropic; la API y la factura son de OpenRouter')
    expect(html).toContain('consulta su tarifa oficial')
    expect(renderToStaticMarkup(<TextAiChoice provider="openrouter" state={s} value={EMPTY_TEXT_CHOICE} onChange={() => {}} />)).toContain('Consultar tarifa del proveedor')
  })
})

describe('selectores por uso: solo modelos que generan ese contenido y cuentas conectadas', () => {
  const m = (id: string, purpose: AiModelInfo['purpose'], outputs: AiModelInfo['outputs'], extra: Partial<AiModelInfo> = {}): AiModelInfo => ({ id, label: id, purpose, outputs, stability: '', maxReferenceImages: 0, pricing: null, notes: '', ...extra })
  const provider = (id: string, kind: AiProviderInfo['kind'], models: AiModelInfo[]): AiProviderInfo => ({ id, name: id.toUpperCase(), kind, simulated: false, description: '', keyHelp: '', capabilities: [], models, moderation: '', links: { docs: '', pricing: '', terms: '', privacy: '', keys: '' }, dataUse: '', verification: '' })
  const providers = [
    provider('xai', 'direct', [m('grok-texto', 'text', ['text']), m('grok-imagen', 'poster', ['image'], { tier: 'recommended' }), m('grok-video', 'video', ['video']), m('retirado', 'poster', ['image'], { selectable: false })]),
    // Un modelo de texto que admite imágenes de entrada no es un generador de imágenes.
    provider('anthropic', 'direct', [m('claude', 'text', ['text'], { inputs: ['text', 'image'] }), m('mal-clasificado', 'poster', ['text'])]),
    provider('runway', 'aggregator', [m('kling', 'video', ['video'], { maker: 'Kling' })]),
    provider('sin-clave', 'direct', [m('otro', 'poster', ['image'])]),
  ]
  const connections = [connection('x1', 'xai'), connection('x2', 'xai', 'Trabajo'), connection('a1', 'anthropic'), connection('r1', 'runway')]

  it('carteles: solo modelos que generan imagen, elegibles y de proveedores conectados; una opción por cuenta', () => {
    const options = aiOptions(providers, connections, 'poster')
    expect(options.map(option => option.value)).toEqual(['xai|grok-imagen|x1', 'xai|grok-imagen|x2'])
    expect(options[0].label).toBe('grok-imagen · XAI · principal — recomendado')
    expect(options[1].label).toBe('grok-imagen · XAI · Trabajo — recomendado')
  })

  it('vídeo y texto: cada lista con lo suyo; el agregador muestra el fabricante', () => {
    expect(aiOptions(providers, connections, 'video').map(option => option.label)).toEqual(['grok-video · XAI · principal', 'grok-video · XAI · Trabajo', 'kling · Kling vía RUNWAY'])
    expect(aiOptions(providers, connections, 'text').map(option => option.value)).toEqual(['xai|grok-texto|x1', 'xai|grok-texto|x2', 'anthropic|claude|a1'])
    expect(aiOptions(providers, [], 'text')).toEqual([])
  })
})
