import { createReadStream } from 'node:fs'
import { link, mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { LocalSigner } from './local-signer.js'
import { assertValidKey, isValidPrefix, type ObjectStorage, type PresignGetOptions, type PresignPutOptions, type SignedTransfer, type StoredObject } from './object-storage.js'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
}

export const contentTypeOfKey = (key: string) => CONTENT_TYPES[key.slice(key.lastIndexOf('.') + 1)] ?? 'application/octet-stream'

// Almacenamiento en disco para desarrollo y pruebas. La escritura es atómica y nunca sobrescribe:
// se escribe un temporal y se enlaza con el nombre definitivo (link falla si ya existe).
//
// Con un firmante (siempre en la aplicación), emite URLs firmadas locales que imitan a Vercel Blob
// (local-signer.ts). directTransfers=true (STORAGE_LOCAL_SIGNED_URLS=1) reproduce además el
// comportamiento de producción: las rutas de archivos redirigen a la URL firmada y la API no acepta
// archivos en el cuerpo de sus rutas.
export class LocalStorage implements ObjectStorage {
  readonly driver = 'local' as const
  readonly directTransfers: boolean
  private readonly root: string
  readonly signer: LocalSigner | null

  constructor(root: string, options: { signer?: LocalSigner; directTransfers?: boolean } = {}) {
    this.root = root
    this.signer = options.signer ?? null
    this.directTransfers = Boolean(options.directTransfers && options.signer)
  }

  private path(key: string): string {
    assertValidKey(key)
    const full = join(this.root, ...key.split('/'))
    if (!full.startsWith(this.root + sep)) throw new Error('Clave de almacenamiento no válida.')
    return full
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.path(key)
    await mkdir(dirname(target), { recursive: true })
    const temp = `${target}.${randomUUID()}.tmp`
    await writeFile(temp, body, { flag: 'wx' })
    try {
      await link(temp, target)
    } finally {
      await unlink(temp).catch(() => {})
    }
  }

  async get(key: string, range?: { start: number; end: number }): Promise<StoredObject | null> {
    const target = this.path(key)
    try {
      const info = await stat(target)
      const stream = range ? createReadStream(target, { start: range.start, end: range.end }) : createReadStream(target)
      return { stream, size: info.size, contentType: contentTypeOfKey(key) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const info = await stat(this.path(key))
      return { size: info.size, contentType: contentTypeOfKey(key) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }

  async list(prefix: string): Promise<string[]> {
    if (!isValidPrefix(prefix)) throw new Error('Prefijo no válido.')
    const base = join(this.root, ...prefix.split('/').filter(Boolean))
    const out: string[] = []
    const walk = async (dir: string) => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (!entry.name.endsWith('.tmp')) out.push(relative(this.root, full).split(sep).join('/'))
      }
    }
    await walk(base)
    return out.sort()
  }

  private requireSigner(): LocalSigner {
    if (!this.signer) throw new Error('El almacenamiento local no tiene firmante de URLs.')
    return this.signer
  }

  async presignPut(key: string, options: PresignPutOptions): Promise<SignedTransfer> {
    assertValidKey(key)
    const url = this.requireSigner().sign({ op: 'put', key, exp: options.expiresAt.getTime(), ct: options.contentType, max: options.maxBytes })
    return { method: 'PUT', url, headers: { 'Content-Type': options.contentType } }
  }

  async presignGet(key: string, options: PresignGetOptions): Promise<string> {
    assertValidKey(key)
    return this.requireSigner().sign({ op: 'get', key, exp: options.expiresAt.getTime(), ...(options.downloadName && { dl: options.downloadName }) })
  }
}
