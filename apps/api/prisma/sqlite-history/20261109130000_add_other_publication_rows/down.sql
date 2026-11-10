-- Reversión manual: Prisma Migrate no aplica este archivo por sí solo.
-- ATENCIÓN: elimina las filas «Otro/a», cuyos datos no caben en el esquema anterior. Haz una copia antes.
-- Las filas que la migración desmarcó por no tener enlace no vuelven a marcarse.
DELETE FROM "ListingPublication" WHERE "platform" = 'other';
DROP INDEX "ListingPublication_generationId_platform_instanceKey_key";
CREATE UNIQUE INDEX "ListingPublication_generationId_platform_key" ON "ListingPublication"("generationId", "platform");
ALTER TABLE "ListingPublication" DROP COLUMN "position";
ALTER TABLE "ListingPublication" DROP COLUMN "homeUrl";
ALTER TABLE "ListingPublication" DROP COLUMN "customName";
ALTER TABLE "ListingPublication" DROP COLUMN "instanceKey";
