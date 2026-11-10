-- AdminAuditLog.actorUserId pasa a admitir NULL (acciones sin un actor autenticado, como la
-- solicitud pública de un enlace de recuperación, E2.6). SQLite no permite quitar NOT NULL con
-- ALTER COLUMN, así que la tabla se reconstruye: misma definición salvo esa columna, copia de
-- todas las filas con sus valores, sustitución y recreación de los dos índices. La tabla no
-- tiene claves foráneas, restricciones adicionales ni triggers. SQL generado por
-- `prisma migrate diff` a partir del esquema anterior y el nuevo.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdminAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "targetUserId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AdminAuditLog" ("action", "actorUserId", "createdAt", "id", "metadata", "reason", "targetUserId") SELECT "action", "actorUserId", "createdAt", "id", "metadata", "reason", "targetUserId" FROM "AdminAuditLog";
DROP TABLE "AdminAuditLog";
ALTER TABLE "new_AdminAuditLog" RENAME TO "AdminAuditLog";
CREATE INDEX "AdminAuditLog_actorUserId_createdAt_idx" ON "AdminAuditLog"("actorUserId", "createdAt");
CREATE INDEX "AdminAuditLog_targetUserId_createdAt_idx" ON "AdminAuditLog"("targetUserId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
