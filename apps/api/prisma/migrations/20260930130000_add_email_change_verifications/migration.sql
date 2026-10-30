-- CreateTable
CREATE TABLE "EmailChangeVerification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailChangeVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeVerification_codeHash_key" ON "EmailChangeVerification"("codeHash");

-- CreateIndex
CREATE INDEX "EmailChangeVerification_userId_idx" ON "EmailChangeVerification"("userId");

-- CreateIndex
CREATE INDEX "EmailChangeVerification_newEmail_idx" ON "EmailChangeVerification"("newEmail");

-- CreateIndex
CREATE INDEX "EmailChangeVerification_expiresAt_idx" ON "EmailChangeVerification"("expiresAt");
