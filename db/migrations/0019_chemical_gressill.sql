ALTER TYPE "public"."correction_event" ADD VALUE 'break_update';--> statement-breakpoint
ALTER TYPE "public"."correction_event" ADD VALUE 'break_add';--> statement-breakpoint
ALTER TYPE "public"."correction_event" ADD VALUE 'break_delete';--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "work_break_id" uuid;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "break_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "break_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_work_break_id_work_breaks_id_fk" FOREIGN KEY ("work_break_id") REFERENCES "public"."work_breaks"("id") ON DELETE set null ON UPDATE no action;