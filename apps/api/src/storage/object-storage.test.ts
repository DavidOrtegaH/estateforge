import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn(), list: vi.fn(), head: vi.fn(), issueSignedToken: vi.fn(), presignUrl: vi.fn() }))
const BlobNotFoundError = vi.hoisted(() => class BlobNotFoundError extends Error {})
vi.mock('@vercel/blob', () => ({ ...blob, BlobNotFoundError }))

import { LocalSigner } from './local-signer.js'
import { LocalStorage } from './local-storage.js'
import { assertValidKey, createStorage, mediaKey, photoKey, StorageConfigError, storageDriverOf } from './object-storage.js'
import { VercelBlobStorage } from './vercel-blob-storage.js'

const ROOT = mkdtempSync(join(tmpdir(), 'ef-storage-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const USER = 'cuserxxxxxxxxxxxxxxxxxxxx'
const PROPERTY = 'cpropxxxxxxxxxxxxxxxxxxxx'

describe('claves de almacenamiento', () => {
  it('son únicas, llevan usuario e inmueble o anuncio y la extensión del tipo real', () => {
    const a = photoKey(USER, PROPERTY, 'image/jpeg')
    const b = photoKey(USER, PROPERTY, 'image/jpeg')
    expect(a).not.toBe(b)
    expect(a).toMatch(new RegExp(`^u/${USER}/p/${PROPERTY}/photos/[0-9a-f-]{36}\\.jpg$`))
    expect(mediaKey(USER, PROPERTY, 'video', 'video/webm')).toMatch(/\/g\/.+\/video\/.+\.webm$/)
  })

  it.each(['../secreto', 'u/../../etc/passwd', '/absoluta', 'u/a/p/b/photos/x.jpg', 'u/A/p/b/photos/00000000-0000-0000-0000-000000000000.jpg'])('rechaza la clave %s', key => {
    expect(() => assertValidKey(key)).toThrow()
  })

  it('rechaza identificadores con caracteres de ruta y tipos no admitidos', () => {
    expect(() => photoKey('../x', PROPERTY, 'image/jpeg')).toThrow()
    expect(() => photoKey(USER, PROPERTY, 'image/svg+xml')).toThrow()
  })
})

describe('almacenamiento local', () => {
  const storage = new LocalStorage(ROOT)

  it('guarda, lee, lista y borra; no sobrescribe una clave existente', async () => {
    const key = photoKey(USER, PROPERTY, 'image/png')
    await storage.put(key, Buffer.from('uno'))
    await expect(storage.put(key, Buffer.from('dos'))).rejects.toThrow()
    const file = await storage.get(key)
    expect(file?.size).toBe(3)
    expect(file?.contentType).toBe('image/png')
    const chunks: Buffer[] = []
    for await (const chunk of file!.stream) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe('uno')
    expect(await storage.list(`u/${USER}/`)).toContain(key)
    await storage.delete(key)
    await storage.delete(key)
    expect(await storage.get(key)).toBeNull()
  })

  it('rechaza claves fuera de su directorio', async () => {
    await expect(storage.put('../fuera.jpg', Buffer.from('x'))).rejects.toThrow()
    await expect(storage.list('../')).rejects.toThrow()
  })
})

describe('selección del almacenamiento', () => {
  it('local por defecto; nunca en Vercel ni en producción; sin URLs directas salvo que se pida', async () => {
    const local = await createStorage({ STORAGE_LOCAL_DIR: ROOT })
    expect(local.driver).toBe('local')
    expect(local.directTransfers).toBe(false)
    expect((await createStorage({ STORAGE_LOCAL_DIR: ROOT, STORAGE_LOCAL_SIGNED_URLS: '1' })).directTransfers).toBe(true)
    await expect(createStorage({ VERCEL: '1' })).rejects.toBeInstanceOf(StorageConfigError)
    await expect(createStorage({ NODE_ENV: 'production' })).rejects.toBeInstanceOf(StorageConfigError)
  })

  it('STORAGE_PROVIDER es sinónimo de STORAGE_DRIVER; si no coinciden, no arranca; Blob sin credenciales falla', async () => {
    expect((await createStorage({ STORAGE_PROVIDER: 'vercel-blob', BLOB_READ_WRITE_TOKEN: 'ficticio' })).driver).toBe('vercel-blob')
    await expect(createStorage({ STORAGE_PROVIDER: 'vercel-blob', STORAGE_DRIVER: 'local' })).rejects.toBeInstanceOf(StorageConfigError)
    // Producción con Blob sin credenciales: error explícito, nunca disco local.
    await expect(createStorage({ STORAGE_PROVIDER: 'vercel-blob', NODE_ENV: 'production', VERCEL: '1' })).rejects.toBeInstanceOf(StorageConfigError)
  })

  it('vercel-blob exige credenciales del SDK y rechaza controladores desconocidos', async () => {
    await expect(createStorage({ STORAGE_DRIVER: 'vercel-blob' })).rejects.toBeInstanceOf(StorageConfigError)
    expect((await createStorage({ STORAGE_DRIVER: 'vercel-blob', BLOB_READ_WRITE_TOKEN: 'ficticio' })).driver).toBe('vercel-blob')
    await expect(createStorage({ STORAGE_DRIVER: 's3' })).rejects.toBeInstanceOf(StorageConfigError)
  })
})

describe('Vercel Blob (SDK simulado)', () => {
  const storage = new VercelBlobStorage()
  beforeEach(() => Object.values(blob).forEach(fn => fn.mockReset()))

  it('sube en privado, sin sufijo aleatorio y sin sobrescribir', async () => {
    const key = photoKey(USER, PROPERTY, 'image/jpeg')
    await storage.put(key, Buffer.from('x'), 'image/jpeg')
    expect(blob.put).toHaveBeenCalledWith(key, Buffer.from('x'), { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: false })
  })

  it('lee en privado y sin caché; null si no existe', async () => {
    const key = photoKey(USER, PROPERTY, 'image/jpeg')
    blob.get.mockResolvedValueOnce(null)
    expect(await storage.get(key)).toBeNull()
    blob.get.mockResolvedValueOnce({ statusCode: 200, stream: new Blob(['abc']).stream(), headers: new Headers(), blob: { contentType: 'image/jpeg', size: 3 } })
    const file = await storage.get(key)
    expect(blob.get).toHaveBeenLastCalledWith(key, { access: 'private', useCache: false })
    expect(file).toMatchObject({ size: 3, contentType: 'image/jpeg' })
  })

  it('borra por clave y lista con paginación', async () => {
    const key = photoKey(USER, PROPERTY, 'image/jpeg')
    await storage.delete(key)
    expect(blob.del).toHaveBeenCalledWith(key)
    blob.list.mockResolvedValueOnce({ blobs: [{ pathname: 'u/b' }], hasMore: true, cursor: 'c1' }).mockResolvedValueOnce({ blobs: [{ pathname: 'u/a' }], hasMore: false })
    expect(await storage.list('u/')).toEqual(['u/a', 'u/b'])
    expect(blob.list).toHaveBeenLastCalledWith({ prefix: 'u/', cursor: 'c1' })
  })

  it('valida la clave antes de llamar al servicio', async () => {
    await expect(storage.put('../x', Buffer.from('x'), 'image/jpeg')).rejects.toThrow()
    expect(blob.put).not.toHaveBeenCalled()
  })
})

describe('Vercel Blob: URLs firmadas (SDK simulado, DA-58)', () => {
  const storage = new VercelBlobStorage()
  const token = { delegationToken: 'delegacion', clientSigningToken: 'clave-de-firma-secreta', validUntil: 0 }
  beforeEach(() => Object.values(blob).forEach(fn => fn.mockReset()))

  it('PUT: token limitado a la ruta exacta, a put, al tipo, al tamaño y a la expiración; la clave de firma no sale', async () => {
    const key = photoKey(USER, PROPERTY, 'image/jpeg')
    const expiresAt = new Date(Date.now() + 15 * 60_000)
    blob.issueSignedToken.mockResolvedValueOnce({ ...token, validUntil: expiresAt.getTime() })
    blob.presignUrl.mockResolvedValueOnce({ presignedUrl: 'https://vercel.com/api/blob/?pathname=x&vercel-blob-signature=s' })
    const transfer = await storage.presignPut(key, { contentType: 'image/jpeg', maxBytes: 1234, expiresAt })
    expect(blob.issueSignedToken).toHaveBeenCalledWith({ pathname: key, operations: ['put'], validUntil: expiresAt.getTime(), allowedContentTypes: ['image/jpeg'], maximumSizeInBytes: 1234 })
    expect(blob.presignUrl).toHaveBeenCalledWith(expect.objectContaining({ clientSigningToken: 'clave-de-firma-secreta' }), {
      operation: 'put',
      pathname: key,
      access: 'private',
      validUntil: expiresAt.getTime(),
      allowedContentTypes: ['image/jpeg'],
      maximumSizeInBytes: 1234,
      allowOverwrite: false,
      addRandomSuffix: false,
    })
    expect(transfer).toEqual({ method: 'PUT', url: 'https://vercel.com/api/blob/?pathname=x&vercel-blob-signature=s', headers: {} })
    expect(JSON.stringify(transfer)).not.toContain('clave-de-firma-secreta')
  })

  it('GET: delegación de solo lectura reutilizada; cada URL firmada para una ruta y una expiración', async () => {
    const a = photoKey(USER, PROPERTY, 'image/jpeg')
    const b = photoKey(USER, PROPERTY, 'image/png')
    blob.issueSignedToken.mockResolvedValueOnce({ ...token, validUntil: Date.now() + 2 * 60 * 60_000 })
    blob.presignUrl.mockImplementation(async (_t: unknown, options: { pathname: string }) => ({ presignedUrl: `https://store.private.blob.vercel-storage.com/${options.pathname}?sig=1` }))
    const expiresAt = new Date(Date.now() + 10 * 60_000)
    const urlA = await storage.presignGet(a, { expiresAt })
    const urlB = await storage.presignGet(b, { expiresAt })
    expect(blob.issueSignedToken).toHaveBeenCalledTimes(1)
    expect(blob.issueSignedToken.mock.calls[0][0].operations).toEqual(['get'])
    expect(blob.presignUrl.mock.calls.map(call => call[1])).toEqual([
      { operation: 'get', pathname: a, access: 'private', validUntil: expiresAt.getTime() },
      { operation: 'get', pathname: b, access: 'private', validUntil: expiresAt.getTime() },
    ])
    expect(urlA).not.toBe(urlB)
    expect(urlA + urlB).not.toContain('clave-de-firma-secreta')
  })

  it('GET: si la delegación no cubre la expiración pedida, se pide otra', async () => {
    const key = photoKey(USER, PROPERTY, 'image/jpeg')
    const other = new VercelBlobStorage()
    blob.issueSignedToken.mockResolvedValueOnce({ ...token, validUntil: Date.now() + 5 * 60_000 }).mockResolvedValueOnce({ ...token, validUntil: Date.now() + 3 * 60 * 60_000 })
    blob.presignUrl.mockResolvedValue({ presignedUrl: 'https://x/y' })
    await other.presignGet(key, { expiresAt: new Date(Date.now() + 60_000) })
    await other.presignGet(key, { expiresAt: new Date(Date.now() + 90 * 60_000) })
    expect(blob.issueSignedToken).toHaveBeenCalledTimes(2)
  })

  it('HEAD: tamaño y tipo; null si no existe; nunca firma claves no válidas', async () => {
    const key = photoKey(USER, PROPERTY, 'image/jpeg')
    blob.head.mockResolvedValueOnce({ size: 10, contentType: 'image/jpeg' })
    expect(await storage.head(key)).toEqual({ size: 10, contentType: 'image/jpeg' })
    blob.head.mockRejectedValueOnce(new BlobNotFoundError())
    expect(await storage.head(key)).toBeNull()
    await expect(storage.presignGet('../x', { expiresAt: new Date() })).rejects.toThrow()
    await expect(storage.presignPut('u/otro/../x', { contentType: 'image/jpeg', maxBytes: 1, expiresAt: new Date() })).rejects.toThrow()
    expect(blob.presignUrl).not.toHaveBeenCalled()
    expect(storage.directTransfers).toBe(true)
  })
})

describe('URLs firmadas locales (simulador de Blob, DA-58)', () => {
  const signer = new LocalSigner('http://localhost:3999')
  const key = photoKey(USER, PROPERTY, 'image/jpeg')
  const parse = (url: string) => {
    const parsed = new URL(url)
    return { key: parsed.pathname.replace('/api/local-blob/', ''), query: Object.fromEntries(parsed.searchParams) as Record<string, string | undefined> }
  }

  it('una URL vale para su operación, su clave y hasta su expiración', () => {
    const exp = Date.now() + 60_000
    const put = parse(signer.sign({ op: 'put', key, exp, ct: 'image/jpeg', max: 100 }))
    expect(put.key).toBe(key)
    expect(signer.verify(key, put.query, 'put')).toMatchObject({ op: 'put', ct: 'image/jpeg', max: 100 })
    // Una URL de PUT no sirve para GET, ni una de GET para PUT o HEAD.
    expect(signer.verify(key, put.query, 'get')).toBe('invalid')
    const get = parse(signer.sign({ op: 'get', key, exp }))
    expect(signer.verify(key, get.query, 'put')).toBe('invalid')
    expect(signer.verify(key, get.query, 'head')).toBe('invalid')
    expect(signer.verify(key, get.query, 'get')).toMatchObject({ op: 'get' })
  })

  it('no sirve para otra clave, ni con el tipo, el tamaño o la expiración cambiados, ni caducada', () => {
    const exp = Date.now() + 60_000
    const put = parse(signer.sign({ op: 'put', key, exp, ct: 'image/jpeg', max: 100 }))
    expect(signer.verify(photoKey(USER, PROPERTY, 'image/jpeg'), put.query, 'put')).toBe('invalid')
    expect(signer.verify(key, { ...put.query, ct: 'image/png' }, 'put')).toBe('invalid')
    expect(signer.verify(key, { ...put.query, max: '999999' }, 'put')).toBe('invalid')
    expect(signer.verify(key, { ...put.query, exp: String(exp + 60_000) }, 'put')).toBe('invalid')
    expect(signer.verify(key, { ...put.query, sig: undefined }, 'put')).toBe('invalid')
    expect(signer.verify(key, put.query, 'put', exp + 1)).toBe('expired')
  })

  it('otra instancia (otro secreto) no acepta las firmas', () => {
    const other = new LocalSigner('http://localhost:3999')
    const get = parse(signer.sign({ op: 'get', key, exp: Date.now() + 60_000 }))
    expect(other.verify(key, get.query, 'get')).toBe('invalid')
  })

  it('el almacenamiento local firma con el tipo y el tamaño declarados', async () => {
    const storage = new LocalStorage(ROOT, { signer, directTransfers: true })
    const transfer = await storage.presignPut(key, { contentType: 'image/jpeg', maxBytes: 50, expiresAt: new Date(Date.now() + 60_000) })
    expect(transfer.method).toBe('PUT')
    expect(transfer.headers).toEqual({ 'Content-Type': 'image/jpeg' })
    expect(signer.verify(key, parse(transfer.url).query, 'put')).toMatchObject({ ct: 'image/jpeg', max: 50 })
    await expect(storage.presignGet('../fuera', { expiresAt: new Date() })).rejects.toThrow()
  })
})

describe('validación de la configuración al arrancar (DA-58)', () => {
  it('local en desarrollo; vercel-blob con token u OIDC + store', () => {
    expect(storageDriverOf({})).toBe('local')
    expect(storageDriverOf({ STORAGE_PROVIDER: 'vercel-blob', BLOB_READ_WRITE_TOKEN: 'x' })).toBe('vercel-blob')
    expect(storageDriverOf({ STORAGE_DRIVER: 'vercel-blob', VERCEL_OIDC_TOKEN: 'x', BLOB_STORE_ID: 'store' })).toBe('vercel-blob')
  })

  it.each([
    ['producción sin almacenamiento configurado', { NODE_ENV: 'production' }],
    ['disco local dentro de Vercel', { VERCEL: '1', STORAGE_DRIVER: 'local', STORAGE_ALLOW_LOCAL_IN_PRODUCTION: '1' }],
    ['Blob sin credenciales', { NODE_ENV: 'production', STORAGE_DRIVER: 'vercel-blob' }],
    ['Blob con OIDC pero sin store', { STORAGE_DRIVER: 'vercel-blob', VERCEL_OIDC_TOKEN: 'x' }],
    ['valores distintos en STORAGE_DRIVER y STORAGE_PROVIDER', { STORAGE_DRIVER: 'local', STORAGE_PROVIDER: 'vercel-blob' }],
    ['proveedor desconocido', { STORAGE_DRIVER: 's3' }],
  ])('rechaza: %s', (_label, env) => {
    expect(() => storageDriverOf(env as NodeJS.ProcessEnv)).toThrow(StorageConfigError)
  })

  it('el disco local en producción solo con autorización explícita (fuera de Vercel)', () => {
    expect(storageDriverOf({ NODE_ENV: 'production', STORAGE_ALLOW_LOCAL_IN_PRODUCTION: '1' })).toBe('local')
  })

  it('buildApp no arranca con una configuración de almacenamiento no válida', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'vercel-blob')
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    vi.stubEnv('VERCEL_OIDC_TOKEN', '')
    try {
      const { buildApp } = await import('../app.js')
      await expect(buildApp()).rejects.toThrow(StorageConfigError)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
