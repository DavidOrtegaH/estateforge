-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Property" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT '',
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
    "elevator" BOOLEAN NOT NULL,
    "terrace" BOOLEAN NOT NULL,
    "balcony" BOOLEAN NOT NULL,
    "garage" BOOLEAN NOT NULL,
    "pool" BOOLEAN NOT NULL,
    "garden" BOOLEAN NOT NULL,
    "airConditioning" BOOLEAN NOT NULL,
    "heating" BOOLEAN NOT NULL,
    "additionalInformation" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Property" ("additionalInformation", "address", "airConditioning", "area", "balcony", "bathrooms", "bedrooms", "city", "condition", "createdAt", "elevator", "floor", "garage", "garden", "heating", "id", "neighborhood", "operation", "pool", "price", "terrace", "type", "updatedAt") SELECT "additionalInformation", "address", "airConditioning", "area", "balcony", "bathrooms", "bedrooms", "city", "condition", "createdAt", "elevator", "floor", "garage", "garden", "heating", "id", "neighborhood", "operation", "pool", "price", "terrace", "type", "updatedAt" FROM "Property";
DROP TABLE "Property";
ALTER TABLE "new_Property" RENAME TO "Property";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
