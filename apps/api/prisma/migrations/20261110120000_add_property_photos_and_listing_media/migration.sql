-- CreateTable
CREATE TABLE "PropertyPhoto" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PropertyPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingMedia" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "variant" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "photoIds" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ListingMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageCleanup" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "storageKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageCleanup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyPhoto_storageKey_key" ON "PropertyPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "PropertyPhoto_propertyId_position_idx" ON "PropertyPhoto"("propertyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyPhoto_propertyId_sha256_key" ON "PropertyPhoto"("propertyId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ListingMedia_storageKey_key" ON "ListingMedia"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ListingMedia_generationId_kind_key" ON "ListingMedia"("generationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "StorageCleanup_storageKey_key" ON "StorageCleanup"("storageKey");

-- AddForeignKey
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Restricciones que Prisma no representa (DA-46). Copia exacta en prisma/postgresql/constraints.sql.
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
