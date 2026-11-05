import { scheduledShifts, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { outletCalendarDate } from "@/lib/dashboard-data";
import { getDb } from "@/lib/db";
import { isDateOnly } from "@/lib/outlet-time";
import {
  prepareShifts,
  readJson,
  requireScheduleActor,
  scheduleErrorResponse,
  scheduleUnavailable,
  shiftInputSchema,
} from "@/lib/schedule-api";
import {
  canScheduleFor,
  loadScheduleData,
  requireScheduleOutlet,
  ScheduleError,
  toScheduledShift,
} from "@/lib/schedule-data";
import {
  dayDifference,
  MAX_SCHEDULE_RANGE_DAYS,
  startOfWeek,
} from "@/lib/schedule-rules";
import { addDaysToDateKey } from "@/lib/timesheet-off-days";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return scheduleUnavailable();
  try {
    const actor = await requireScheduleActor(request);
    const params = new URL(request.url).searchParams;
    const outletId =
      params.get("outletId") ||
      actor.outlets.find((outlet) => outlet.isActive !== false)?.id;
    if (!outletId) throw new ScheduleError("No active outlet to schedule.", 403);
    const outlet = requireScheduleOutlet(actor, outletId);
    const from =
      params.get("from") ||
      startOfWeek(outletCalendarDate(new Date(), outlet.timezone));
    const to = params.get("to") || addDaysToDateKey(from, 6);
    if (!isDateOnly(from) || !isDateOnly(to) || from > to) {
      throw new ScheduleError("Choose a valid date range.");
    }
    if (dayDifference(from, to) >= MAX_SCHEDULE_RANGE_DAYS) {
      throw new ScheduleError(
        `Choose a range of ${MAX_SCHEDULE_RANGE_DAYS} days or fewer.`,
      );
    }
    return Response.json(await loadScheduleData(actor, outlet, { from, to }));
  } catch (error) {
    return scheduleErrorResponse(error, "Could not load the schedule.");
  }
}

const createSchema = z
  .object({
    outletId: z.string().uuid(),
    shifts: z.array(shiftInputSchema).min(1).max(300),
    publish: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request) {
  if (!hasServerConfiguration()) return scheduleUnavailable();
  try {
    const actor = await requireScheduleActor(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ScheduleError("Check the shift details.");
    const { outlet, rows, names } = await prepareShifts(
      actor,
      parsed.data.outletId,
      parsed.data.shifts,
    );
    const now = new Date();
    const status: "draft" | "published" = parsed.data.publish
      ? "published"
      : "draft";
    const created = await getDb().transaction(async (tx) => {
      const inserted = await tx
        .insert(scheduledShifts)
        .values(
          rows.map((row) => ({
            ...row,
            status,
            publishedAt: status === "published" ? now : null,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          })),
        )
        .returning();
      const userIds = [...new Set(rows.map((row) => row.userId))];
      await recordAudit(tx, {
        actorId: actor.userId,
        action: "schedule_shift_created",
        entityType: "scheduled_shift",
        entityId:
          inserted.length === 1 ? inserted[0].id : `${inserted.length} shifts`,
        outletId: outlet.id,
        newValues: {
          count: inserted.length,
          status,
          dates: [...new Set(rows.map((row) => row.shiftDate))].sort(),
          ...(userIds.length === 1
            ? { username: names.get(userIds[0]) }
            : {}),
        },
      });
      return inserted;
    });
    return Response.json(
      { shifts: created.map((row) => toScheduledShift(row, outlet.timezone)) },
      { status: 201 },
    );
  } catch (error) {
    return scheduleErrorResponse(error, "Could not save the shifts.");
  }
}

const updateSchema = shiftInputSchema
  .extend({ id: z.string().uuid(), outletId: z.string().uuid() })
  .strict();

export async function PATCH(request: Request) {
  if (!hasServerConfiguration()) return scheduleUnavailable();
  try {
    const actor = await requireScheduleActor(request);
    const parsed = updateSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ScheduleError("Check the shift details.");
    const { id, outletId, ...input } = parsed.data;
    const db = getDb();
    const [existing] = await db
      .select()
      .from(scheduledShifts)
      .where(
        and(eq(scheduledShifts.id, id), eq(scheduledShifts.outletId, outletId)),
      )
      .limit(1);
    if (!existing) throw new ScheduleError("This shift no longer exists.", 404);
    if (!canScheduleFor(actor, existing.userId)) {
      throw new ScheduleError("You cannot change your own shifts.", 403);
    }
    const { outlet, rows, names } = await prepareShifts(
      actor,
      outletId,
      [input],
      [id],
    );
    const [next] = rows;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(scheduledShifts)
        .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(scheduledShifts.id, id))
        .returning();
      await recordAudit(tx, {
        actorId: actor.userId,
        action: "schedule_shift_updated",
        entityType: "scheduled_shift",
        entityId: id,
        outletId: outlet.id,
        previousValues: {
          userId: existing.userId,
          shiftDate: existing.shiftDate,
          startAt: existing.startAt,
          endAt: existing.endAt,
          breakMinutes: existing.breakMinutes,
          note: existing.note,
        },
        newValues: {
          userId: next.userId,
          shiftDate: next.shiftDate,
          startAt: next.startAt,
          endAt: next.endAt,
          breakMinutes: next.breakMinutes,
          note: next.note,
          username: names.get(next.userId),
        },
      });
      return row;
    });
    return Response.json({ shift: toScheduledShift(updated, outlet.timezone) });
  } catch (error) {
    return scheduleErrorResponse(error, "Could not update the shift.");
  }
}

const deleteSchema = z
  .object({
    outletId: z.string().uuid(),
    ids: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();

export async function DELETE(request: Request) {
  if (!hasServerConfiguration()) return scheduleUnavailable();
  try {
    const actor = await requireScheduleActor(request);
    const parsed = deleteSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ScheduleError("Choose shifts to remove.");
    const outlet = requireScheduleOutlet(actor, parsed.data.outletId);
    const db = getDb();
    const existing = await db
      .select({
        id: scheduledShifts.id,
        userId: scheduledShifts.userId,
        shiftDate: scheduledShifts.shiftDate,
        status: scheduledShifts.status,
        userName: user.name,
      })
      .from(scheduledShifts)
      .innerJoin(user, eq(scheduledShifts.userId, user.id))
      .where(
        and(
          inArray(scheduledShifts.id, parsed.data.ids),
          eq(scheduledShifts.outletId, outlet.id),
        ),
      );
    if (existing.some((shift) => !canScheduleFor(actor, shift.userId))) {
      throw new ScheduleError("You cannot remove your own shifts.", 403);
    }
    if (!existing.length) return Response.json({ deleted: 0 });
    await db.transaction(async (tx) => {
      await tx.delete(scheduledShifts).where(
        inArray(
          scheduledShifts.id,
          existing.map((shift) => shift.id),
        ),
      );
      await recordAudit(tx, {
        actorId: actor.userId,
        action: "schedule_shift_deleted",
        entityType: "scheduled_shift",
        entityId:
          existing.length === 1 ? existing[0].id : `${existing.length} shifts`,
        outletId: outlet.id,
        previousValues: existing.map(({ id, userName, shiftDate, status }) => ({
          id,
          userName,
          shiftDate,
          status,
        })),
      });
    });
    return Response.json({ deleted: existing.length });
  } catch (error) {
    return scheduleErrorResponse(error, "Could not remove the shifts.");
  }
}
