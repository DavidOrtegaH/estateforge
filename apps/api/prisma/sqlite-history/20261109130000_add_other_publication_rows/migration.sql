-- Una plataforma marcada exige ahora un enlace: la versión anterior permitía marcar sin él.
-- Se desmarcan esas filas, sin borrarlas, porque no hay enlace que conservar.
UPDATE "ListingPublication" SET "isPublished" = false WHERE "isPublished" = true AND "url" IS NULL;

-- Filas «Otro/a»: varias por anuncio, cada una con su clave estable. Los portales del catálogo usan ''.
ALTER TABLE "ListingPublication" ADD COLUMN "instanceKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ListingPublication" ADD COLUMN "customName" TEXT;
ALTER TABLE "ListingPublication" ADD COLUMN "homeUrl" TEXT;
ALTER TABLE "ListingPublication" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "ListingPublication_generationId_platform_key";
CREATE UNIQUE INDEX "ListingPublication_generationId_platform_instanceKey_key" ON "ListingPublication"("generationId", "platform", "instanceKey");
