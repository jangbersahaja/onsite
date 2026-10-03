ALTER TABLE "account" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "account" CASCADE;--> statement-breakpoint
DROP TABLE "verification" CASCADE;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "outlet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "password_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_lower_uq" ON "user" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_uq" ON "user" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "email_verified";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "image";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "global_role";--> statement-breakpoint
DROP TYPE "public"."global_role";