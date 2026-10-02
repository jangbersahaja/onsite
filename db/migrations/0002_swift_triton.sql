CREATE TYPE "public"."punch_source" AS ENUM('gps', 'manual');--> statement-breakpoint
ALTER TABLE "work_sessions" ALTER COLUMN "clock_in_latitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_sessions" ALTER COLUMN "clock_in_longitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_sessions" ALTER COLUMN "clock_in_accuracy" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD COLUMN "clock_in_source" "punch_source" DEFAULT 'gps' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD COLUMN "clock_out_source" "punch_source";--> statement-breakpoint
UPDATE "work_sessions" SET "clock_out_source" = 'gps' WHERE "clock_out_at" IS NOT NULL;