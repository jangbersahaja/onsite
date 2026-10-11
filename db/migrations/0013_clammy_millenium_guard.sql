ALTER TABLE "invitations" DROP CONSTRAINT "invitations_outlet_id_outlets_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "account_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "account_type" SET DEFAULT 'user'::text;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "account_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "account_type" SET DEFAULT 'user'::text;--> statement-breakpoint
UPDATE "user" SET "can_access_backoffice" = true WHERE "account_type" = 'admin' OR "id" IN (SELECT "user_id" FROM "outlet_memberships" WHERE "role" = 'manager');--> statement-breakpoint
UPDATE "user" SET "account_type" = 'user' WHERE "account_type" IN ('admin', 'staff');--> statement-breakpoint
UPDATE "invitations" SET "can_access_backoffice" = true WHERE "account_type" = 'admin' OR "role" = 'manager';--> statement-breakpoint
UPDATE "invitations" SET "account_type" = 'user' WHERE "account_type" IN ('admin', 'staff');--> statement-breakpoint
INSERT INTO "invitation_outlets" ("invitation_id", "outlet_id") SELECT "id", "outlet_id" FROM "invitations" WHERE "outlet_id" IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TYPE "public"."account_type";--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('super_admin', 'user');--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "account_type" SET DEFAULT 'user'::"public"."account_type";--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "account_type" SET DATA TYPE "public"."account_type" USING "account_type"::"public"."account_type";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "account_type" SET DEFAULT 'user'::"public"."account_type";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "account_type" SET DATA TYPE "public"."account_type" USING "account_type"::"public"."account_type";--> statement-breakpoint
DROP INDEX "invitations_email_outlet_idx";--> statement-breakpoint
DROP INDEX "outlet_memberships_outlet_role_idx";--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "outlet_memberships_outlet_idx" ON "outlet_memberships" USING btree ("outlet_id");--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN "outlet_id";--> statement-breakpoint
ALTER TABLE "outlet_memberships" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."membership_role";