DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "correction_requests" WHERE "status" = 'pending'
	) THEN
		RAISE EXCEPTION 'Cannot remove pending correction status while pending correction requests exist.';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "correction_requests" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
CREATE TYPE "public"."correction_status_new" AS ENUM('reconciliation', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "correction_requests" ALTER COLUMN "status" SET DATA TYPE "public"."correction_status_new" USING "status"::text::"public"."correction_status_new";--> statement-breakpoint
DROP TYPE "public"."correction_status";--> statement-breakpoint
ALTER TYPE "public"."correction_status_new" RENAME TO "correction_status";--> statement-breakpoint
ALTER TABLE "correction_requests" ALTER COLUMN "status" SET DEFAULT 'reconciliation'::"public"."correction_status";