CREATE TYPE "public"."manual_shift_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "manual_shift_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"clock_in_at" timestamp with time zone NOT NULL,
	"clock_out_at" timestamp with time zone NOT NULL,
	"breaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_code" text,
	"reason" text NOT NULL,
	"status" "manual_shift_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"work_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manual_shift_requests" ADD CONSTRAINT "manual_shift_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_shift_requests" ADD CONSTRAINT "manual_shift_requests_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_shift_requests" ADD CONSTRAINT "manual_shift_requests_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_shift_requests" ADD CONSTRAINT "manual_shift_requests_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_shift_requests_outlet_status_idx" ON "manual_shift_requests" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "manual_shift_requests_requester_idx" ON "manual_shift_requests" USING btree ("requested_by");