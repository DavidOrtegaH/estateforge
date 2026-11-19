import { createHash, timingSafeEqual } from 'node:crypto'

import type { FastifyInstance } from 'fastify'

import { expireLanguageDrafts } from '../media/language-draft.js'
import { drainStorageCleanup } from '../media/storage-cleanup.js'
import { AUDIT_RETENTION_BATCH, purgeExpiredAuditLogs } from '../services/audit-retention.service.js'
import { safeErrorName } from '../services/log-safety.js'
import { countPendingCleanup, maintenanceTrigger, recordMaintenanceRun, type MaintenanceRunRecord } from '../services/maintenance-run.service.js'

// Mantenimiento programado (Vercel Cron). Dos tareas independientes, cada una con un lote acotado:
//
// 1) Procesar un lote de la cola EXISTENTE StorageCleanup (archivos que los triggers de PostgreSQL ya marcaron para borrar) con
// drainStorageCleanup, el mismo mecanismo que usan las rutas y `pnpm --filter api storage:cleanup`.
// Ese mecanismo vuelve a comprobar que el archivo no esté referenciado (fotografía, miniatura,
// material, pista, subida en curso o resultado de IA pendiente) antes de borrarlo.
//
// 2) Retención de AdminAuditLog (90 días desde createdAt, política autorizada por el propietario;
// services/audit-retention.service.ts): un lote de registros caducados, conservando los de cuentas
// con un incidente abierto.
//
// Lo que esta ruta NO hace: no busca ni borra huérfanos (findOrphans) y no toca sesiones, tokens ni cuentas. También caduca preparaciones temporales de idioma
// y sus subidas asociadas; la retención de auditoría solo afecta a AdminAuditLog.
//
// Autenticación: Vercel Cron envía `Authorization: Bearer <CRON_SECRET>`. Fallo cerrado: sin
// CRON_SECRET (o demasiado corto) la ruta responde 503 y no hace nada; con una cabecera distinta,
// 401. La comparación es en tiempo constante sobre resúmenes SHA-256 de igual longitud.
//
// Observabilidad (services/maintenance-run.service.ts): cada ejecución autorizada escribe una línea de
// registro con campos cerrados y una fila en MaintenanceRun con el disparador (Vercel Cron o manual),
// los contadores y la duración. Si esa constancia falla, el mantenimiento y su respuesta no cambian.

export const STORAGE_CLEANUP_CRON_PATH = '/api/internal/cron/storage-cleanup'
// Lote acotado por invocación: una sola llamada a drainStorageCleanup, sin bucle. Lo que quede
// pendiente se procesa en la siguiente ejecución diaria o con el script manual.
export const STORAGE_CLEANUP_CRON_BATCH = 50
// Vercel recomienda un valor aleatorio de al menos 16 caracteres.
export const CRON_SECRET_MIN_LENGTH = 16

type Drain = typeof drainStorageCleanup
type PurgeAudit = (options: { batchSize: number }) => Promise<{ deleted: number }>

export interface MaintenanceRoutesOptions {
  /** Variables de entorno (por defecto process.env); se leen en cada petición. */
  expireDrafts?: () => Promise<number>
  env?: NodeJS.ProcessEnv
  /** Solo para pruebas: por defecto, drainStorageCleanup. */
  drain?: Drain
  /** Solo para pruebas: por defecto, purgeExpiredAuditLogs. */
  purgeAudit?: PurgeAudit
  /** Solo para pruebas: por defecto, recordMaintenanceRun. */
  recordRun?: (record: MaintenanceRunRecord) => Promise<void>
  /** Solo para pruebas: por defecto, countPendingCleanup. */
  countPending?: () => Promise<number>
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** Secreto utilizable o null si falta o es demasiado corto (fallo cerrado). */
export function configuredCronSecret(env: NodeJS.ProcessEnv): string | null {
  const secret = env.CRON_SECRET
  if (typeof secret !== 'string' || secret.trim().length < CRON_SECRET_MIN_LENGTH) return null
  return secret
}

/** Compara `Authorization` con `Bearer <secret>` en tiempo constante. */
export function cronAuthorizationMatches(header: unknown, secret: string): boolean {
  if (typeof header !== 'string') return false
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}

export async function maintenanceRoutes(app: FastifyInstance, options: MaintenanceRoutesOptions = {}) {
  const env = options.env ?? process.env
  const expireDrafts = options.expireDrafts ?? expireLanguageDrafts
  const drain = options.drain ?? drainStorageCleanup
  const purgeAudit = options.purgeAudit ?? purgeExpiredAuditLogs
  const recordRun = options.recordRun ?? recordMaintenanceRun
  const countPending = options.countPending ?? countPendingCleanup

  app.get(
    STORAGE_CLEANUP_CRON_PATH,
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')

      const secret = configuredCronSecret(env)
      if (secret === null) {
        request.log.error('CRON_SECRET no está configurado: la limpieza programada no se ejecuta')
        return reply.code(503).send({ status: 'unavailable' })
      }

      if (!cronAuthorizationMatches(request.headers.authorization, secret)) {
        return reply.code(401).send({ status: 'unauthorized' })
      }

      const startedAt = new Date()
      const started = performance.now()

      let draftCleanupFailed = false
      try { await expireDrafts() } catch (error) {
        draftCleanupFailed = true
        request.log.error({ errorName: safeErrorName(error) }, 'No se han podido caducar las preparaciones de idioma')
      }

      // Las dos tareas se ejecutan aunque falle la otra; cualquier fallo responde 500 sin detalles.
      let storage: { deleted: number; failed: number } | null = null
      try {
        // Sin claves: los más antiguos de la cola, como mucho STORAGE_CLEANUP_CRON_BATCH.
        storage = await drain(request.log, undefined, STORAGE_CLEANUP_CRON_BATCH)
      } catch (error) {
        // drainStorageCleanup no lanza; esto es solo una defensa adicional.
        request.log.error({ errorName: safeErrorName(error) }, 'La limpieza programada no ha podido completarse')
      }

      let auditDeleted: number | null = null
      try {
        auditDeleted = (await purgeAudit({ batchSize: AUDIT_RETENTION_BATCH })).deleted
      } catch (error) {
        // Fallo seguro: la transacción se deshace y ese lote no se borra; se reintenta al día
        // siguiente con el mismo umbral de 90 días. Solo el nombre del error, nunca su mensaje.
        request.log.error({ errorName: safeErrorName(error) }, 'La retención de la auditoría no ha podido completarse')
      }

      let queuePending: number | null = null
      try {
        queuePending = await countPending()
      } catch (error) {
        request.log.warn({ errorName: safeErrorName(error) }, 'No se pudo contar la cola de limpieza tras el mantenimiento')
      }

      const record: MaintenanceRunRecord = {
        trigger: maintenanceTrigger(request.headers['user-agent']),
        status: storage === null || auditDeleted === null || draftCleanupFailed ? 'error' : 'ok',
        storageDeleted: storage?.deleted ?? null,
        storageFailed: storage?.failed ?? null,
        auditDeleted,
        queuePending,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        startedAt,
      }
      // Campos cerrados: ni cabeceras, ni claves de almacenamiento, ni identificadores de cuentas.
      request.log.info({ maintenance: { ...record, startedAt: startedAt.toISOString() } }, 'Mantenimiento diario ejecutado')
      try {
        await recordRun(record)
      } catch (error) {
        request.log.error({ errorName: safeErrorName(error) }, 'No se pudo dejar constancia de la ejecución del mantenimiento')
      }

      if (storage === null || auditDeleted === null || draftCleanupFailed) return reply.code(500).send({ status: 'error' })
      return { status: 'ok', deleted: storage.deleted, failed: storage.failed, auditDeleted }
    },
  )
}
