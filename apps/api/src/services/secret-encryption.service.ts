import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

function getEncryptionKey(): Buffer {
  const raw = process.env.ESTATEFORGE_API_KEY_ENCRYPTION_KEY?.trim()

  if (!raw) {
    throw new Error(
      'ESTATEFORGE_API_KEY_ENCRYPTION_KEY no está configurada.',
    )
  }

  try {
    const key = Buffer.from(raw, 'base64')
    if (key.length === KEY_LENGTH) {
      return key
    }
  } catch {
    // Try hex below.
  }

  const hexKey = Buffer.from(raw, 'hex')
  if (hexKey.length === KEY_LENGTH) {
    return hexKey
  }

  throw new Error(
    'ESTATEFORGE_API_KEY_ENCRYPTION_KEY debe contener exactamente 32 bytes en base64 o hexadecimal.',
  )
}

/**
 * Cifra secretos antes de persistirlos.
 * El contenido nunca se devuelve en respuestas HTTP ni se registra.
 */
export function encryptSecret(value: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
}

export function decryptSecret(payload: string): string {
  const key = getEncryptionKey()
  const parts = payload.split('.')

  if (parts.length !== 3) {
    throw new Error('El secreto cifrado no tiene un formato válido.')
  }

  const iv = Buffer.from(parts[0], 'base64')
  const authTag = Buffer.from(parts[1], 'base64')
  const ciphertext = Buffer.from(parts[2], 'base64')

  if (
    iv.length !== IV_LENGTH ||
    authTag.length !== AUTH_TAG_LENGTH
  ) {
    throw new Error('El secreto cifrado no tiene parámetros válidos.')
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}
