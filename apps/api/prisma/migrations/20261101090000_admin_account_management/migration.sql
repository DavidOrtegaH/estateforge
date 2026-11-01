-- Phase 2: additive administrative suspension and audit trail.
-- Existing users, properties, generations, credentials and AI keys are preserved.
ALTER TABLE "User" ADD COLUMN "adminSuspendedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "adminSuspensionReason" TEXT;

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminAuditLog_actorUserId_createdAt_idx" ON "AdminAuditLog"("actorUserId", "createdAt");
CREATE INDEX "AdminAuditLog_targetUserId_createdAt_idx" ON "AdminAuditLog"("targetUserId", "createdAt");
