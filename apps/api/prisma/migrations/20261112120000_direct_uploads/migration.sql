-- Subidas directas al almacenamiento con URL firmada (DA-58). Aditiva: una tabla nueva.

-- CreateTable
CREATE TABLE "UploadAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "propertyId" TEXT,
    "photoId" TEXT,
    "generationId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "resultId" TEXT,
    "failure" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "UploadAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadAttempt_storageKey_key" ON "UploadAttempt"("storageKey");

-- CreateIndex
CREATE INDEX "UploadAttempt_userId_status_expiresAt_idx" ON "UploadAttempt"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "UploadAttempt_propertyId_status_idx" ON "UploadAttempt"("propertyId", "status");

-- CreateIndex
CREATE INDEX "UploadAttempt_status_expiresAt_idx" ON "UploadAttempt"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restricciones que Prisma no representa. El mismo bloque está en prisma/postgresql/constraints.sql.
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_kind_allowed" CHECK ("kind" IN ('photo', 'photo-replace', 'thumbnail', 'audio', 'poster', 'video'));
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_status_allowed" CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'expired'));
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_size_range" CHECK ("size" > 0 AND "size" <= 4194304);
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_completed_has_result" CHECK (("status" = 'completed') = ("resultId" IS NOT NULL AND "completedAt" IS NOT NULL));
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_target_matches_kind" CHECK (
  ("kind" IN ('photo') AND "propertyId" IS NOT NULL AND "photoId" IS NULL AND "generationId" IS NULL)
  OR ("kind" IN ('photo-replace', 'thumbnail') AND "propertyId" IS NOT NULL AND "photoId" IS NOT NULL AND "generationId" IS NULL)
  OR ("kind" = 'audio' AND "propertyId" IS NULL AND "photoId" IS NULL AND "generationId" IS NULL)
  OR ("kind" IN ('poster', 'video') AND "generationId" IS NOT NULL AND "photoId" IS NULL)
);

-- Un intento que no llega a confirmarse deja su archivo (si se subió) en la cola de limpieza.
CREATE FUNCTION "enqueue_upload_cleanup"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IN ('failed', 'cancelled', 'expired') AND OLD."status" IN ('pending', 'processing') THEN
    INSERT INTO "StorageCleanup" ("storageKey", "reason") VALUES (NEW."storageKey", 'UploadAttempt:' || NEW."status") ON CONFLICT ("storageKey") DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "UploadAttempt_enqueue_cleanup" AFTER UPDATE OF "status" ON "UploadAttempt" FOR EACH ROW EXECUTE FUNCTION "enqueue_upload_cleanup"();
CREATE TRIGGER "UploadAttempt_delete_enqueue_cleanup" AFTER DELETE ON "UploadAttempt" FOR EACH ROW WHEN (OLD."status" IN ('pending', 'processing')) EXECUTE FUNCTION "enqueue_storage_cleanup"();
