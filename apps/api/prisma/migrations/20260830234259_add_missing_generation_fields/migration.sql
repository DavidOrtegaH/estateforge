/*
  Warnings:

  - Added the required column `highlights` to the `Generation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `Generation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `provider` to the `Generation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tone` to the `Generation` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "highlights" TEXT NOT NULL,
    "callToAction" TEXT,
    "provider" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Generation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Generation" ("createdAt", "description", "id", "propertyId", "title", "updatedAt") SELECT "createdAt", "description", "id", "propertyId", "title", "updatedAt" FROM "Generation";
DROP TABLE "Generation";
ALTER TABLE "new_Generation" RENAME TO "Generation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
