-- Additive preparation records; existing listings and media are unchanged.
CREATE TABLE "GenerationLanguageDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "generationId" TEXT NOT NULL REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "data" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CONSTRAINT "GenerationLanguageDraft_status_allowed" CHECK ("status" IN ('pending', 'committed', 'cancelled')),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GenerationLanguageDraft_userId_expiresAt_idx" ON "GenerationLanguageDraft"("userId", "expiresAt");
CREATE INDEX "GenerationLanguageDraft_expiresAt_idx" ON "GenerationLanguageDraft"("expiresAt");
ALTER TABLE "UploadAttempt" ADD COLUMN "languageDraftId" TEXT;
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_languageDraftId_fkey"
  FOREIGN KEY ("languageDraftId") REFERENCES "GenerationLanguageDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "UploadAttempt_languageDraftId_idx" ON "UploadAttempt"("languageDraftId");
