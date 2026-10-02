ALTER TABLE "correction_requests" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
UPDATE "work_sessions" AS session SET "timezone" = outlet."timezone" FROM "outlets" AS outlet WHERE session."outlet_id" = outlet."id";--> statement-breakpoint
UPDATE "correction_requests" AS request SET "timezone" = outlet."timezone" FROM "outlets" AS outlet WHERE request."outlet_id" = outlet."id";