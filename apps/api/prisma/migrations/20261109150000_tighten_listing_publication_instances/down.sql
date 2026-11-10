-- Reversión manual: Prisma Migrate no aplica este archivo por sí solo.
-- Vuelve a las restricciones de 20261109140000 y conserva todas las filas.
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

INSERT INTO "new_ListingPublication" SELECT "id", "generationId", "platform", "instanceKey", "isPublished", "url", "customName", "homeUrl", "position", "createdAt", "updatedAt" FROM "ListingPublication";

DROP TABLE "ListingPublication";
ALTER TABLE "new_ListingPublication" RENAME TO "ListingPublication";

CREATE UNIQUE INDEX "ListingPublication_generationId_platform_instanceKey_key" ON "ListingPublication"("generationId", "platform", "instanceKey");
CREATE UNIQUE INDEX "ListingPublication_other_position_key" ON "ListingPublication"("generationId", "position") WHERE "platform" = 'other';

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
