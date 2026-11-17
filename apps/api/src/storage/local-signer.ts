import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// URLs firmadas del almacenamiento local (DA-58): simulan, en desarrollo y en las pruebas, las URLs
// firmadas de Vercel Blob para que el navegador suba y descargue directamente del almacenamiento sin
// pasar por las rutas de la API que comprueban la sesión. Cada URL autoriza un solo tipo de operación
// (put, get o head) sobre una sola clave hasta una fecha, y puede repetirse mientras no caduque; el
// tipo y el tamaño máximo de un PUT también van firmados y un PUT no sobrescribe un archivo existente. El secreto se genera al arrancar (o STORAGE_LOCAL_SIGNING_SECRET) y nunca
// sale del servidor. Solo existe con STORAGE_DRIVER=local: en Vercel no se registran estas rutas.

export type LocalOperation = 'put' | 'get' | 'head'

export interface LocalGrant {
  op: LocalOperation
  key: string
  /** Expiración en ms desde epoch. */
  exp: number
  /** Solo PUT: tipo exacto y tamaño máximo. */
  ct?: string
  max?: number
  /** Solo GET: nombre para descargar como adjunto. */
  dl?: string
}

export const LOCAL_BLOB_PREFIX = '/api/local-blob/'

export class LocalSigner {
  private readonly secret: Buffer
  readonly baseUrl: string

  constructor(baseUrl: string, secret?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.secret = secret && secret.length >= 32 ? Buffer.from(secret) : randomBytes(32)
  }

  private signature(grant: LocalGrant): string {
    const canonical = [grant.op, grant.key, grant.exp, grant.ct ?? '', grant.max ?? '', grant.dl ?? ''].join('\n')
    return createHmac('sha256', this.secret).update(canonical).digest('base64url')
  }

  sign(grant: LocalGrant): string {
    const query = new URLSearchParams({ op: grant.op, exp: String(grant.exp) })
    if (grant.ct) query.set('ct', grant.ct)
    if (grant.max !== undefined) query.set('max', String(grant.max))
    if (grant.dl) query.set('dl', grant.dl)
    query.set('sig', this.signature(grant))
    return `${this.baseUrl}${LOCAL_BLOB_PREFIX}${grant.key}?${query.toString()}`
  }

  /**
   * Comprueba una URL firmada para la operación que se está haciendo (el método HTTP decide la
   * operación: una URL de GET no sirve para PUT ni al revés). Devuelve el permiso o un motivo.
   */
  verify(key: string, query: Record<string, string | undefined>, operation: LocalOperation, now = Date.now()): LocalGrant | 'invalid' | 'expired' {
    const exp = Number(query.exp)
    const grant: LocalGrant = {
      op: query.op as LocalOperation,
      key,
      exp,
      ...(query.ct !== undefined && { ct: query.ct }),
      ...(query.max !== undefined && { max: Number(query.max) }),
      ...(query.dl !== undefined && { dl: query.dl }),
    }
    if (!query.sig || !Number.isFinite(exp) || grant.op !== operation) return 'invalid'
    const expected = Buffer.from(this.signature(grant))
    const received = Buffer.from(query.sig)
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return 'invalid'
    if (exp <= now) return 'expired'
    return grant
  }
}
