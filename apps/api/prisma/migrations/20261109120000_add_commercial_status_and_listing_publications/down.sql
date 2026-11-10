-- Reversión manual: Prisma Migrate no aplica este archivo por sí solo.
-- ATENCIÓN: elimina el Checklist guardado y el Estado de los inmuebles. Haz una copia antes.
DROP INDEX "ListingPublication_generationId_platform_key";
DROP TABLE "ListingPublication";
ALTER TABLE "Property" DROP COLUMN "commercialStatus";
