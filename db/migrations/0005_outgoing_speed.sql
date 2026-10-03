CREATE TYPE "public"."account_type" AS ENUM('super_admin', 'admin', 'staff');--> statement-breakpoint
CREATE TABLE "auth_login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invitation_outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "account_type" "account_type" DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "can_access_clock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "can_access_backoffice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "account_type" "account_type" DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "can_access_clock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "can_access_backoffice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation_outlets" ADD CONSTRAINT "invitation_outlets_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_outlets" ADD CONSTRAINT "invitation_outlets_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_outlets_invitation_outlet_uq" ON "invitation_outlets" USING btree ("invitation_id","outlet_id");--> statement-breakpoint
CREATE INDEX "invitation_outlets_outlet_idx" ON "invitation_outlets" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "password_reset_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash");