-- Additive security recovery fields; existing account data and relations remain intact.
ALTER TABLE "User" ADD COLUMN "securityHoldAt" DATETIME;

CREATE TABLE "SecurityIncidentToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityIncidentToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SecurityIncidentToken_tokenHash_key" ON "SecurityIncidentToken"("tokenHash");
CREATE INDEX "SecurityIncidentToken_userId_idx" ON "SecurityIncidentToken"("userId");
CREATE INDEX "SecurityIncidentToken_expiresAt_idx" ON "SecurityIncidentToken"("expiresAt");
