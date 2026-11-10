-- Integridad del Checklist en la propia base de datos.
--
-- SQLite no permite añadir un CHECK a una tabla existente: hay que reconstruirla.
-- Prisma no modela los CHECK ni los índices parciales. Si una migración futura
-- generada por Prisma reconstruye esta tabla, debe volver a incluirlos; una prueba
-- de integración falla si desaparecen.

-- Datos previos que incumplirían las reglas: se corrigen sin borrar ninguna fila.
UPDATE "ListingPublication" SET "isPublished" = false WHERE "isPublished" = true AND ("url" IS NULL OR trim("url") = '');

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ListingPublication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "instanceKey" TEXT NOT NULL DEFAULT '',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "customName" TEXT,
    "homeUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ListingPublication_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListingPublication_published_requires_url" CHECK ("isPublished" = false OR ("url" IS NOT NULL AND trim("url") <> '')),
    CONSTRAINT "ListingPublication_instance_key_matches_platform" CHECK (("platform" = 'other' AND "instanceKey" <> '') OR ("platform" <> 'other' AND "instanceKey" = '')),
    CONSTRAINT "ListingPublication_other_position_range" CHECK ("platform" <> 'other' OR "position" BETWEEN 0 AND 4)
);

-- Las filas «Otro/a» se numeran de forma compacta por anuncio. Si un anuncio tuviera
-- más de cinco, el CHECK detiene la migración en lugar de descartar datos.
INSERT INTO "new_ListingPublication" ("id", "generationId", "platform", "instanceKey", "isPublished", "url", "customName", "homeUrl", "position", "createdAt", "updatedAt")
SELECT "id", "generationId", "platform", "instanceKey", "isPublished", "url", "customName", "homeUrl",
       CASE WHEN "platform" = 'other'
            THEN ROW_NUMBER() OVER (PARTITION BY "generationId", "platform" ORDER BY "position", "createdAt", "id") - 1
            ELSE "position" END,
       "createdAt", "updatedAt"
FROM "ListingPublication";

DROP TABLE "ListingPublication";
ALTER TABLE "new_ListingPublication" RENAME TO "ListingPublication";

CREATE UNIQUE INDEX "ListingPublication_generationId_platform_instanceKey_key" ON "ListingPublication"("generationId", "platform", "instanceKey");

-- Con posiciones de 0 a 4 y únicas por anuncio, una sexta fila «Otro/a» es imposible.
CREATE UNIQUE INDEX "ListingPublication_other_position_key" ON "ListingPublication"("generationId", "position") WHERE "platform" = 'other';

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
