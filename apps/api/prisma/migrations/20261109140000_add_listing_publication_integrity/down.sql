-- Reversión manual: Prisma Migrate no aplica este archivo por sí solo.
-- Retira las restricciones y conserva todas las filas. Las correcciones de datos no se deshacen.
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
    CONSTRAINT "ListingPublication_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_ListingPublication" SELECT "id", "generationId", "platform", "instanceKey", "isPublished", "url", "customName", "homeUrl", "position", "createdAt", "updatedAt" FROM "ListingPublication";

DROP TABLE "ListingPublication";
ALTER TABLE "new_ListingPublication" RENAME TO "ListingPublication";

CREATE UNIQUE INDEX "ListingPublication_generationId_platform_instanceKey_key" ON "ListingPublication"("generationId", "platform", "instanceKey");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
