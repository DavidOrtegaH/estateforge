-- Diagnóstico de conexiones y pruebas reales controladas de proveedores (DA-87 a DA-89). Migración aditiva:
-- no borra ni modifica datos.
--  · UserAIKey.lastCheckDetails: resultado de la última comprobación, sin secretos.
--  · AiProviderTrial: pruebas reales confirmadas por el usuario, con datos sintéticos y sin guardar el resultado.

-- AlterTable
ALTER TABLE "UserAIKey" ADD COLUMN     "lastCheckDetails" TEXT;

-- CreateTable
CREATE TABLE "AiProviderTrial" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "estimatedCostMicroUsd" INTEGER,
    "contractVersion" TEXT NOT NULL,
    "moderationProvider" TEXT,
    "moderationKeyId" TEXT,
    "providerOperationId" TEXT,
    "failureCode" TEXT,
    "report" TEXT NOT NULL DEFAULT '{}',
    "pollCount" INTEGER NOT NULL DEFAULT 0,
    "lastPolledAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiProviderTrial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProviderTrial_userId_createdAt_idx" ON "AiProviderTrial"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiProviderTrial_userId_status_idx" ON "AiProviderTrial"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderTrial_userId_idempotencyKey_key" ON "AiProviderTrial"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "UserAIKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Diagnóstico de conexiones y pruebas reales controladas (DA-87, DA-89).
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_check_details_size" CHECK ("lastCheckDetails" IS NULL OR char_length("lastCheckDetails") <= 8000);
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_kind_allowed" CHECK ("kind" IN ('text', 'poster', 'video'));
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_status_allowed" CHECK ("status" IN ('pending', 'submitted', 'processing', 'validating', 'passed', 'failed', 'blocked', 'uncertain', 'cancelled', 'expired'));
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_provider_format" CHECK ("provider" ~ '^[a-z][a-z0-9]{1,23}$');
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_video_duration" CHECK (("kind" = 'video') = ("durationSeconds" IS NOT NULL) AND ("durationSeconds" IS NULL OR "durationSeconds" BETWEEN 1 AND 30));
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_moderation_pair" CHECK (("moderationProvider" IS NULL) = ("moderationKeyId" IS NULL));
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_counters_range" CHECK ("pollCount" >= 0 AND ("estimatedCostMicroUsd" IS NULL OR "estimatedCostMicroUsd" >= 0) AND char_length("report") <= 16000);
