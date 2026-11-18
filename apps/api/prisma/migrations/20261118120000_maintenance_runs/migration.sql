-- Constancia de las ejecuciones del mantenimiento diario. Migración aditiva: una tabla nueva; no borra
-- ni modifica datos. Solo contadores, duración y el disparador declarado (sin datos personales ni secretos).

-- CreateTable
CREATE TABLE "MaintenanceRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "storageDeleted" INTEGER,
    "storageFailed" INTEGER,
    "auditDeleted" INTEGER,
    "queuePending" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceRun_startedAt_idx" ON "MaintenanceRun"("startedAt");

-- Restricciones que Prisma no representa. El mismo bloque está en prisma/postgresql/constraints.sql.
ALTER TABLE "MaintenanceRun" ADD CONSTRAINT "MaintenanceRun_values_allowed" CHECK ("trigger" IN ('vercel-cron', 'manual') AND "status" IN ('ok', 'error') AND "durationMs" >= 0 AND ("storageDeleted" IS NULL OR "storageDeleted" >= 0) AND ("storageFailed" IS NULL OR "storageFailed" >= 0) AND ("auditDeleted" IS NULL OR "auditDeleted" >= 0) AND ("queuePending" IS NULL OR "queuePending" >= 0));
