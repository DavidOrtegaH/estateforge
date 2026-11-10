-- Estado comercial del inmueble. Es opcional a propósito: los inmuebles ya
-- existentes no se pueden clasificar de forma fiable y quedan sin indicar.
ALTER TABLE "Property" ADD COLUMN "commercialStatus" TEXT;

-- Registro manual de las publicaciones de cada anuncio en los portales.
CREATE TABLE "ListingPublication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ListingPublication_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ListingPublication_generationId_platform_key" ON "ListingPublication"("generationId", "platform");
