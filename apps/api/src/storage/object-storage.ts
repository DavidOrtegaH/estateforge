import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Readable } from 'node:stream'

// Almacenamiento de objetos de las fotografías y del material publicitario (DA-46). PostgreSQL solo
// guarda la clave y los metadatos; los bytes viven aquí.
//
// Controladores:
// - 'local': disco (desarrollo y pruebas). Directorio STORAGE_LOCAL_DIR, por defecto apps/api/.storage.
// - 'vercel-blob': Vercel Blob privado (producción). Credenciales del SDK: BLOB_READ_WRITE_TOKEN, o
//   OIDC dentro de Vercel. Nunca se envían al navegador ni se registran.
//
// Las claves son únicas y nunca se reutilizan: put falla si la clave ya existe, de modo que un archivo
// en uso no se puede sobrescribir. Las claves llevan el usuario y el inmueble o el anuncio, pero el
// control de acceso lo hace siempre la API comprobando la propiedad en PostgreSQL.

export interface StoredObject {
  stream: Readable
  size: number
  contentType: string
}

export interface PresignPutOptions {
  contentType: string
  maxBytes: number
  expiresAt: Date
}

export interface PresignGetOptions {
  expiresAt: Date
  /** Nombre para descargar como adjunto (si el almacenamiento lo admite). */
  downloadName?: string
}

/** Instrucciones para que el navegador envíe el archivo directamente al almacenamiento. */
export interface SignedTransfer {
  method: 'PUT'
  url: string
  headers: Record<string, string>
}

export interface ObjectStorage {
  readonly driver: 'local' | 'vercel-blob'
  /**
   * true: los archivos viajan directamente entre el navegador y el almacenamiento con URLs firmadas
   * (Vercel Blob, o el local con STORAGE_LOCAL_SIGNED_URLS=1); la API nunca los recibe ni los sirve.
   */
  readonly directTransfers: boolean
  /** Guarda un objeto nuevo. Falla si la clave ya existe. */
  put(key: string, body: Buffer, contentType: string): Promise<void>
  /** Devuelve el objeto o null si no existe. */
  get(key: string): Promise<StoredObject | null>
  /** Tamaño y tipo sin descargar el objeto; null si no existe. */
  head(key: string): Promise<{ size: number; contentType: string } | null>
  /** URL firmada de PUT para una clave, un tipo, un tamaño máximo y una expiración. */
  presignPut(key: string, options: PresignPutOptions): Promise<SignedTransfer>
  /** URL firmada de GET para una clave hasta una expiración. */
  presignGet(key: string, options: PresignGetOptions): Promise<string>
  /** Borra el objeto. No falla si ya no existe. */
  delete(key: string): Promise<void>
  /** Claves bajo un prefijo (para detectar archivos huérfanos). */
  list(prefix: string): Promise<string[]>
}

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageConfigError'
  }
}

// Fotografías y miniaturas de un inmueble, cartel y vídeo de un anuncio, y pistas de audio del usuario.
const KEY_PATTERN = /^u\/[a-z0-9]{1,64}\/(?:[pg]\/[a-z0-9]{1,64}\/(?:photos|thumbs|poster|video|ai)|audio)\/[0-9a-f-]{36}\.(?:jpg|png|webp|webm|mp4|mp3|wav|ogg|m4a)$/

/** Comprueba que una clave tiene la forma que genera la aplicación (sin rutas relativas ni absolutas). */
export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error('Clave de almacenamiento no válida.')
}

export function isValidPrefix(prefix: string): boolean {
  return /^u\/([a-z0-9/]*)$/.test(prefix) && !prefix.includes('//')
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
}

/** Clave nueva y única para una fotografía de un inmueble. */
export function photoKey(userId: string, propertyId: string, contentType: string): string {
  return buildKey(`u/${safeId(userId)}/p/${safeId(propertyId)}/photos`, contentType)
}

/** Clave nueva y única para la miniatura JPEG de una fotografía (DA-51). */
export function thumbKey(userId: string, propertyId: string): string {
  return buildKey(`u/${safeId(userId)}/p/${safeId(propertyId)}/thumbs`, 'image/jpeg')
}

/** Clave nueva y única para una pista de la biblioteca de audio del usuario (DA-55). */
export function audioKey(userId: string, contentType: string): string {
  return buildKey(`u/${safeId(userId)}/audio`, contentType)
}

/** Clave nueva y única para el resultado temporal de un trabajo de IA (DA-71), pendiente de revisión. */
export function aiResultKey(userId: string, generationId: string, contentType: string): string {
  return buildKey(`u/${safeId(userId)}/g/${safeId(generationId)}/ai`, contentType)
}

/** Clave nueva y única para el cartel o el vídeo de un anuncio. */
export function mediaKey(userId: string, generationId: string, kind: 'poster' | 'video', contentType: string): string {
  return buildKey(`u/${safeId(userId)}/g/${safeId(generationId)}/${kind}`, contentType)
}

function safeId(id: string): string {
  const lower = id.toLowerCase()
  if (!/^[a-z0-9]{1,64}$/.test(lower)) throw new Error('Identificador no válido para una clave de almacenamiento.')
  return lower
}

function buildKey(prefix: string, contentType: string): string {
  const extension = EXTENSIONS[contentType]
  if (!extension) throw new Error('Tipo de contenido no admitido.')
  const key = `${prefix}/${randomUUID()}.${extension}`
  assertValidKey(key)
  return key
}

let instance: ObjectStorage | null = null

/** Almacenamiento configurado (STORAGE_DRIVER). Se crea al primer uso. */
export async function getStorage(env: NodeJS.ProcessEnv = process.env): Promise<ObjectStorage> {
  instance ??= await createStorage(env)
  return instance
}

/** Solo para pruebas: sustituye el almacenamiento del proceso. */
export function setStorageForTests(storage: ObjectStorage | null): void {
  instance = storage
}

/**
 * Valida la configuración del almacenamiento sin crearlo. Se llama al construir la aplicación: una
 * configuración incompleta o insegura (disco local en Vercel o en producción, Blob sin credenciales)
 * impide arrancar, en lugar de fallar en la primera petición de archivos.
 */
export function storageDriverOf(env: NodeJS.ProcessEnv): 'local' | 'vercel-blob' {
  // STORAGE_PROVIDER se admite como sinónimo; si ambas están definidas deben coincidir.
  const driver = env.STORAGE_DRIVER?.trim() || env.STORAGE_PROVIDER?.trim() || 'local'
  if (env.STORAGE_DRIVER?.trim() && env.STORAGE_PROVIDER?.trim() && env.STORAGE_DRIVER.trim() !== env.STORAGE_PROVIDER.trim()) {
    throw new StorageConfigError('STORAGE_DRIVER y STORAGE_PROVIDER tienen valores distintos.')
  }
  if (driver === 'local') {
    // En Vercel el disco es efímero y no se comparte entre instancias: los archivos se perderían.
    if (env.VERCEL === '1') throw new StorageConfigError('STORAGE_DRIVER=local no es válido en Vercel: usa vercel-blob.')
    if (env.NODE_ENV === 'production' && env.STORAGE_ALLOW_LOCAL_IN_PRODUCTION !== '1') {
      throw new StorageConfigError('STORAGE_DRIVER=local no se admite en producción: configura vercel-blob.')
    }
    return 'local'
  }
  if (driver === 'vercel-blob') {
    const hasToken = Boolean(env.BLOB_READ_WRITE_TOKEN?.trim()) || (Boolean(env.VERCEL_OIDC_TOKEN?.trim()) && Boolean(env.BLOB_STORE_ID?.trim()))
    if (!hasToken) throw new StorageConfigError('STORAGE_DRIVER=vercel-blob requiere BLOB_READ_WRITE_TOKEN (u OIDC de Vercel con BLOB_STORE_ID).')
    return 'vercel-blob'
  }
  throw new StorageConfigError('STORAGE_DRIVER debe ser local o vercel-blob.')
}

export async function createStorage(env: NodeJS.ProcessEnv): Promise<ObjectStorage> {
  if (storageDriverOf(env) === 'local') {
    const { LocalStorage } = await import('./local-storage.js')
    const { LocalSigner } = await import('./local-signer.js')
    const base = env.API_PUBLIC_URL?.trim() || `http://localhost:${env.PORT?.trim() || '3000'}`
    return new LocalStorage(resolve(env.STORAGE_LOCAL_DIR?.trim() || resolve(import.meta.dirname, '../../.storage')), {
      signer: new LocalSigner(base, env.STORAGE_LOCAL_SIGNING_SECRET?.trim()),
      directTransfers: env.STORAGE_LOCAL_SIGNED_URLS === '1',
    })
  }
  const { VercelBlobStorage } = await import('./vercel-blob-storage.js')
  return new VercelBlobStorage()
}
