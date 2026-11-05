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
  getOutletStaff,
  requireScheduleOutlet,
  ScheduleError,
  toScheduledShift,
  toShiftInstants,
} from "@/lib/schedule-data";
import {
  dayDifference,
  MAX_SCHEDULE_RANGE_DAYS,
  rangesOverlap,
} from "@/lib/schedule-rules";
import { addDaysToDateKey } from "@/lib/timesheet-off-days";
import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";

const copySchema = z
  .object({
    outletId: z.string().uuid(),
    sourceFrom: dateSchema,
    sourceTo: dateSchema,
    targetFrom: dateSchema,
    repeat: z.number().int().min(1).max(12).default(1),
  })
  .strict();

/**
 * Copies a block of days (e.g. last week) onto a target start date, optionally
 * repeating it back-to-back. Copies are drafts; anything that would overlap an
 * existing shift for the same person is skipped rather than failing the batch.
 */
export async function POST(request: Request) {
  if (!hasServerConfiguration()) return scheduleUnavailable();
  try {
    const actor = await requireScheduleActor(request);
    const parsed = copySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ScheduleError("Check the copy options.");
    const { sourceFrom, sourceTo, targetFrom, repeat } = parsed.data;
    if (sourceFrom > sourceTo) {
      throw new ScheduleError("Choose a valid source range.");
    }
    const spanDays = dayDifference(sourceFrom, sourceTo) + 1;
    if (spanDays > MAX_SCHEDULE_RANGE_DAYS) {
      throw new ScheduleError("The source range is too long.");
    }
    const offset = dayDifference(sourceFrom, targetFrom);
    if (offset < spanDays && offset + repeat * spanDays > 0) {
      throw new ScheduleError("The target cannot overlap the source range.");
    }
    const outlet = requireScheduleOutlet(actor, parsed.data.outletId);
    const db = getDb();
    const staff = await getOutletStaff(db, outlet.id);
    const memberIds = new Set(staff.map((member) => member.userId));

    const source = (
      await db
        .select()
        .from(scheduledShifts)
        .where(
          and(
            eq(scheduledShifts.outletId, outlet.id),
            gte(scheduledShifts.shiftDate, sourceFrom),
            lte(scheduledShifts.shiftDate, sourceTo),
          ),
        )
    )
      .filter(
        (shift) =>
          memberIds.has(shift.userId) && canScheduleFor(actor, shift.userId),
      )
      .map((row) => toScheduledShift(row, outlet.timezone));
    if (!source.length) return Response.json({ created: 0, skipped: 0 });

    const candidates = [];
    for (let round = 0; round < repeat; round += 1) {
      const shiftDays = offset + round * spanDays;
      for (const shift of source) {
        const date = addDaysToDateKey(shift.date, shiftDays);
        const instants = toShiftInstants(
          { date, startTime: shift.startTime, endTime: shift.endTime },
          outlet.timezone,
        );
        candidates.push({
          userId: shift.userId,
          outletId: outlet.id,
          shiftDate: date,
          ...instants,
          breakMinutes: shift.breakMinutes,
          templateId: shift.templateId,
          note: shift.note,
        });
      }
    }

    const earliest = new Date(
      Math.min(...candidates.map((candidate) => candidate.startAt.getTime())),
    );
    const latest = new Date(
      Math.max(...candidates.map((candidate) => candidate.endAt.getTime())),
    );
    const existing = await db
      .select({
        userId: scheduledShifts.userId,
        startAt: scheduledShifts.startAt,
        endAt: scheduledShifts.endAt,
      })
      .from(scheduledShifts)
      .where(
        and(
          inArray(scheduledShifts.userId, [
            ...new Set(candidates.map((candidate) => candidate.userId)),
          ]),
          lt(scheduledShifts.startAt, latest),
          gte(scheduledShifts.endAt, earliest),
        ),
      );
    const taken = existing.map((shift) => ({
      userId: shift.userId,
      start: shift.startAt.getTime(),
      end: shift.endAt.getTime(),
    }));
    const accepted = candidates.filter((candidate) => {
      const interval = {
        userId: candidate.userId,
        start: candidate.startAt.getTime(),
        end: candidate.endAt.getTime(),
      };
      if (
        taken.some(
          (item) =>
            item.userId === interval.userId && rangesOverlap(item, interval),
        )
      ) {
        return false;
      }
      taken.push(interval);
      return true;
    });

    if (accepted.length) {
      await db.transaction(async (tx) => {
        await tx.insert(scheduledShifts).values(
          accepted.map((candidate) => ({
            ...candidate,
            status: "draft" as const,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          })),
        );
        await recordAudit(tx, {
          actorId: actor.userId,
          action: "schedule_copied",
          entityType: "schedule",
          entityId: `${outlet.id}:${sourceFrom}:${targetFrom}`,
          outletId: outlet.id,
          newValues: {
            sourceFrom,
            sourceTo,
            targetFrom,
            repeat,
            created: accepted.length,
            skipped: candidates.length - accepted.length,
          },
        });
      });
    }
    return Response.json({
      created: accepted.length,
      skipped: candidates.length - accepted.length,
    });
  } catch (error) {
    return scheduleErrorResponse(error, "Could not copy the schedule.");
  }
}
