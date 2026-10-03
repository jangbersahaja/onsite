CREATE TABLE "work_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_breaks_end_after_start_chk" CHECK ("work_breaks"."ended_at" IS NULL OR "work_breaks"."ended_at" > "work_breaks"."started_at")
);
--> statement-breakpoint
ALTER TABLE "work_breaks" ADD CONSTRAINT "work_breaks_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_breaks_one_open_per_session_uq" ON "work_breaks" USING btree ("work_session_id") WHERE "work_breaks"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "work_breaks_session_started_idx" ON "work_breaks" USING btree ("work_session_id","started_at");