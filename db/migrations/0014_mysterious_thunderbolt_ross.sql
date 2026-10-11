CREATE TYPE "public"."user_approval_status" AS ENUM('pending', 'approved');--> statement-breakpoint
CREATE TABLE "registration_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "approval_status" "user_approval_status" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "registration_outlet_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registration_links" ADD CONSTRAINT "registration_links_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_links" ADD CONSTRAINT "registration_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registration_links_one_active_per_outlet_uq" ON "registration_links" USING btree ("outlet_id") WHERE "registration_links"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_registration_outlet_id_outlets_id_fk" FOREIGN KEY ("registration_outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "invitations" SET "revoked_at" = now() WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
