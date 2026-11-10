-- Fase 0: verificación del email. Cambio aditivo: no modifica ni borra datos existentes.
-- Las cuentas existentes quedan con emailVerifiedAt = NULL (sin verificar): no hay evidencia
-- de que su email se haya verificado. El periodo de gracia se configura por entorno.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
-- Último enlace emitido: la emisión lo reserva con una escritura condicional atómica, que
-- impone el intervalo mínimo entre enlaces y serializa por cuenta el recuento diario.
ALTER TABLE "User" ADD COLUMN "emailVerificationSentAt" DATETIME;

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_createdAt_idx" ON "EmailVerificationToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");
