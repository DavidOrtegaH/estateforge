-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL PRIMARY KEY,
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

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "highlights" TEXT NOT NULL,
    "callToAction" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Generation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Generation_propertyId_idx" ON "Generation"("propertyId");
