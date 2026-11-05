import { shiftTemplates } from "@/db/schema";
import { getDb } from "@/lib/db";
import { isDateOnly } from "@/lib/outlet-time";
import {
  assertNoScheduleConflicts,
  canScheduleFor,
  getOutletStaff,
  requireScheduleOutlet,
  ScheduleError,
  toShiftInstants,
  type ScheduleActor,
} from "@/lib/schedule-data";
import { validateShiftTimes } from "@/lib/schedule-rules";
import { getActor } from "@/lib/timesheet-actor";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export const dateSchema = z.string().refine(isDateOnly, "Enter a valid date.");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const shiftInputSchema = z
  .object({
    userId: z.string().min(1),
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    breakMinutes: z.number().int().min(0).max(240),
    templateId: z.string().uuid().nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

export type ShiftInput = z.infer<typeof shiftInputSchema>;

export function scheduleUnavailable() {
  return Response.json(
    { error: "Set DATABASE_URL before using schedules." },
    { status: 503 },
  );
}

export function scheduleErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ScheduleError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: fallback }, { status: 500 });
}

export async function requireScheduleActor(request: Request) {
  const actor = await getActor(request);
  if ("error" in actor) {
    throw new ScheduleError(
      actor.error ?? "Schedule access is not available.",
      actor.status ?? 403,
    );
  }
  return actor;
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ScheduleError("Request body must be JSON.");
  }
}

/** Validates editable staff, templates and overlaps; returns rows ready to insert. */
export async function prepareShifts(
  actor: ScheduleActor,
  outletId: string,
  inputs: ShiftInput[],
  excludeIds: string[] = [],
) {
  const outlet = requireScheduleOutlet(actor, outletId);
  const db = getDb();
  const staff = await getOutletStaff(db, outlet.id);
  const names = new Map(staff.map((member) => [member.userId, member.name]));
  const templateIds = [
    ...new Set(
      inputs.flatMap((input) => (input.templateId ? [input.templateId] : [])),
    ),
  ];
  const templates = templateIds.length
    ? await db
        .select({ id: shiftTemplates.id })
        .from(shiftTemplates)
        .where(
          and(
            inArray(shiftTemplates.id, templateIds),
            eq(shiftTemplates.outletId, outlet.id),
          ),
        )
    : [];
  if (templates.length !== templateIds.length) {
    throw new ScheduleError("A shift template is no longer available.");
  }

  const rows = inputs.map((input) => {
    if (!names.has(input.userId)) {
      throw new ScheduleError(
        "Only staff assigned to this outlet can be scheduled.",
      );
    }
    if (!canScheduleFor(actor, input.userId)) {
      throw new ScheduleError("You cannot schedule your own shifts.", 403);
    }
    const invalid = validateShiftTimes(input);
    if (invalid) throw new ScheduleError(invalid);
    const { startAt, endAt } = toShiftInstants(input, outlet.timezone);
    return {
      userId: input.userId,
      outletId: outlet.id,
      shiftDate: input.date,
      startAt,
      endAt,
      breakMinutes: input.breakMinutes,
      templateId: input.templateId ?? null,
      note: input.note || null,
    };
  });
  await assertNoScheduleConflicts(db, rows, names, excludeIds);
  return { outlet, rows, names };
}
