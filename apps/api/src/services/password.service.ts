import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'

import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

const SALT_LENGTH = 16
const KEY_LENGTH = 64

export async function hashPassword(
  password: string,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)

  const derivedKey = (await scrypt(
    password,
    salt,
    KEY_LENGTH,
  )) as Buffer

  return [
    'scrypt',
    salt.toString('hex'),
    derivedKey.toString('hex'),
  ].join('$')
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$')

  if (
    parts.length !== 3 ||
    parts[0] !== 'scrypt'
  ) {
    return false
  }

  const [, saltHex, hashHex] = parts

  try {
    const salt = Buffer.from(
      saltHex,
      'hex',
    )

    const expectedHash = Buffer.from(
      hashHex,
      'hex',
    )

    if (
      salt.length !== SALT_LENGTH ||
      expectedHash.length !== KEY_LENGTH
    ) {
      return false
    }

    const derivedKey = (await scrypt(
      password,
      salt,
      KEY_LENGTH,
    )) as Buffer

    return timingSafeEqual(
      derivedKey,
      expectedHash,
    )
  } catch {
    return false
  }
}