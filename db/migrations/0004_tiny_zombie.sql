CREATE TYPE "public"."staff_device_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TABLE "staff_device_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "staff_device_status" DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_device_enrollments_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "staff_device_enrollments" ADD CONSTRAINT "staff_device_enrollments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_device_enrollments" ADD CONSTRAINT "staff_device_enrollments_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_device_one_pending_per_user_uq" ON "staff_device_enrollments" USING btree ("user_id") WHERE "staff_device_enrollments"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "staff_device_one_active_per_user_uq" ON "staff_device_enrollments" USING btree ("user_id") WHERE "staff_device_enrollments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "staff_device_user_idx" ON "staff_device_enrollments" USING btree ("user_id");