CREATE TABLE "user_registration_invite_token" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_registration_invite_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_registration_invite_token_token_hash_key" ON "user_registration_invite_token"("token_hash");
CREATE INDEX "user_registration_invite_token_email_idx" ON "user_registration_invite_token"("email");
CREATE INDEX "user_registration_invite_token_expires_at_idx" ON "user_registration_invite_token"("expires_at");
CREATE INDEX "user_registration_invite_token_created_by_user_id_idx" ON "user_registration_invite_token"("created_by_user_id");

ALTER TABLE "user_registration_invite_token"
ADD CONSTRAINT "user_registration_invite_token_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;