-- Hand-edited: copy every guest's existing token into auth_tokens before the
-- column goes, so nobody is signed out by this deploy.
INSERT INTO "auth_tokens" ("token_hash", "user_id", "created_at")
SELECT "token_hash", "id", "created_at" FROM "users";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_token_hash_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "token_hash";
