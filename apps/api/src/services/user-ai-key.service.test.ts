import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Row {
  id: string
  userId: string
  provider: string
  label: string
  encryptedKey: string
  createdAt: Date
}

// Base en memoria mínima: lo justo para probar las reglas de las conexiones sin PostgreSQL.
const store = vi.hoisted(() => ({ rows: [] as Row[], preferenceUpdates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[], next: 1 }))

const prismaMock = vi.hoisted(() => {
  const match = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value)
  const userAIKey = {
    findUnique: vi.fn(async ({ where }: { where: { userId_provider_label: { userId: string; provider: string; label: string } } }) => store.rows.find(row => match(row, where.userId_provider_label)) ?? null),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => store.rows.find(row => match(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => store.rows.filter(row => match(row, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => store.rows.filter(row => match(row, where)).length),
    upsert: vi.fn(async ({ where, create, update }: { where: { userId_provider_label: { userId: string; provider: string; label: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const existing = store.rows.find(row => match(row, where.userId_provider_label))
      if (existing) {
        Object.assign(existing, update)
        return existing
      }
      const row = { id: `conn-${store.next}`, createdAt: new Date(2026, 10, 12, 0, 0, store.next++), ...create } as unknown as Row
      store.rows.push(row)
      return row
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const rows = store.rows.filter(row => match(row, where))
      rows.forEach(row => Object.assign(row, data))
      return { count: rows.length }
    }),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const before = store.rows.length
      store.rows = store.rows.filter(row => !match(row, where))
      return { count: before - store.rows.length }
    }),
  }
  const mock = {
    userAIKey,
    // Al borrar una conexión se limpian las preferencias que la usan, en la misma transacción.
    aiMediaPreference: {
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        store.preferenceUpdates.push(args)
        return { count: 0 }
      }),
    },
    $transaction: vi.fn(),
  }
  mock.$transaction.mockImplementation(async (work: (tx: typeof mock) => Promise<unknown>) => work(mock))
  return mock
})

vi.mock('../db/prisma.js', () => ({
  prisma: prismaMock,
}))

import {
  ConnectionError,
  CredentialCryptoError,
  createConnection,
  deleteConnection,
  deleteUserAIKey,
  getStoredAIKeyStatus,
  getUserAIKey,
  isStoredAIKeyProvider,
  requireUserAIKey,
  resolveConnection,
  saveUserAIKey,
  setConnectionStatus,
  updateConnection,
} from './user-ai-key.service.js'

describe('user AI keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.rows = []
    store.preferenceUpdates = []
    store.next = 1
    process.env.ESTATEFORGE_API_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
  })

  it('guarda la key cifrada y no el valor en claro', async () => {
    await saveUserAIKey('user-1', 'gemini', 'AIza-secret-value')

    const call = prismaMock.userAIKey.upsert.mock.calls[0][0]
    expect(call.create.encryptedKey).not.toBe('AIza-secret-value')
    expect(call.create.encryptedKey).toContain('.')
    expect(call.create).toMatchObject({ userId: 'user-1', provider: 'gemini', label: '', status: 'unverified', algorithm: 'aes-256-gcm', keyHint: 'alue' })
    expect(JSON.stringify(store.rows)).not.toContain('AIza-secret-value')
  })

  it('devuelve solo el estado de configuración de las keys', async () => {
    await saveUserAIKey('user-1', 'gemini', 'AIza-secret-value')

    await expect(getStoredAIKeyStatus('user-1')).resolves.toEqual({
      gemini: true,
      openai: false,
    })
  })

  it('descifra la key solo para el uso interno del proveedor', async () => {
    await saveUserAIKey('user-1', 'openai', 'sk-secret-value')

    await expect(getUserAIKey('user-1', 'openai')).resolves.toBe('sk-secret-value')
    await expect(requireUserAIKey('user-1', 'openai')).resolves.toBe('sk-secret-value')
    // Otro usuario no tiene esa clave.
    await expect(getUserAIKey('user-2', 'openai')).resolves.toBeNull()
  })

  it('permite eliminar una key guardada y limpia las preferencias del proveedor', async () => {
    await saveUserAIKey('user-1', 'gemini', 'AIza-secret-value')

    await deleteUserAIKey('user-1', 'gemini')

    expect(store.rows).toEqual([])
    expect(store.preferenceUpdates.map(update => update.where)).toEqual(expect.arrayContaining([{ userId: 'user-1', textProvider: 'gemini' }, { userId: 'user-1', posterProvider: 'gemini' }, { userId: 'user-1', videoProvider: 'gemini' }]))
    // Nunca se borran las claves de otro usuario.
    for (const call of prismaMock.userAIKey.deleteMany.mock.calls) expect(call[0].where.userId).toBe('user-1')
  })

  it('admite todos los proveedores del catálogo y ningún otro', () => {
    for (const id of ['gemini', 'openai', 'anthropic', 'xai', 'mistral', 'deepseek', 'openrouter', 'groq', 'bfl', 'stability', 'ideogram', 'recraft', 'runway', 'fal', 'replicate', 'simulador']) expect(isStoredAIKeyProvider(id)).toBe(true)
    for (const id of ['mock', 'luma', 'sora', 'https://evil.example', '']) expect(isStoredAIKeyProvider(id)).toBe(false)
  })
})

describe('varias conexiones por proveedor (DA-83)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.rows = []
    store.preferenceUpdates = []
    store.next = 1
    process.env.ESTATEFORGE_API_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
  })

  it('cada etiqueta es una conexión distinta; guardar con la misma etiqueta sustituye la clave', async () => {
    const personal = await saveUserAIKey('user-1', 'openai', 'sk-personal-0000')
    const work = await saveUserAIKey('user-1', 'openai', 'sk-profesional-0000', ' Profesional ')
    expect(work).not.toBe(personal)
    expect(store.rows.map(row => row.label)).toEqual(['', 'Profesional'])
    await expect(saveUserAIKey('user-1', 'openai', 'sk-personal-nueva')).resolves.toBe(personal)
    expect(store.rows).toHaveLength(2)
    await expect(resolveConnection('user-1', 'openai', personal)).resolves.toMatchObject({ apiKey: 'sk-personal-nueva' })
  })

  it('crear no sustituye una conexión existente, y hay un máximo por proveedor', async () => {
    await createConnection('user-1', 'anthropic', 'clave-principal-0000', '')
    await expect(createConnection('user-1', 'anthropic', 'otra-clave-0000000', '')).rejects.toMatchObject({ code: 'AI_CONNECTION_DUPLICATE' })
    for (const label of ['a', 'b', 'c', 'd']) await createConnection('user-1', 'anthropic', 'clave-0000000000', label)
    await expect(createConnection('user-1', 'anthropic', 'clave-0000000000', 'e')).rejects.toBeInstanceOf(ConnectionError)
    await expect(createConnection('user-1', 'anthropic', 'clave-0000000000', 'e')).rejects.toMatchObject({ code: 'AI_CONNECTION_LIMIT' })
    // El límite es por usuario y por proveedor.
    await expect(createConnection('user-2', 'anthropic', 'clave-0000000000', 'e')).resolves.toBeTruthy()
    await expect(createConnection('user-1', 'mistral', 'clave-0000000000', 'e')).resolves.toBeTruthy()
  })

  it('qué conexión se usa: la indicada; si no, la de la preferencia, la única o la principal', async () => {
    const main = await saveUserAIKey('user-1', 'runway', 'key_principal0000000')
    const second = await saveUserAIKey('user-1', 'runway', 'key_segunda000000000', 'segunda')
    await expect(resolveConnection('user-1', 'runway')).resolves.toMatchObject({ id: main, apiKey: 'key_principal0000000' })
    await expect(resolveConnection('user-1', 'runway', second)).resolves.toMatchObject({ id: second, label: 'segunda' })
    await expect(resolveConnection('user-1', 'runway', null, second)).resolves.toMatchObject({ id: second })
    // La indicada manda sobre la preferida.
    await expect(resolveConnection('user-1', 'runway', main, second)).resolves.toMatchObject({ id: main })
    // Una conexión indicada que no existe (o es de otro usuario) no se sustituye por otra.
    await expect(resolveConnection('user-1', 'runway', 'conn-inexistente')).resolves.toBeNull()
    await expect(resolveConnection('user-2', 'runway', main)).resolves.toBeNull()
    await expect(resolveConnection('user-2', 'runway')).resolves.toBeNull()
    // Una preferencia que ya no existe no impide usar la principal.
    await expect(resolveConnection('user-1', 'runway', null, 'conn-borrada')).resolves.toMatchObject({ id: main })
    // Una sola conexión con etiqueta: es la única.
    await saveUserAIKey('user-1', 'fal', 'clave-fal-00000000', 'única')
    await expect(resolveConnection('user-1', 'fal')).resolves.toMatchObject({ label: 'única' })
  })

  it('varias conexiones sin principal ni preferencia: se pide elegir, nunca se escoge una al azar', async () => {
    await saveUserAIKey('user-1', 'xai', 'clave-xai-a-000000', 'a')
    await saveUserAIKey('user-1', 'xai', 'clave-xai-b-000000', 'b')
    await expect(resolveConnection('user-1', 'xai')).rejects.toMatchObject({ code: 'AI_CONNECTION_AMBIGUOUS' })
    await expect(requireUserAIKey('user-1', 'xai')).rejects.toBeInstanceOf(ConnectionError)
  })

  it('una credencial que no se puede descifrar no se usa', async () => {
    const connectionId = await saveUserAIKey('user-1', 'groq', 'clave-groq-0000000')
    store.rows[0].encryptedKey = 'AAAA.BBBB.CCCC'
    await expect(resolveConnection('user-1', 'groq', connectionId)).rejects.toBeInstanceOf(CredentialCryptoError)
    delete process.env.ESTATEFORGE_API_KEY_ENCRYPTION_KEY
    // Sin clave de cifrado no se guarda nada (nunca en texto plano).
    await expect(saveUserAIKey('user-1', 'groq', 'clave-groq-nueva-000', 'otra')).rejects.toBeInstanceOf(CredentialCryptoError)
    expect(store.rows).toHaveLength(1)
  })

  it('sustituir la clave o cambiar la etiqueta de una conexión propia', async () => {
    const connectionId = await saveUserAIKey('user-1', 'bfl', 'clave-bfl-00000000')
    await saveUserAIKey('user-1', 'bfl', 'clave-bfl-2-000000', 'otra')
    store.rows[0] = { ...store.rows[0], ...({ status: 'verified' } as object) }
    await expect(updateConnection('user-1', connectionId, { apiKey: 'clave-bfl-nueva-000' })).resolves.toBe(true)
    expect(store.rows[0]).toMatchObject({ status: 'unverified', lastVerifiedAt: null })
    await expect(resolveConnection('user-1', 'bfl', connectionId)).resolves.toMatchObject({ apiKey: 'clave-bfl-nueva-000' })
    await expect(updateConnection('user-1', connectionId, { label: 'otra' })).rejects.toMatchObject({ code: 'AI_CONNECTION_DUPLICATE' })
    await expect(updateConnection('user-1', connectionId, { label: 'principal antigua' })).resolves.toBe(true)
    expect(store.rows[0].label).toBe('principal antigua')
    // La conexión de otro usuario no existe.
    await expect(updateConnection('user-2', connectionId, { apiKey: 'clave-ajena-0000000' })).resolves.toBe(false)
    await expect(resolveConnection('user-1', 'bfl', connectionId)).resolves.toMatchObject({ apiKey: 'clave-bfl-nueva-000' })
  })

  it('eliminar una conexión: solo la propia; las preferencias se limpian según queden o no otras conexiones', async () => {
    const a = await saveUserAIKey('user-1', 'simulador', 'sim-ok-aaaaaaaa')
    const b = await saveUserAIKey('user-1', 'simulador', 'sim-ok-bbbbbbbb', 'b')
    await expect(deleteConnection('user-2', a)).resolves.toBe(false)
    expect(store.rows).toHaveLength(2)
    await expect(deleteConnection('user-1', b)).resolves.toBe(true)
    // Queda otra conexión del proveedor: solo se quita la referencia a la conexión borrada.
    expect(store.preferenceUpdates.map(update => update.where)).toEqual(expect.arrayContaining([{ userId: 'user-1', textKeyId: b }, { userId: 'user-1', posterKeyId: b }, { userId: 'user-1', videoKeyId: b }, { userId: 'user-1', moderationKeyId: b }]))
    expect(store.preferenceUpdates.some(update => 'textProvider' in update.where)).toBe(false)
    store.preferenceUpdates = []
    await expect(deleteConnection('user-1', a)).resolves.toBe(true)
    // Ya no queda ninguna: se borran las preferencias del proveedor.
    expect(store.preferenceUpdates.map(update => update.where)).toEqual(expect.arrayContaining([{ userId: 'user-1', textProvider: 'simulador' }, { userId: 'user-1', moderationKeyId: a }]))
    await expect(deleteConnection('user-1', a)).resolves.toBe(false)
  })

  it('el estado se guarda en la conexión indicada (o en la principal), solo del propio usuario', async () => {
    const main = await saveUserAIKey('user-1', 'ideogram', 'clave-ideogram-0000')
    const second = await saveUserAIKey('user-1', 'ideogram', 'clave-ideogram-0001', 'b')
    await setConnectionStatus('user-1', 'ideogram', 'invalid', 'AI_INVALID_KEY', second)
    await setConnectionStatus('user-1', 'ideogram', 'verified', null)
    await setConnectionStatus('user-2', 'ideogram', 'error', 'X', main)
    const status = (id: string) => (store.rows.find(row => row.id === id) as unknown as { status: string; lastErrorCode: string | null })
    expect(status(main)).toMatchObject({ status: 'verified', lastErrorCode: null })
    expect(status(second)).toMatchObject({ status: 'invalid', lastErrorCode: 'AI_INVALID_KEY' })
  })
})
