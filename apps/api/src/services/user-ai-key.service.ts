import { AI_MAX_CONNECTIONS_PER_PROVIDER, AI_PROVIDER_IDS, apiKeyHint, type AiConnectionStatus, type AiProviderId } from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import {
  decryptSecret,
  encryptSecret,
} from './secret-encryption.service.js'

// Credenciales de IA de cada usuario (BYOK, DA-68, DA-83). Se cifran con AES-256-GCM (IV aleatorio de 12
// bytes y etiqueta de autenticación) con ESTATEFORGE_API_KEY_ENCRYPTION_KEY y solo se descifran en el
// backend para la operación que las necesita. Nunca se devuelven, ni se registran, ni se guardan en texto
// plano: si falta la clave de cifrado o el secreto no se puede descifrar, la operación falla.
//
// Un usuario puede guardar varias conexiones del mismo proveedor (p. ej. «personal» y «profesional»),
// distinguidas por su etiqueta. La conexión principal es la de etiqueta vacía. Toda búsqueda filtra por
// userId: una conexión de otro usuario es, a todos los efectos, inexistente.

export const STORED_AI_KEY_PROVIDERS = AI_PROVIDER_IDS
export type StoredAIKeyProvider = AiProviderId

export function isStoredAIKeyProvider(provider: string): provider is StoredAIKeyProvider {
  return (STORED_AI_KEY_PROVIDERS as readonly string[]).includes(provider)
}

/** No se ha podido cifrar o descifrar: nunca se usa ni se guarda la clave en claro como alternativa. */
export class CredentialCryptoError extends Error {
  constructor(readonly operation: 'encrypt' | 'decrypt') {
    super(operation === 'encrypt' ? 'No se puede cifrar la credencial.' : 'No se puede descifrar la credencial guardada.')
    this.name = 'CredentialCryptoError'
  }
}

/** Errores de la gestión de conexiones (límite, etiqueta repetida, varias conexiones sin elegir). */
export class ConnectionError extends Error {
  constructor(
    readonly code: 'AI_CONNECTION_LIMIT' | 'AI_CONNECTION_DUPLICATE' | 'AI_CONNECTION_AMBIGUOUS',
    message: string,
  ) {
    super(message)
    this.name = 'ConnectionError'
  }
}

function encrypt(value: string): string {
  try {
    return encryptSecret(value)
  } catch {
    throw new CredentialCryptoError('encrypt')
  }
}

const freshMetadata = (key: string) => ({ keyHint: apiKeyHint(key) || null, status: 'unverified', lastVerifiedAt: null, lastErrorCode: null, lastCheckDetails: null, algorithm: 'aes-256-gcm', encryptionVersion: 1 })

/** Guarda (o sustituye) la conexión de un proveedor con esa etiqueta. Devuelve su identificador. */
export async function saveUserAIKey(userId: string, provider: StoredAIKeyProvider, apiKey: string, label = ''): Promise<string> {
  const normalizedKey = apiKey.trim()
  if (!normalizedKey) {
    throw new Error('La API key no puede estar vacía.')
  }
  const cleanLabel = label.trim()
  const encryptedKey = encrypt(normalizedKey)
  const existing = await prisma.userAIKey.findUnique({ where: { userId_provider_label: { userId, provider, label: cleanLabel } }, select: { id: true } })
  if (!existing) {
    const count = await prisma.userAIKey.count({ where: { userId, provider } })
    if (count >= AI_MAX_CONNECTIONS_PER_PROVIDER) throw new ConnectionError('AI_CONNECTION_LIMIT', `Como máximo ${AI_MAX_CONNECTIONS_PER_PROVIDER} conexiones por proveedor.`)
  }
  const saved = await prisma.userAIKey.upsert({
    where: { userId_provider_label: { userId, provider, label: cleanLabel } },
    create: { userId, provider, label: cleanLabel, encryptedKey, ...freshMetadata(normalizedKey) },
    update: { encryptedKey, ...freshMetadata(normalizedKey) },
    select: { id: true },
  })
  return saved.id
}

/** Crea una conexión nueva; falla si ya existe una con esa etiqueta (no sustituye la clave en silencio). */
export async function createConnection(userId: string, provider: StoredAIKeyProvider, apiKey: string, label: string): Promise<string> {
  const cleanLabel = label.trim()
  const existing = await prisma.userAIKey.findUnique({ where: { userId_provider_label: { userId, provider, label: cleanLabel } }, select: { id: true } })
  if (existing) throw new ConnectionError('AI_CONNECTION_DUPLICATE', cleanLabel ? 'Ya tienes una conexión de este proveedor con esa etiqueta.' : 'Ya tienes una conexión principal de este proveedor. Ponle una etiqueta a la nueva.')
  return saveUserAIKey(userId, provider, apiKey, cleanLabel)
}

/** Sustituye la clave o cambia la etiqueta de una conexión propia. Devuelve false si no existe. */
export async function updateConnection(userId: string, connectionId: string, changes: { apiKey?: string; label?: string }): Promise<boolean> {
  const current = await prisma.userAIKey.findFirst({ where: { id: connectionId, userId }, select: { id: true, provider: true, label: true } })
  if (!current) return false
  const data: Record<string, unknown> = {}
  if (changes.label !== undefined && changes.label.trim() !== current.label) {
    const label = changes.label.trim()
    const clash = await prisma.userAIKey.findUnique({ where: { userId_provider_label: { userId, provider: current.provider, label } }, select: { id: true } })
    if (clash) throw new ConnectionError('AI_CONNECTION_DUPLICATE', 'Ya tienes una conexión de este proveedor con esa etiqueta.')
    data.label = label
  }
  if (changes.apiKey !== undefined) {
    const key = changes.apiKey.trim()
    if (!key) throw new Error('La API key no puede estar vacía.')
    Object.assign(data, { encryptedKey: encrypt(key), ...freshMetadata(key) })
  }
  if (Object.keys(data).length > 0) await prisma.userAIKey.updateMany({ where: { id: connectionId, userId }, data })
  return true
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/** Una preferencia no puede apuntar a una conexión borrada ni a un proveedor sin credencial. */
async function cleanPreferences(tx: Tx, userId: string, provider: string, connectionId: string): Promise<void> {
  const remaining = await tx.userAIKey.count({ where: { userId, provider } })
  for (const purpose of ['text', 'poster', 'video'] as const) {
    const providerField = `${purpose}Provider`
    const keyField = `${purpose}KeyId`
    if (remaining === 0) await tx.aiMediaPreference.updateMany({ where: { userId, [providerField]: provider }, data: { [providerField]: null, [`${purpose}Model`]: null, [keyField]: null } })
    else await tx.aiMediaPreference.updateMany({ where: { userId, [keyField]: connectionId }, data: { [keyField]: null } })
  }
  await tx.aiMediaPreference.updateMany({ where: { userId, moderationKeyId: connectionId }, data: { moderationProvider: null, moderationKeyId: null } })
}

/** Elimina la conexión principal del proveedor (compatibilidad con la gestión por proveedor). */
export async function deleteUserAIKey(userId: string, provider: StoredAIKeyProvider): Promise<void> {
  await prisma.$transaction(async tx => {
    const rows = await tx.userAIKey.findMany({ where: { userId, provider }, select: { id: true, label: true }, orderBy: { createdAt: 'asc' } })
    const target = rows.find(row => row.label === '') ?? (rows.length === 1 ? rows[0] : null)
    if (!target) return
    await tx.userAIKey.deleteMany({ where: { id: target.id, userId } })
    await cleanPreferences(tx, userId, provider, target.id)
  })
}

/** Elimina una conexión propia por su identificador. Devuelve false si no existe (o es de otro usuario). */
export async function deleteConnection(userId: string, connectionId: string): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const target = await tx.userAIKey.findFirst({ where: { id: connectionId, userId }, select: { id: true, provider: true } })
    if (!target) return false
    await tx.userAIKey.deleteMany({ where: { id: target.id, userId } })
    await cleanPreferences(tx, userId, target.provider, target.id)
    return true
  })
}

export async function getStoredAIKeyStatus(
  userId: string,
): Promise<Record<'gemini' | 'openai', boolean>> {
  const keys = await prisma.userAIKey.findMany({
    where: { userId },
    select: { provider: true },
  })

  return {
    gemini: keys.some((key) => key.provider === 'gemini'),
    openai: keys.some((key) => key.provider === 'openai'),
  }
}

export interface ResolvedConnection {
  id: string
  label: string
  apiKey: string
}

/**
 * Conexión que se usará para un proveedor, siempre del propio usuario. Orden: la indicada para la
 * operación, la de la preferencia, la única que haya o la principal (etiqueta vacía). Si hay varias y
 * ninguna de esas reglas decide, se pide al usuario que elija: nunca se escoge una cuenta al azar.
 * Una conexión indicada que no existe (o es de otro usuario) no se sustituye por otra.
 */
export async function resolveConnection(userId: string, provider: StoredAIKeyProvider, connectionId?: string | null, preferredId?: string | null): Promise<ResolvedConnection | null> {
  const rows = await prisma.userAIKey.findMany({ where: { userId, provider }, select: { id: true, label: true, encryptedKey: true }, orderBy: { createdAt: 'asc' } })
  let row
  if (connectionId) {
    row = rows.find(item => item.id === connectionId)
    if (!row) return null
  } else {
    row = (preferredId ? rows.find(item => item.id === preferredId) : undefined) ?? (rows.length === 1 ? rows[0] : rows.find(item => item.label === ''))
    if (!row && rows.length > 1) throw new ConnectionError('AI_CONNECTION_AMBIGUOUS', 'Tienes varias conexiones de este proveedor. Elige cuál quieres usar.')
    if (!row) return null
  }
  try {
    return { id: row.id, label: row.label, apiKey: decryptSecret(row.encryptedKey) }
  } catch {
    throw new CredentialCryptoError('decrypt')
  }
}

export async function getUserAIKey(userId: string, provider: StoredAIKeyProvider): Promise<string | null> {
  return (await resolveConnection(userId, provider))?.apiKey ?? null
}

/** Clave de la conexión resuelta, con un error controlado si no se puede descifrar. */
export async function requireUserAIKey(userId: string, provider: StoredAIKeyProvider, connectionId?: string | null, preferredId?: string | null): Promise<string | null> {
  return (await resolveConnection(userId, provider, connectionId, preferredId))?.apiKey ?? null
}

/** Estado de una conexión. Sin identificador, la principal (o la única) del proveedor. */
export async function setConnectionStatus(userId: string, provider: StoredAIKeyProvider, status: AiConnectionStatus, errorCode: string | null, connectionId?: string | null, checkDetails?: Record<string, unknown>): Promise<void> {
  // checkDetails: diagnóstico de una comprobación (DA-87), sin secretos; solo lo escribe la comprobación.
  const data = { status, lastErrorCode: errorCode, ...(status === 'verified' && { lastVerifiedAt: new Date() }), ...(checkDetails && { lastCheckDetails: JSON.stringify(checkDetails).slice(0, 8000) }) }
  if (connectionId) {
    await prisma.userAIKey.updateMany({ where: { id: connectionId, userId, provider }, data })
    return
  }
  const rows = await prisma.userAIKey.findMany({ where: { userId, provider }, select: { id: true, label: true } })
  const target = rows.length === 1 ? rows[0] : rows.find(row => row.label === '')
  if (target) await prisma.userAIKey.updateMany({ where: { id: target.id, userId }, data })
}

/** Conexiones del usuario: solo metadatos no secretos (nunca encryptedKey). */
export async function listConnections(userId: string) {
  return prisma.userAIKey.findMany({
    where: { userId },
    select: { id: true, provider: true, label: true, keyHint: true, status: true, lastVerifiedAt: true, lastErrorCode: true, lastCheckDetails: true, algorithm: true, encryptionVersion: true, createdAt: true, updatedAt: true },
    orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
  })
}
