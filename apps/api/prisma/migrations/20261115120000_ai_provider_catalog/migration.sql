-- Catálogo amplio de proveedores BYOK (DA-82 a DA-86). Migración aditiva: no borra ni modifica datos.
--  · UserAIKey.label: varias conexiones del mismo proveedor por usuario (la existente queda como principal, '').
--  · La lista cerrada de proveedores pasa a validarse en el registro de la API; aquí queda el formato.
--  · AiMediaPreference: conexión concreta por uso y clasificador de seguridad externo.

-- AlterTable
ALTER TABLE "UserAIKey" ADD COLUMN     "label" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "AiMediaPreference" ADD COLUMN     "moderationKeyId" TEXT,
ADD COLUMN     "moderationProvider" TEXT,
ADD COLUMN     "posterKeyId" TEXT,
ADD COLUMN     "textKeyId" TEXT,
ADD COLUMN     "videoKeyId" TEXT;

-- DropIndex
DROP INDEX "UserAIKey_userId_provider_key";

-- CreateIndex
CREATE UNIQUE INDEX "UserAIKey_userId_provider_label_key" ON "UserAIKey"("userId", "provider", "label");

-- Catálogo amplio de proveedores (DA-82, DA-83). El proveedor se valida contra el registro de la API.
ALTER TABLE "UserAIKey" DROP CONSTRAINT "UserAIKey_provider_allowed";
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_provider_format" CHECK ("provider" ~ '^[a-z][a-z0-9]{1,23}$');
ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_label_format" CHECK (char_length("label") <= 40 AND "label" = btrim("label"));
ALTER TABLE "AiMediaPreference" ADD CONSTRAINT "AiMediaPreference_moderation_pair" CHECK (("moderationProvider" IS NULL) = ("moderationKeyId" IS NULL));
