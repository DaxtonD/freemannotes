-- AddSupporterFields
ALTER TABLE "user" ADD COLUMN "is_supporter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "supporter_show_public" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "supporter_since" TIMESTAMP(3);
