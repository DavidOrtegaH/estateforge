-- Additive fields for mandatory password recovery after a security incident (E2).
-- Existing users and tokens keep their behaviour: new columns are NULL, and existing
-- password reset tokens become 'SELF_SERVICE' through the column default.
ALTER TABLE "User" ADD COLUMN "passwordResetRequiredAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "securityRecoveryEmail" TEXT;
ALTER TABLE "SecurityIncidentToken" ADD COLUMN "notifiedEmail" TEXT;
ALTER TABLE "PasswordResetToken" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'SELF_SERVICE';
ALTER TABLE "PasswordResetToken" ADD COLUMN "deliverTo" TEXT;
ALTER TABLE "PasswordResetToken" ADD COLUMN "securityHoldVersion" INTEGER;
