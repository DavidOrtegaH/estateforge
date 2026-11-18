import { prisma } from '../db/prisma.js'

// Constancia de las ejecuciones autorizadas del mantenimiento diario (tabla MaintenanceRun).
//
// Por qué una tabla: en Vercel Hobby los registros de las funciones se conservan una hora, así que
// una ejecución programada a las 04:00 UTC no se puede acreditar al día siguiente con los registros.
// Cada fila guarda solo contadores, la duración y el disparador declarado; ningún dato personal,
// clave de almacenamiento, cabecera ni secreto. Solo se escriben ejecuciones que superaron la
// autenticación con CRON_SECRET: una petición anónima no puede añadir filas.
//
// Disparador: Vercel Cron llama con `user-agent: vercel-cron/1.0` (documentación de Vercel, «Managing
// Cron Jobs»). Cualquier otra llamada autorizada se anota como «manual». Es una clasificación
// informativa, no un control de seguridad: quien tiene CRON_SECRET podría imitar esa cabecera, y por
// eso el procedimiento de verificación cruza la hora de la fila con las llamadas manuales conocidas.

export const VERCEL_CRON_USER_AGENT = 'vercel-cron/1.0'

export type MaintenanceTrigger = 'vercel-cron' | 'manual'

export interface MaintenanceRunRecord {
  trigger: MaintenanceTrigger
  status: 'ok' | 'error'
  storageDeleted: number | null
  storageFailed: number | null
  auditDeleted: number | null
  queuePending: number | null
  durationMs: number
  startedAt: Date
}

export function maintenanceTrigger(userAgent: unknown): MaintenanceTrigger {
  return userAgent === VERCEL_CRON_USER_AGENT ? 'vercel-cron' : 'manual'
}

/** Archivos que siguen en la cola de limpieza tras la ejecución (para ver si se acumulan). */
export async function countPendingCleanup(): Promise<number> {
  return prisma.storageCleanup.count()
}

export async function recordMaintenanceRun(record: MaintenanceRunRecord): Promise<void> {
  await prisma.maintenanceRun.create({ data: record, select: { id: true } })
}
