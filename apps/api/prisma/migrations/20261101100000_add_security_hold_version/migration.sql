-- Additive version counter for security holds; existing accounts, including protected ones, start at 0.
ALTER TABLE "User" ADD COLUMN "securityHoldVersion" INTEGER NOT NULL DEFAULT 0;
