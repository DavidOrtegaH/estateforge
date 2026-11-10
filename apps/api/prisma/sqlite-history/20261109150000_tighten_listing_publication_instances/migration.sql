-- Refuerza las restricciones del Checklist: un portal no tiene posición propia (siempre 0)
-- y cada CHECK exige explícitamente sus columnas, sin depender de que sean NOT NULL.
-- Debe coincidir con prisma/postgresql/constraints.sql (DA-14).

UPDATE "ListingPublication" SET "position" = 0 WHERE "platform" <> 'other' AND "position" <> 0;

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
    CONSTRAINT "ListingPublication_published_requires_url" CHECK ("isPublished" IS NOT NULL AND ("isPublished" = false OR ("url" IS NOT NULL AND trim("url") <> ''))),
    CONSTRAINT "ListingPublication_instance_key_matches_platform" CHECK ("platform" IS NOT NULL AND "instanceKey" IS NOT NULL AND (("platform" = 'other' AND "instanceKey" <> '') OR ("platform" <> 'other' AND "instanceKey" = ''))),
    CONSTRAINT "ListingPublication_other_position_range" CHECK ("platform" IS NOT NULL AND "position" IS NOT NULL AND (("platform" = 'other' AND "position" BETWEEN 0 AND 4) OR ("platform" <> 'other' AND "position" = 0)))
);

INSERT INTO "new_ListingPublication" SELECT "id", "generationId", "platform", "instanceKey", "isPublished", "url", "customName", "homeUrl", "position", "createdAt", "updatedAt" FROM "ListingPublication";

DROP TABLE "ListingPublication";
ALTER TABLE "new_ListingPublication" RENAME TO "ListingPublication";

CREATE UNIQUE INDEX "ListingPublication_generationId_platform_instanceKey_key" ON "ListingPublication"("generationId", "platform", "instanceKey");
CREATE UNIQUE INDEX "ListingPublication_other_position_key" ON "ListingPublication"("generationId", "position") WHERE "platform" = 'other';

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
