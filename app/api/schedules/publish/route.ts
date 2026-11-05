import { scheduledShifts } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import {
  dateSchema,
  readJson,
  requireScheduleActor,
  scheduleErrorResponse,
  scheduleUnavailable,
} from "@/lib/schedule-api";
import {
  canScheduleFor,
  requireScheduleOutlet,
  ScheduleError,
} from "@/lib/schedule-data";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";

const publishSchema = z
  .object({
    outletId: z.string().uuid(),
    from: dateSchema,
    to: dateSchema,
  })
  .strict();

export async function POST(request: Request) {
  if (!hasServerConfiguration()) return scheduleUnavailable();
  try {
    const actor = await requireScheduleActor(request);
    const parsed = publishSchema.safeParse(await readJson(request));
    if (!parsed.success || parsed.data.from > parsed.data.to) {
      throw new ScheduleError("Choose a valid date range to publish.");
    }
    const outlet = requireScheduleOutlet(actor, parsed.data.outletId);
    const db = getDb();
    const drafts = (
      await db
        .select({ id: scheduledShifts.id, userId: scheduledShifts.userId })
        .from(scheduledShifts)
        .where(
          and(
            eq(scheduledShifts.outletId, outlet.id),
            eq(scheduledShifts.status, "draft"),
            gte(scheduledShifts.shiftDate, parsed.data.from),
            lte(scheduledShifts.shiftDate, parsed.data.to),
          ),
        )
    ).filter((shift) => canScheduleFor(actor, shift.userId));
    if (!drafts.length) return Response.json({ published: 0 });

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(scheduledShifts)
        .set({
          status: "published",
          publishedAt: now,
          updatedBy: actor.userId,
          updatedAt: now,
        })
        .where(
          inArray(
            scheduledShifts.id,
            drafts.map((shift) => shift.id),
          ),
        );
      await recordAudit(tx, {
        actorId: actor.userId,
        action: "schedule_published",
        entityType: "schedule",
        entityId: `${outlet.id}:${parsed.data.from}:${parsed.data.to}`,
        outletId: outlet.id,
        newValues: {
          count: drafts.length,
          from: parsed.data.from,
          to: parsed.data.to,
        },
      });
    });
    return Response.json({ published: drafts.length });
  } catch (error) {
    return scheduleErrorResponse(error, "Could not publish the schedule.");
  }
}
