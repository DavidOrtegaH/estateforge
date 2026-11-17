-- BYOK de IA para carteles y vídeos (DA-67 a DA-75). Aditiva: columnas con valor por defecto, dos tablas nuevas,
-- restricciones y triggers de limpieza. No modifica ni borra datos existentes.

-- AlterTable
ALTER TABLE "ListingMedia" ADD COLUMN     "aiJobId" TEXT,
ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "aiProvider" TEXT,
ADD COLUMN     "generationMode" TEXT NOT NULL DEFAULT 'classic';

-- AlterTable
ALTER TABLE "UserAIKey" ADD COLUMN     "algorithm" TEXT NOT NULL DEFAULT 'aes-256-gcm',
ADD COLUMN     "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "keyHint" TEXT,
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "lastVerifiedAt" TIMESTAMPTZ(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'unverified';

-- CreateTable
CREATE TABLE "AiMediaPreference" (
    "userId" TEXT NOT NULL,
    "posterProvider" TEXT,
    "posterModel" TEXT,
    "videoProvider" TEXT,
    "videoModel" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiMediaPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AiMediaJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "params" TEXT NOT NULL DEFAULT '{}',
    "providerOperationId" TEXT,
    "resultKey" TEXT,
    "resultContentType" TEXT,
    "resultSize" INTEGER,
    "moderationStatus" TEXT NOT NULL DEFAULT 'pending',
    "moderationCategory" TEXT,
    "failureCode" TEXT,
    "estimatedCostMicroUsd" INTEGER,
    "pollCount" INTEGER NOT NULL DEFAULT 0,
    "lastPolledAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiMediaJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiMediaJob_resultKey_key" ON "AiMediaJob"("resultKey");

-- CreateIndex
CREATE INDEX "AiMediaJob_userId_status_idx" ON "AiMediaJob"("userId", "status");

-- CreateIndex
CREATE INDEX "AiMediaJob_generationId_kind_status_idx" ON "AiMediaJob"("generationId", "kind", "status");

-- CreateIndex
CREATE INDEX "AiMediaJob_status_expiresAt_idx" ON "AiMediaJob"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiMediaJob_userId_idempotencyKey_key" ON "AiMediaJob"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AiMediaPreference" ADD CONSTRAINT "AiMediaPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMediaJob" ADD CONSTRAINT "AiMediaJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMediaJob" ADD CONSTRAINT "AiMediaJob_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Restricciones que Prisma no representa. El mismo bloque está en prisma/postgresql/constraints.sql.
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_provider_allowed" CHECK ("provider" IN ('gemini', 'openai', 'simulador'));
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_status_allowed" CHECK ("status" IN ('unverified', 'verified', 'invalid', 'error'));
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_hint_format" CHECK ("keyHint" IS NULL OR "keyHint" ~ '^[A-Za-z0-9_-]{1,8}$');
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_encryption_known" CHECK ("algorithm" = 'aes-256-gcm' AND "encryptionVersion" = 1);
ALTER TABLE "AiMediaPreference" ADD CONSTRAINT "AiMediaPreference_pairs" CHECK ((("posterProvider" IS NULL) = ("posterModel" IS NULL)) AND (("videoProvider" IS NULL) = ("videoModel" IS NULL)));
ALTER TABLE "AiMediaJob" ADD CONSTRAINT "AiMediaJob_kind_allowed" CHECK ("kind" IN ('poster', 'video'));
ALTER TABLE "AiMediaJob" ADD CONSTRAINT "AiMediaJob_status_allowed" CHECK ("status" IN ('pending', 'submitted', 'processing', 'moderating', 'ready', 'accepted', 'rejected', 'cancelled', 'failed', 'blocked', 'expired'));
ALTER TABLE "AiMediaJob" ADD CONSTRAINT "AiMediaJob_moderation_allowed" CHECK ("moderationStatus" IN ('pending', 'passed', 'blocked', 'unavailable'));
ALTER TABLE "AiMediaJob" ADD CONSTRAINT "AiMediaJob_ready_is_moderated" CHECK ("status" NOT IN ('ready', 'accepted') OR ("moderationStatus" = 'passed' AND "resultKey" IS NOT NULL AND "resultSize" > 0));
ALTER TABLE "AiMediaJob" ADD CONSTRAINT "AiMediaJob_blocked_has_category" CHECK ("status" <> 'blocked' OR ("moderationStatus" = 'blocked' AND "moderationCategory" IS NOT NULL));
ALTER TABLE "AiMediaJob" ADD CONSTRAINT "AiMediaJob_counters_range" CHECK ("pollCount" >= 0 AND ("estimatedCostMicroUsd" IS NULL OR "estimatedCostMicroUsd" >= 0) AND "expectedVersion" >= 0);
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_ai_fields" CHECK (("generationMode" = 'classic' AND "aiJobId" IS NULL AND "aiProvider" IS NULL AND "aiModel" IS NULL) OR ("generationMode" = 'ai' AND "aiJobId" IS NOT NULL AND "aiProvider" IS NOT NULL AND "aiModel" IS NOT NULL));

-- El resultado del proveedor es temporal: al cerrar el trabajo (también al aceptarlo, porque el material
-- guardado es la composición final) o al borrarlo, su archivo entra en la cola de limpieza.
CREATE FUNCTION "enqueue_ai_result_cleanup"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."resultKey" IS NOT NULL THEN
      INSERT INTO "StorageCleanup" ("storageKey", "reason") VALUES (OLD."resultKey", 'AiMediaJob:deleted') ON CONFLICT ("storageKey") DO NOTHING;
    END IF;
    RETURN NULL;
  END IF;
  IF NEW."resultKey" IS NOT NULL AND NEW."status" IN ('accepted', 'rejected', 'cancelled', 'failed', 'blocked', 'expired')
     AND OLD."status" NOT IN ('accepted', 'rejected', 'cancelled', 'failed', 'blocked', 'expired') THEN
    INSERT INTO "StorageCleanup" ("storageKey", "reason") VALUES (NEW."resultKey", 'AiMediaJob:' || NEW."status") ON CONFLICT ("storageKey") DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "AiMediaJob_enqueue_cleanup" AFTER UPDATE OF "status" ON "AiMediaJob" FOR EACH ROW EXECUTE FUNCTION "enqueue_ai_result_cleanup"();
CREATE TRIGGER "AiMediaJob_delete_enqueue_cleanup" AFTER DELETE ON "AiMediaJob" FOR EACH ROW EXECUTE FUNCTION "enqueue_ai_result_cleanup"();
