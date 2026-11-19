import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// BYOK obligatorio para el texto (DA-77). Sustituye a las pruebas del antiguo respaldo
// (generation-key-fallback.test.ts): ya no existe clave del servidor ni respaldo de ningún tipo.

const mocks = vi.hoisted(() => ({
  createAIProvider: vi.fn(),
  requireUserAIKey: vi.fn(),
  preferenceFindUnique: vi.fn(),
  discover: vi.fn(),
  connectionArgs: [] as { connectionId: string | null; preferredId: string | null }[],
}))

vi.mock('../ai/ai-provider.factory.js', () => ({ createAIProvider: mocks.createAIProvider }))
vi.mock('../db/prisma.js', () => ({ prisma: { aiMediaPreference: { findUnique: mocks.preferenceFindUnique } } }))
vi.mock('./user-ai-key.service.js', () => {
  class CredentialCryptoError extends Error {}
  class ConnectionError extends Error {}
  return {
    CredentialCryptoError,
    ConnectionError,
    isStoredAIKeyProvider: (provider: string) => ['gemini', 'openai', 'anthropic', 'xai', 'mistral', 'deepseek', 'openrouter', 'groq', 'simulador'].includes(provider),
    // La conexión se resuelve siempre para el usuario autenticado; aquí se simula con su clave.
    resolveConnection: async (userId: string, provider: string, connectionId?: string | null, preferredId?: string | null) => {
      mocks.connectionArgs.push({ connectionId: connectionId ?? null, preferredId: preferredId ?? null })
      const key = await mocks.requireUserAIKey(userId, provider)
      return key ? { id: connectionId ?? preferredId ?? 'conn-1', label: '', apiKey: key } : null
    },
  }
})
vi.mock('../ai/text/openrouter-discovery.js', () => ({ discoverOpenRouterModels: mocks.discover }))

import { AIProviderError } from '../ai/ai-provider.error.js'
import { generateWithUserKey } from './generation.service.js'
import { CredentialCryptoError } from './user-ai-key.service.js'

const listing = { title: 'Piso', description: 'Texto', highlights: [], callToAction: 'Visítalo' }
const USER_KEY = 'AIzaSyFAKE-not-a-real-key-0123456789abcd'

describe('generación de texto: solo con la API key del usuario (DA-77)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.connectionArgs.length = 0
    mocks.discover.mockResolvedValue([])
    mocks.preferenceFindUnique.mockResolvedValue(null)
    mocks.createAIProvider.mockReturnValue({ generate: vi.fn().mockResolvedValue(listing) })
    // Claves globales antiguas presentes en el entorno: deben ignorarse por completo.
    process.env.GEMINI_API_KEY = 'clave-global-antigua-gemini'
    process.env.OPENAI_API_KEY = 'clave-global-antigua-openai'
  })

  it('la plantilla local «mock» no usa clave ni consulta credenciales', async () => {
    await expect(generateWithUserKey('mock', 'p', 'user-1')).resolves.toEqual(listing)
    expect(mocks.requireUserAIKey).not.toHaveBeenCalled()
    // Sin credencial (segundo argumento): la plantilla local solo recibe el idioma del anuncio.
    expect(mocks.createAIProvider).toHaveBeenCalledWith('mock', undefined, { language: undefined })
  })

  it.each(['gemini', 'openai'] as const)('%s sin clave del usuario: error controlado, ninguna llamada y ninguna clave global', async provider => {
    mocks.requireUserAIKey.mockResolvedValue(null)
    await expect(generateWithUserKey(provider, 'p', 'user-1')).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' })
    expect(mocks.requireUserAIKey).toHaveBeenCalledWith('user-1', provider)
    expect(mocks.createAIProvider).not.toHaveBeenCalled()
  })

  it('con clave: se usa exclusivamente la del usuario autenticado y el modelo del catálogo', async () => {
    mocks.requireUserAIKey.mockResolvedValue(USER_KEY)
    await expect(generateWithUserKey('gemini', 'p', 'user-7')).resolves.toEqual(listing)
    expect(mocks.requireUserAIKey).toHaveBeenCalledWith('user-7', 'gemini')
    expect(mocks.createAIProvider).toHaveBeenCalledTimes(1)
    expect(mocks.createAIProvider).toHaveBeenCalledWith('gemini', { apiKey: USER_KEY, model: 'gemini-3.6-flash' })
    expect(JSON.stringify(mocks.createAIProvider.mock.calls)).not.toContain('clave-global-antigua')
  })

  it('modelo: el de la preferencia del usuario si es del proveedor y del catálogo; si ya no está en el catálogo se informa y no se sustituye', async () => {
    mocks.requireUserAIKey.mockResolvedValue(USER_KEY)
    mocks.preferenceFindUnique.mockResolvedValue({ textProvider: 'gemini', textModel: 'gemini-3.5-flash-lite' })
    await generateWithUserKey('gemini', 'p', 'user-1')
    expect(mocks.createAIProvider).toHaveBeenLastCalledWith('gemini', { apiKey: USER_KEY, model: 'gemini-3.5-flash-lite' })
    // Modelo guardado que ya no existe (retirado del catálogo): error claro, sin llamada y sin otro modelo.
    mocks.createAIProvider.mockClear()
    mocks.preferenceFindUnique.mockResolvedValue({ textProvider: 'gemini', textModel: 'modelo-retirado' })
    await expect(generateWithUserKey('gemini', 'p', 'user-1')).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED', message: expect.stringContaining('ya no está disponible') })
    expect(mocks.createAIProvider).not.toHaveBeenCalled()
    // La preferencia de otro proveedor no se aplica.
    mocks.preferenceFindUnique.mockResolvedValue({ textProvider: 'gemini', textModel: 'gemini-3.5-flash-lite' })
    await generateWithUserKey('openai', 'p', 'user-1')
    expect(mocks.createAIProvider).toHaveBeenLastCalledWith('openai', { apiKey: USER_KEY, model: 'gpt-6.1-terra' })
    // Cada modelo de OpenAI del catálogo se puede elegir, también el heredado.
    for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.5']) {
      mocks.preferenceFindUnique.mockResolvedValue({ textProvider: 'openai', textModel: model })
      await generateWithUserKey('openai', 'p', 'user-1')
      expect(mocks.createAIProvider).toHaveBeenLastCalledWith('openai', { apiKey: USER_KEY, model })
    }
  })

  it.each([
    ['AI_QUOTA_EXCEEDED', 'cuota agotada'],
    ['AI_INVALID_API_KEY', 'clave rechazada'],
    ['AI_PROVIDER_ERROR', 'error del proveedor'],
    ['AI_TIMEOUT', 'tiempo agotado'],
    ['AI_RATE_LIMITED', 'límite de peticiones'],
    ['AI_MODEL_NOT_ALLOWED', 'modelo retirado o sin acceso'],
  ] as const)('si el proveedor falla (%s) no hay respaldo: ni otra clave, ni otro proveedor, ni reintento', async (code, _label) => {
    mocks.requireUserAIKey.mockResolvedValue(USER_KEY)
    const generate = vi.fn().mockRejectedValue(new AIProviderError(code, 'fallo'))
    mocks.createAIProvider.mockReturnValue({ generate })
    await expect(generateWithUserKey('openai', 'p', 'user-1')).rejects.toMatchObject({ code })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(mocks.createAIProvider).toHaveBeenCalledTimes(1)
    expect(mocks.requireUserAIKey).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['anthropic', 'claude-sonnet-5-5'],
    ['xai', 'grok-4.3'],
    ['mistral', 'mistral-large-latest'],
    ['deepseek', 'deepseek-flash'],
    ['openrouter', '~anthropic/claude-sonnet-latest'],
    ['groq', 'openai/gpt-oss-120b'],
  ] as const)('%s: usa la clave del usuario y el modelo recomendado de su catálogo (%s); sin clave no hay llamada', async (provider, model) => {
    mocks.requireUserAIKey.mockResolvedValue(null)
    await expect(generateWithUserKey(provider, 'p', 'user-1')).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' })
    expect(mocks.createAIProvider).not.toHaveBeenCalled()
    mocks.requireUserAIKey.mockResolvedValue(USER_KEY)
    await generateWithUserKey(provider, 'p', 'user-1')
    expect(mocks.createAIProvider).toHaveBeenCalledWith(provider, { apiKey: USER_KEY, model })
  })

  it('modelo y conexión elegidos para una operación: se usan sin cambiar la preferencia; uno fuera del catálogo se rechaza', async () => {
    mocks.requireUserAIKey.mockResolvedValue(USER_KEY)
    mocks.preferenceFindUnique.mockResolvedValue({ textProvider: 'anthropic', textModel: 'claude-sonnet-5-5', textKeyId: 'conn-pref' })
    await generateWithUserKey('anthropic', 'p', 'user-1', { model: 'claude-haiku-5-5', connectionId: 'conn-elegida' })
    expect(mocks.createAIProvider).toHaveBeenLastCalledWith('anthropic', { apiKey: USER_KEY, model: 'claude-haiku-5-5' })
    expect(mocks.connectionArgs.at(-1)).toEqual({ connectionId: 'conn-elegida', preferredId: 'conn-pref' })
    // Sin elección: la conexión de la preferencia para ese proveedor.
    await generateWithUserKey('anthropic', 'p', 'user-1')
    expect(mocks.connectionArgs.at(-1)).toEqual({ connectionId: null, preferredId: 'conn-pref' })
    // La preferencia de otro proveedor no aporta conexión.
    await generateWithUserKey('xai', 'p', 'user-1')
    expect(mocks.connectionArgs.at(-1)).toEqual({ connectionId: null, preferredId: null })
    mocks.createAIProvider.mockClear()
    for (const model of ['claude-3-opus-20240229', 'gpt-6.1-terra', 'https://evil.example/v1', 'grok-imagine-image-2.0']) {
      await expect(generateWithUserKey('anthropic', 'p', 'user-1', { model })).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    }
    // Un modelo de imagen de xAI no sirve para generar texto.
    await expect(generateWithUserKey('xai', 'p', 'user-1', { model: 'grok-imagine-image-2.0' })).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect(mocks.createAIProvider).not.toHaveBeenCalled()
  })

  it('agregador con catálogo consultable (OpenRouter): un modelo descubierto y validado se admite; uno que no está en ese catálogo, no', async () => {
    mocks.requireUserAIKey.mockResolvedValue(USER_KEY)
    mocks.discover.mockResolvedValue([{ id: 'mistralai/mistral-large-4', label: 'Mistral Large 4', maker: 'mistralai', verified: false }])
    await generateWithUserKey('openrouter', 'p', 'user-1', { model: 'mistralai/mistral-large-4' })
    expect(mocks.discover).toHaveBeenCalledWith(USER_KEY)
    expect(mocks.createAIProvider).toHaveBeenLastCalledWith('openrouter', { apiKey: USER_KEY, model: 'mistralai/mistral-large-4' })
    await expect(generateWithUserKey('openrouter', 'p', 'user-1', { model: 'otro/modelo-inexistente' })).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    // Si el catálogo del agregador no se puede leer, el modelo no se da por bueno.
    mocks.discover.mockRejectedValue(new Error('catálogo no disponible'))
    await expect(generateWithUserKey('openrouter', 'p', 'user-1', { model: 'mistralai/mistral-large-4' })).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    // Solo los agregadores con descubrimiento lo consultan: en Groq no se admite un modelo fuera del catálogo.
    mocks.discover.mockClear()
    await expect(generateWithUserKey('groq', 'p', 'user-1', { model: 'mistralai/mistral-large-4' })).rejects.toMatchObject({ code: 'AI_MODEL_NOT_ALLOWED' })
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('un proveedor que solo genera imagen o vídeo no sirve para texto', async () => {
    mocks.requireUserAIKey.mockResolvedValue(USER_KEY)
    for (const provider of ['runway', 'bfl', 'stability'] as never[]) await expect(generateWithUserKey(provider, 'p', 'user-1')).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' })
    expect(mocks.createAIProvider).not.toHaveBeenCalled()
  })

  it('una credencial que no se puede descifrar no se usa', async () => {
    mocks.requireUserAIKey.mockRejectedValue(new CredentialCryptoError('decrypt'))
    await expect(generateWithUserKey('gemini', 'p', 'user-1')).rejects.toMatchObject({ code: 'AI_KEY_UNREADABLE' })
    expect(mocks.createAIProvider).not.toHaveBeenCalled()
  })
})

describe('auditoría: ningún camino de ejecución usa claves de IA del servidor (DA-77)', () => {
  const root = resolve(import.meta.dirname, '..')
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === 'generated' ? [] : walk(path)
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
    })
  const sources = walk(root).map(path => ({ path: path.slice(root.length + 1).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }))

  it('el código de producción no menciona variables de claves de proveedores de IA', () => {
    const pattern = /(GEMINI|OPENAI|GOOGLE|ANTHROPIC|MISTRAL|AZURE_OPENAI|GOOGLE_GENAI)_API_KEY|process\.env\.AI_PROVIDER\b/
    const found = sources.filter(({ path, text }) => path !== 'env.ts' && pattern.test(text)).map(({ path }) => path)
    expect(found).toEqual([])
    // env.ts solo las nombra en un comentario para decir que se ignoran: no las declara en el esquema.
    const env = sources.find(({ path }) => path === 'env.ts')!.text
    expect(env.replace(/\/\/.*$/gm, '')).not.toMatch(/API_KEY|AI_PROVIDER/)
  })

  it('los únicos accesos a process.env con «KEY» son la clave de cifrado interna y Turnstile', () => {
    const names = new Set(sources.flatMap(({ text }) => [...text.matchAll(/process\.env\.([A-Z0-9_]*KEY[A-Z0-9_]*)/g)].map(match => match[1])))
    expect([...names].sort()).toEqual(['ESTATEFORGE_API_KEY_ENCRYPTION_KEY', 'TURNSTILE_SECRET_KEY'])
  })

  it('los proveedores de texto no tienen clave por defecto: sin la del usuario no se construyen', async () => {
    const { createAIProvider } = await vi.importActual<typeof import('../ai/ai-provider.factory.js')>('../ai/ai-provider.factory.js')
    for (const provider of ['gemini', 'openai', 'simulador'] as const) {
      expect(() => createAIProvider(provider)).toThrow(/API key/)
      expect(() => createAIProvider(provider, { apiKey: '', model: 'x' })).toThrow(/API key/)
    }
    expect(() => createAIProvider('mock')).not.toThrow()
  })
})
