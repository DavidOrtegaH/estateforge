-- BYOK obligatorio también para el texto (DA-77). Aditiva: dos columnas nulas y su restricción.

-- AlterTable
ALTER TABLE "AiMediaPreference" ADD COLUMN     "textModel" TEXT,
ADD COLUMN     "textProvider" TEXT;


-- Restricción que Prisma no representa. El mismo bloque está en prisma/postgresql/constraints.sql.
ALTER TABLE "AiMediaPreference" ADD CONSTRAINT "AiMediaPreference_text_pair" CHECK (("textProvider" IS NULL) = ("textModel" IS NULL));
