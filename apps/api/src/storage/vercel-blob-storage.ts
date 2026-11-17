import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

import { BlobNotFoundError, del, get, head, issueSignedToken, list, presignUrl, put, type IssuedSignedToken } from '@vercel/blob'

import { assertValidKey, isValidPrefix, type ObjectStorage, type PresignGetOptions, type PresignPutOptions, type SignedTransfer, type StoredObject } from './object-storage.js'

// Vercel Blob en modo privado (@vercel/blob 2.8.2: acceso privado desde 2.3 y URLs firmadas con
// issueSignedToken y presignUrl). Las credenciales las resuelve el SDK: BLOB_READ_WRITE_TOKEN, u OIDC
// (VERCEL_OIDC_TOKEN + BLOB_STORE_ID) dentro de Vercel. Este código no las lee ni las registra.
//
// Transferencias directas (DA-58): los bytes de los archivos van del navegador a Blob y de Blob al
// navegador con URLs firmadas; la API solo autoriza, firma, valida y registra.
// - Subida: un token por intento, limitado a la ruta exacta, a la operación put, al tipo y al tamaño
//   declarados y a unos minutos. Con él se firma la URL de PUT.
// - Lectura: una delegación de solo lectura (get) para el almacén, que se guarda en memoria del
//   servidor y se renueva antes de caducar. Con ella se firma, para cada archivo autorizado, una URL
//   propia: la firma incluye la ruta, así que la URL no sirve para otro archivo ni para otra operación.
//   El clientSigningToken (la clave de firma) nunca sale del servidor; el delegationToken sí viaja en
//   la URL, como prevé el diseño de Vercel, pero sin la clave no permite firmar nada.
//
// No se ha probado contra el servicio real (no hay credenciales ni despliegue autorizados): las
// llamadas siguen los tipos del SDK instalado y están cubiertas con el SDK simulado.

const READ_DELEGATION_MS = 2 * 60 * 60 * 1000

export class VercelBlobStorage implements ObjectStorage {
  readonly driver = 'vercel-blob' as const
  readonly directTransfers = true
  private readDelegation: IssuedSignedToken | null = null

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertValidKey(key)
    await put(key, body, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: false })
  }

  async get(key: string): Promise<StoredObject | null> {
    assertValidKey(key)
    const result = await get(key, { access: 'private', useCache: false })
    if (!result || result.statusCode !== 200) return null
    return {
      stream: Readable.fromWeb(result.stream as unknown as WebReadableStream<Uint8Array>),
      size: result.blob.size,
      contentType: result.blob.contentType,
    }
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    assertValidKey(key)
    try {
      const result = await head(key)
      return { size: result.size, contentType: result.contentType }
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key)
    await del(key)
  }

  async list(prefix: string): Promise<string[]> {
    if (!isValidPrefix(prefix)) throw new Error('Prefijo no válido.')
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({ prefix, cursor })
      keys.push(...page.blobs.map(blob => blob.pathname))
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return keys.sort()
  }

  async presignPut(key: string, options: PresignPutOptions): Promise<SignedTransfer> {
    assertValidKey(key)
    const validUntil = options.expiresAt.getTime()
    const token = await issueSignedToken({
      pathname: key,
      operations: ['put'],
      validUntil,
      allowedContentTypes: [options.contentType],
      maximumSizeInBytes: options.maxBytes,
    })
    const { presignedUrl } = await presignUrl(token, {
      operation: 'put',
      pathname: key,
      access: 'private',
      validUntil,
      allowedContentTypes: [options.contentType],
      maximumSizeInBytes: options.maxBytes,
      allowOverwrite: false,
      addRandomSuffix: false,
    })
    // La documentación de Vercel sube con fetch(presignedUrl, { method: 'PUT', body }); el tipo lo
    // deduce Blob de la extensión de la ruta, que la API ha elegido según el tipo validado.
    return { method: 'PUT', url: presignedUrl, headers: {} }
  }

  private async readToken(until: number): Promise<IssuedSignedToken> {
    // Se reutiliza mientras cubra la expiración pedida con margen; si no, se pide otra.
    if (!this.readDelegation || this.readDelegation.validUntil < until + 60_000) {
      this.readDelegation = await issueSignedToken({ operations: ['get'], validUntil: Math.max(until + 60_000, Date.now() + READ_DELEGATION_MS) })
    }
    return this.readDelegation
  }

  async presignGet(key: string, options: PresignGetOptions): Promise<string> {
    assertValidKey(key)
    const validUntil = options.expiresAt.getTime()
    const token = await this.readToken(validUntil)
    const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname: key, access: 'private', validUntil })
    return presignedUrl
  }
}
