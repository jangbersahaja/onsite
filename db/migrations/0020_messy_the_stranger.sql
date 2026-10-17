CREATE TABLE "super_admin_outlet_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"notifications_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "super_admin_outlet_notifications" ADD CONSTRAINT "super_admin_outlet_notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "super_admin_outlet_notifications" ADD CONSTRAINT "super_admin_outlet_notifications_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "super_admin_outlet_notifications_user_outlet_uq" ON "super_admin_outlet_notifications" USING btree ("user_id","outlet_id");