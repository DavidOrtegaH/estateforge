-- Restricciones que Prisma no representa (DA-14). Se aplican en la línea base de prisma/migrations.
-- apps/api/src/db/postgresql-constraints.test.ts falla si este archivo y la migración divergen.

ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_published_requires_url" CHECK ("isPublished" IS NOT NULL AND ("isPublished" = false OR ("url" IS NOT NULL AND trim("url") <> '')));
ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_instance_key_matches_platform" CHECK ("platform" IS NOT NULL AND "instanceKey" IS NOT NULL AND (("platform" = 'other' AND "instanceKey" <> '') OR ("platform" <> 'other' AND "instanceKey" = '')));
ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_other_position_range" CHECK ("platform" IS NOT NULL AND "position" IS NOT NULL AND (("platform" = 'other' AND "position" BETWEEN 0 AND 4) OR ("platform" <> 'other' AND "position" = 0)));

ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase" CHECK ("email" = lower("email"));

CREATE UNIQUE INDEX "ListingPublication_other_position_key" ON "ListingPublication"("generationId", "position") WHERE "platform" = 'other';

-- Fotografías y material publicitario (DA-46). Se aplican en la migración 20261110120000_add_property_photos_and_listing_media.
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_position_range" CHECK ("position" IS NOT NULL AND "position" BETWEEN 0 AND 15);
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_content_type_allowed" CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_size_range" CHECK ("size" > 0 AND "size" <= 4194304);
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_kind_allowed" CHECK ("kind" IN ('poster', 'video'));
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_content_type_matches_kind" CHECK (("kind" = 'poster' AND "contentType" IN ('image/jpeg', 'image/png')) OR ("kind" = 'video' AND "contentType" IN ('video/webm', 'video/mp4')));
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_size_range" CHECK ("size" > 0 AND "size" <= 4194304);
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_version_positive" CHECK ("version" >= 1);

CREATE UNIQUE INDEX "PropertyPhoto_one_primary_key" ON "PropertyPhoto"("propertyId") WHERE "isPrimary";

-- Respaldo del límite de 16 fotografías: la aplicación ya lo comprueba con el inmueble bloqueado.
CREATE FUNCTION "property_photo_limit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM "PropertyPhoto" WHERE "propertyId" = NEW."propertyId") >= 16 THEN
    RAISE EXCEPTION 'Un inmueble admite como máximo 16 fotografías.' USING ERRCODE = '23514', CONSTRAINT = 'PropertyPhoto_max_16';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PropertyPhoto_max_16" BEFORE INSERT ON "PropertyPhoto" FOR EACH ROW EXECUTE FUNCTION "property_photo_limit"();

-- Cola de limpieza: cada archivo que deja de estar referenciado (borrado, sustitución o cascada).
CREATE FUNCTION "enqueue_storage_cleanup"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey" THEN
    INSERT INTO "StorageCleanup" ("storageKey", "reason") VALUES (OLD."storageKey", TG_TABLE_NAME || ':' || lower(TG_OP)) ON CONFLICT ("storageKey") DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "PropertyPhoto_enqueue_cleanup" AFTER DELETE OR UPDATE OF "storageKey" ON "PropertyPhoto" FOR EACH ROW EXECUTE FUNCTION "enqueue_storage_cleanup"();
CREATE TRIGGER "ListingMedia_enqueue_cleanup" AFTER DELETE OR UPDATE OF "storageKey" ON "ListingMedia" FOR EACH ROW EXECUTE FUNCTION "enqueue_storage_cleanup"();

-- Galería de 50 fotografías, plantillas y audio (DA-51 a DA-55). Se aplican en la migración 20261111120000_gallery_50_poster_templates_audio,
-- que modifica parte del bloque anterior (rango de posiciones y límite de fotografías).
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

-- Subidas directas (DA-58). Se aplican en la migración 20261112120000_direct_uploads.
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

-- BYOK de IA para carteles y vídeos (DA-67 a DA-75). Se aplican en la migración 20261113120000_ai_media_byok.
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

-- BYOK obligatorio también para el texto (DA-77). Se aplica en la migración 20261114120000_ai_text_byok.
ALTER TABLE "AiMediaPreference" ADD CONSTRAINT "AiMediaPreference_text_pair" CHECK (("textProvider" IS NULL) = ("textModel" IS NULL));

-- Catálogo amplio de proveedores (DA-82, DA-83). El proveedor se valida contra el registro de la API.
ALTER TABLE "UserAIKey" DROP CONSTRAINT "UserAIKey_provider_allowed";
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_provider_format" CHECK ("provider" ~ '^[a-z][a-z0-9]{1,23}$');
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_label_format" CHECK (char_length("label") <= 40 AND "label" = btrim("label"));
ALTER TABLE "AiMediaPreference" ADD CONSTRAINT "AiMediaPreference_moderation_pair" CHECK (("moderationProvider" IS NULL) = ("moderationKeyId" IS NULL));

-- Diagnóstico de conexiones y pruebas reales controladas (DA-87, DA-89).
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_check_details_size" CHECK ("lastCheckDetails" IS NULL OR char_length("lastCheckDetails") <= 8000);
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_kind_allowed" CHECK ("kind" IN ('text', 'poster', 'video'));
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_status_allowed" CHECK ("status" IN ('pending', 'submitted', 'processing', 'validating', 'passed', 'failed', 'blocked', 'uncertain', 'cancelled', 'expired'));
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_provider_format" CHECK ("provider" ~ '^[a-z][a-z0-9]{1,23}$');
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_video_duration" CHECK (("kind" = 'video') = ("durationSeconds" IS NOT NULL) AND ("durationSeconds" IS NULL OR "durationSeconds" BETWEEN 1 AND 30));
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_moderation_pair" CHECK (("moderationProvider" IS NULL) = ("moderationKeyId" IS NULL));
ALTER TABLE "AiProviderTrial" ADD CONSTRAINT "AiProviderTrial_counters_range" CHECK ("pollCount" >= 0 AND ("estimatedCostMicroUsd" IS NULL OR "estimatedCostMicroUsd" >= 0) AND char_length("report") <= 16000);

-- Constancia de las ejecuciones del mantenimiento diario (migración 20261118120000_maintenance_runs).
ALTER TABLE "MaintenanceRun" ADD CONSTRAINT "MaintenanceRun_values_allowed" CHECK ("trigger" IN ('vercel-cron', 'manual') AND "status" IN ('ok', 'error') AND "durationMs" >= 0 AND ("storageDeleted" IS NULL OR "storageDeleted" >= 0) AND ("storageFailed" IS NULL OR "storageFailed" >= 0) AND ("auditDeleted" IS NULL OR "auditDeleted" >= 0) AND ("queuePending" IS NULL OR "queuePending" >= 0));

-- Temporary atomic language-change preparations.
ALTER TABLE "GenerationLanguageDraft" ADD CONSTRAINT "GenerationLanguageDraft_status_allowed" CHECK ("status" IN ('pending', 'committed', 'cancelled'));
