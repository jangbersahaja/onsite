ALTER TYPE "public"."correction_status" ADD VALUE 'reconciliation' BEFORE 'approved';--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "reconciled_by" text;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_reconciled_by_user_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;