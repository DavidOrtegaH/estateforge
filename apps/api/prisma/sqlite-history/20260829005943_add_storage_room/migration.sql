/*
  Warnings:

  - You are about to drop the column `callToAction` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `highlights` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `language` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `tone` on the `Generation` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Generation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Generation" ("createdAt", "id", "propertyId") SELECT "createdAt", "id", "propertyId" FROM "Generation";
DROP TABLE "Generation";
ALTER TABLE "new_Generation" RENAME TO "Generation";
CREATE TABLE "new_Property" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "area" REAL NOT NULL,
    "bedrooms" INTEGER NOT NULL,
    "bathrooms" INTEGER NOT NULL,
    "floor" INTEGER,
    "condition" TEXT NOT NULL,
    "elevator" BOOLEAN NOT NULL DEFAULT false,
    "terrace" BOOLEAN NOT NULL DEFAULT false,
    "balcony" BOOLEAN NOT NULL DEFAULT false,
    "garage" BOOLEAN NOT NULL DEFAULT false,
    "storageRoom" BOOLEAN NOT NULL DEFAULT false,
    "pool" BOOLEAN NOT NULL DEFAULT false,
    "garden" BOOLEAN NOT NULL DEFAULT false,
    "airConditioning" BOOLEAN NOT NULL DEFAULT false,
    "heating" BOOLEAN NOT NULL DEFAULT false,
    "additionalInformation" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Property" ("additionalInformation", "address", "airConditioning", "area", "balcony", "bathrooms", "bedrooms", "city", "condition", "createdAt", "elevator", "floor", "garage", "garden", "heating", "id", "neighborhood", "operation", "pool", "price", "terrace", "title", "type", "updatedAt") SELECT "additionalInformation", "address", "airConditioning", "area", "balcony", "bathrooms", "bedrooms", "city", "condition", "createdAt", "elevator", "floor", "garage", "garden", "heating", "id", "neighborhood", "operation", "pool", "price", "terrace", "title", "type", "updatedAt" FROM "Property";
DROP TABLE "Property";
ALTER TABLE "new_Property" RENAME TO "Property";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
