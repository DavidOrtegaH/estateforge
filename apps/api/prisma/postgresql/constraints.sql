-- Restricciones que Prisma no representa (DA-14). Se aplican en la línea base de prisma/migrations.
-- apps/api/src/db/postgresql-constraints.test.ts falla si este archivo y la migración divergen.

ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_published_requires_url" CHECK ("isPublished" IS NOT NULL AND ("isPublished" = false OR ("url" IS NOT NULL AND trim("url") <> '')));
ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_instance_key_matches_platform" CHECK ("platform" IS NOT NULL AND "instanceKey" IS NOT NULL AND (("platform" = 'other' AND "instanceKey" <> '') OR ("platform" <> 'other' AND "instanceKey" = '')));
ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_other_position_range" CHECK ("platform" IS NOT NULL AND "position" IS NOT NULL AND (("platform" = 'other' AND "position" BETWEEN 0 AND 4) OR ("platform" <> 'other' AND "position" = 0)));

ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase" CHECK ("email" = lower("email"));

CREATE UNIQUE INDEX "ListingPublication_other_position_key" ON "ListingPublication"("generationId", "position") WHERE "platform" = 'other';
