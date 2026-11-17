-- Galería de 50 fotografías con miniaturas, plantillas de cartel con selección aleatoria y audio de los vídeos (DA-51 a DA-55).
-- Aditiva: no borra ni transforma datos. Los carteles y vídeos existentes quedan sin plantilla y sin audio.

-- AlterTable
ALTER TABLE "ListingMedia" ADD COLUMN     "audioFadeInMs" INTEGER,
ADD COLUMN     "audioFadeOutMs" INTEGER,
ADD COLUMN     "audioName" TEXT,
ADD COLUMN     "audioSource" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "audioTrackId" TEXT,
ADD COLUMN     "audioVolume" INTEGER,
ADD COLUMN     "codecs" TEXT,
ADD COLUMN     "hasAudio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selectionMode" TEXT,
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateVersion" INTEGER;

-- AlterTable
ALTER TABLE "PropertyPhoto" ADD COLUMN     "thumbKey" TEXT,
ADD COLUMN     "thumbSize" INTEGER;

-- CreateTable
CREATE TABLE "MediaTemplateDraw" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "MediaTemplateDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioTrack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaTemplateDraw_generationId_createdAt_idx" ON "MediaTemplateDraw"("generationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AudioTrack_storageKey_key" ON "AudioTrack"("storageKey");

-- CreateIndex
CREATE INDEX "AudioTrack_userId_createdAt_idx" ON "AudioTrack"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AudioTrack_userId_sha256_key" ON "AudioTrack"("userId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyPhoto_thumbKey_key" ON "PropertyPhoto"("thumbKey");

-- AddForeignKey
ALTER TABLE "MediaTemplateDraw" ADD CONSTRAINT "MediaTemplateDraw_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restricciones y triggers que Prisma no representa. El mismo bloque está en prisma/postgresql/constraints.sql.
ALTER TABLE "PropertyPhoto" DROP CONSTRAINT "PropertyPhoto_position_range";
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_position_range" CHECK ("position" IS NOT NULL AND "position" BETWEEN 0 AND 49);
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_thumb_consistent" CHECK (("thumbKey" IS NULL AND "thumbSize" IS NULL) OR ("thumbKey" IS NOT NULL AND "thumbSize" > 0 AND "thumbSize" <= 262144));
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_template_fields" CHECK (("templateId" IS NULL AND "templateVersion" IS NULL AND "selectionMode" IS NULL) OR ("kind" = 'poster' AND "templateId" IS NOT NULL AND "templateVersion" >= 1 AND "selectionMode" IN ('manual', 'random')));
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_audio_fields" CHECK ("audioSource" IN ('none', 'preset', 'library') AND "hasAudio" = ("audioSource" <> 'none') AND ("kind" = 'video' OR "audioSource" = 'none') AND (("audioSource" = 'none' AND "audioTrackId" IS NULL AND "audioName" IS NULL AND "audioVolume" IS NULL AND "audioFadeInMs" IS NULL AND "audioFadeOutMs" IS NULL) OR ("audioSource" <> 'none' AND "audioTrackId" IS NOT NULL AND "audioVolume" BETWEEN 0 AND 100 AND "audioFadeInMs" BETWEEN 0 AND 5000 AND "audioFadeOutMs" BETWEEN 0 AND 5000)));
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_format_allowed" CHECK (("format" = 'mp3' AND "contentType" = 'audio/mpeg') OR ("format" = 'wav' AND "contentType" = 'audio/wav') OR ("format" = 'ogg' AND "contentType" = 'audio/ogg') OR ("format" = 'm4a' AND "contentType" = 'audio/mp4'));
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_size_range" CHECK ("size" > 0 AND "size" <= 4194304);
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_duration_range" CHECK ("durationMs" BETWEEN 1000 AND 300000);
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_name_length" CHECK (length("name") BETWEEN 1 AND 120);
ALTER TABLE "MediaTemplateDraw" ADD CONSTRAINT "MediaTemplateDraw_version_positive" CHECK ("templateVersion" >= 1);

-- Respaldo del límite de 50 fotografías (DA-51): la aplicación ya lo comprueba con el inmueble bloqueado.
CREATE OR REPLACE FUNCTION "property_photo_limit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM "PropertyPhoto" WHERE "propertyId" = NEW."propertyId") >= 50 THEN
    RAISE EXCEPTION 'Un inmueble admite como máximo 50 fotografías.' USING ERRCODE = '23514', CONSTRAINT = 'PropertyPhoto_max_photos';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER "PropertyPhoto_max_16" ON "PropertyPhoto";
CREATE TRIGGER "PropertyPhoto_max_photos" BEFORE INSERT ON "PropertyPhoto" FOR EACH ROW EXECUTE FUNCTION "property_photo_limit"();

-- Respaldo del límite de 20 pistas por usuario (DA-55).
CREATE FUNCTION "audio_track_limit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM "AudioTrack" WHERE "userId" = NEW."userId") >= 20 THEN
    RAISE EXCEPTION 'Un usuario admite como máximo 20 pistas de audio.' USING ERRCODE = '23514', CONSTRAINT = 'AudioTrack_max_tracks';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AudioTrack_max_tracks" BEFORE INSERT ON "AudioTrack" FOR EACH ROW EXECUTE FUNCTION "audio_track_limit"();

-- Cola de limpieza: miniaturas que dejan de usarse y pistas de audio borradas o sustituidas.
CREATE FUNCTION "enqueue_photo_thumb_cleanup"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."thumbKey" IS NOT NULL AND (TG_OP = 'DELETE' OR NEW."thumbKey" IS DISTINCT FROM OLD."thumbKey") THEN
    INSERT INTO "StorageCleanup" ("storageKey", "reason") VALUES (OLD."thumbKey", 'PropertyPhoto:thumb:' || lower(TG_OP)) ON CONFLICT ("storageKey") DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "PropertyPhoto_enqueue_thumb_cleanup" AFTER DELETE OR UPDATE OF "thumbKey" ON "PropertyPhoto" FOR EACH ROW EXECUTE FUNCTION "enqueue_photo_thumb_cleanup"();
CREATE TRIGGER "AudioTrack_enqueue_cleanup" AFTER DELETE OR UPDATE OF "storageKey" ON "AudioTrack" FOR EACH ROW EXECUTE FUNCTION "enqueue_storage_cleanup"();
