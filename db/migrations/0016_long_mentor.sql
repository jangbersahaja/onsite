ALTER TABLE "audit_events" ADD COLUMN "actor_name" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "outlet_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_outlet_created_idx" ON "audit_events" USING btree ("outlet_id","created_at");--> statement-breakpoint
UPDATE "audit_events" AS a SET "actor_name" = u."name" FROM "user" AS u WHERE a."actor_id" = u."id" AND a."actor_name" IS NULL;--> statement-breakpoint
UPDATE "audit_events" AS a SET "outlet_id" = o."id" FROM "outlets" AS o WHERE a."outlet_id" IS NULL AND o."id"::text = a."entity_id";--> statement-breakpoint
UPDATE "audit_events" AS a SET "outlet_id" = o."id" FROM "outlets" AS o WHERE a."outlet_id" IS NULL AND (a."new_values"->>'outletId') ~* '^[0-9a-f-]{36}$' AND o."id"::text = (a."new_values"->>'outletId');
