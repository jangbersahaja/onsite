import {
  outletMemberships,
  scheduledShifts,
  shiftTemplates,
  user,
  workBreaks,
  workSessions,
} from "@/db/schema";
import { outletCalendarDate } from "@/lib/dashboard-data";
import { getDb } from "@/lib/db";
import {
  formatOutletDateTime,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import {
  evaluateAttendance,
  findScheduleConflicts,
  SHIFT_COLORS,
  shiftLocalDateTimes,
  summarizeAttendance,
  type ShiftColor,
} from "@/lib/schedule-rules";
import type {
  ScheduleData,
  ScheduledShift,
  ScheduleOutlet,
  ScheduleStaff,
  ShiftTemplate,
} from "@/lib/schedule-types";
import { getActor } from "@/lib/timesheet-actor";
import { canChangeShiftFor } from "@/lib/timesheet-create-rules";
import { addDaysToDateKey } from "@/lib/timesheet-off-days";
import { getCompletedBreakMinutes, getWorkedMinutes } from "@/lib/work-breaks";
import { and, eq, gte, inArray, lt, lte, notInArray } from "drizzle-orm";

export type ScheduleActor = Exclude<
  Awaited<ReturnType<typeof getActor>>,
  { error: string }
>;

type Db = ReturnType<typeof getDb>;
type Executor = Pick<Db, "select">;

export class ScheduleError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Resolves an outlet the actor may schedule for, or throws. */
export function requireScheduleOutlet(
  actor: ScheduleActor,
  outletId: string,
): ScheduleOutlet {
  const outlet = actor.outlets.find((item) => item.id === outletId);
  if (!outlet) throw new ScheduleError("You cannot access this outlet.", 403);
  if (outlet.isActive === false) {
    throw new ScheduleError("This outlet is inactive.", 403);
  }
  return {
    id: outlet.id,
    name: outlet.name,
    timezone: outlet.timezone,
    imageUrl: outlet.imageUrl ?? null,
  };
}

export function canScheduleFor(actor: ScheduleActor, userId: string) {
  return canChangeShiftFor(
    { userId: actor.userId, isSuperAdmin: actor.access.isSuperAdmin },
    userId,
  );
}

export function toShiftInstants(
  input: { date: string; startTime: string; endTime: string },
  timezone: string,
) {
  const local = shiftLocalDateTimes(input.date, input.startTime, input.endTime);
  try {
    return {
      startAt: new Date(outletDateTimeToISOString(local.start, timezone)),
      endAt: new Date(outletDateTimeToISOString(local.end, timezone)),
    };
  } catch (error) {
    throw new ScheduleError(
      error instanceof Error ? error.message : "Enter a valid shift time.",
    );
  }
}

function localTime(value: Date | string, timezone: string) {
  return formatOutletDateTime(value, timezone).slice(11);
}

function toTemplate(row: typeof shiftTemplates.$inferSelect): ShiftTemplate {
  return {
    id: row.id,
    outletId: row.outletId,
    name: row.name,
    code: row.code,
    startTime: row.startTime,
    endTime: row.endTime,
    breakMinutes: row.breakMinutes,
    color: (SHIFT_COLORS as readonly string[]).includes(row.color)
      ? (row.color as ShiftColor)
      : "violet",
  };
}

export function toScheduledShift(
  row: typeof scheduledShifts.$inferSelect,
  timezone: string,
): ScheduledShift {
  const startLocal = formatOutletDateTime(row.startAt, timezone);
  const endLocal = formatOutletDateTime(row.endAt, timezone);
  return {
    id: row.id,
    userId: row.userId,
    outletId: row.outletId,
    date: row.shiftDate,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    startTime: startLocal.slice(11),
    endTime: endLocal.slice(11),
    endsNextDay: endLocal.slice(0, 10) > startLocal.slice(0, 10),
    breakMinutes: row.breakMinutes,
    templateId: row.templateId,
    note: row.note,
    status: row.status,
    attendance: null,
  };
}

/** Members who can be rostered at an outlet. */
export async function getOutletStaff(executor: Executor, outletId: string) {
  return executor
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      profilePhotoPath: user.profilePhotoPath,
    })
    .from(outletMemberships)
    .innerJoin(user, eq(outletMemberships.userId, user.id))
    .where(
      and(
        eq(outletMemberships.outletId, outletId),
        eq(outletMemberships.isActive, true),
        eq(user.canAccessClock, true),
        eq(user.approvalStatus, "approved"),
      ),
    )
    .orderBy(user.name);
}

/** Throws when any candidate overlaps another candidate or an existing shift for the same person. */
export async function assertNoScheduleConflicts(
  executor: Executor,
  candidates: { userId: string; startAt: Date; endAt: Date }[],
  names: Map<string, string>,
  excludeIds: string[] = [],
) {
  if (!candidates.length) return;
  const internal = findScheduleConflicts(candidates);
  if (internal.length) {
    const name =
      names.get(candidates[internal[0][0]].userId) ?? "A staff member";
    throw new ScheduleError(
      `${name} has overlapping shifts in this change.`,
      409,
    );
  }
  const earliest = new Date(
    Math.min(...candidates.map((candidate) => candidate.startAt.getTime())),
  );
  const latest = new Date(
    Math.max(...candidates.map((candidate) => candidate.endAt.getTime())),
  );
  const existing = await executor
    .select({
      id: scheduledShifts.id,
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
        excludeIds.length
          ? notInArray(scheduledShifts.id, excludeIds)
          : undefined,
      ),
    );
  for (const candidate of candidates) {
    const clash = existing.find(
      (shift) =>
        shift.userId === candidate.userId &&
        shift.startAt < candidate.endAt &&
        candidate.startAt < shift.endAt,
    );
    if (clash) {
      const name = names.get(candidate.userId) ?? "A staff member";
      throw new ScheduleError(
        `${name} already has a shift that overlaps this time.`,
        409,
      );
    }
  }
}

export async function loadScheduleData(
  actor: ScheduleActor,
  outlet: ScheduleOutlet,
  range: { from: string; to: string },
  now = new Date(),
): Promise<ScheduleData> {
  const db = getDb();
  const [memberRows, templateRows, shiftRows] = await Promise.all([
    getOutletStaff(db, outlet.id),
    db
      .select()
      .from(shiftTemplates)
      .where(eq(shiftTemplates.outletId, outlet.id))
      .orderBy(shiftTemplates.startTime, shiftTemplates.name),
    db
      .select()
      .from(scheduledShifts)
      .where(
        and(
          eq(scheduledShifts.outletId, outlet.id),
          gte(scheduledShifts.shiftDate, range.from),
          lte(scheduledShifts.shiftDate, range.to),
        ),
      )
      .orderBy(scheduledShifts.startAt),
  ]);

  // Pad the session window so overnight shifts and early arrivals still match.
  const windowStart = new Date(
    outletDateTimeToISOString(
      `${addDaysToDateKey(range.from, -1)}T00:00`,
      outlet.timezone,
    ),
  );
  const windowEnd = new Date(
    outletDateTimeToISOString(
      `${addDaysToDateKey(range.to, 2)}T00:00`,
      outlet.timezone,
    ),
  );
  const sessionRows = await db
    .select({
      id: workSessions.id,
      userId: workSessions.userId,
      clockInAt: workSessions.clockInAt,
      clockOutAt: workSessions.clockOutAt,
    })
    .from(workSessions)
    .where(
      and(
        eq(workSessions.outletId, outlet.id),
        gte(workSessions.clockInAt, windowStart),
        lt(workSessions.clockInAt, windowEnd),
      ),
    );
  const breakRows = sessionRows.length
    ? await db
        .select({
          workSessionId: workBreaks.workSessionId,
          startedAt: workBreaks.startedAt,
          endedAt: workBreaks.endedAt,
        })
        .from(workBreaks)
        .where(
          inArray(
            workBreaks.workSessionId,
            sessionRows.map((session) => session.id),
          ),
        )
    : [];
  const sessions = sessionRows.map((session) => {
    const breaks = breakRows.filter(
      (item) => item.workSessionId === session.id,
    );
    return {
      ...session,
      workedMinutes: getWorkedMinutes(
        session.clockInAt,
        session.clockOutAt,
        breaks,
      ),
      completedBreakMinutes: getCompletedBreakMinutes(breaks),
    };
  });

  const shifts = shiftRows.map((row) => toScheduledShift(row, outlet.timezone));
  const published = shifts.filter((shift) => shift.status === "published");
  const { results, unscheduled } = evaluateAttendance(published, sessions, now);
  for (const shift of shifts) shift.attendance = results.get(shift.id) ?? null;

  const unscheduledInRange = unscheduled.filter((session) => {
    const date = outletCalendarDate(session.clockInAt, outlet.timezone);
    return date >= range.from && date <= range.to;
  });

  const knownIds = new Set(memberRows.map((member) => member.userId));
  const extraIds = [
    ...new Set([
      ...shifts.map((shift) => shift.userId),
      ...unscheduledInRange.map((session) => session.userId),
    ]),
  ].filter((id) => !knownIds.has(id));
  const extraRows = extraIds.length
    ? await db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          profilePhotoPath: user.profilePhotoPath,
        })
        .from(user)
        .where(inArray(user.id, extraIds))
    : [];

  const toStaff = (
    member: (typeof memberRows)[number],
    isMember: boolean,
  ): ScheduleStaff => ({
    userId: member.userId,
    name: member.name,
    email: member.email,
    photoUrl: member.profilePhotoPath
      ? `/api/profile-photos/${encodeURIComponent(member.userId)}`
      : null,
    isMember,
    canEdit: isMember && canScheduleFor(actor, member.userId),
  });
  const staff = [
    ...memberRows.map((member) => toStaff(member, true)),
    ...extraRows
      .filter((member) =>
        shifts.some((shift) => shift.userId === member.userId),
      )
      .map((member) => toStaff(member, false)),
  ];
  const names = new Map(
    [...memberRows, ...extraRows].map((member) => [member.userId, member.name]),
  );

  return {
    outlets: actor.outlets
      .filter((item) => item.isActive !== false)
      .map((item) => ({
        id: item.id,
        name: item.name,
        timezone: item.timezone,
        imageUrl: item.imageUrl ?? null,
      })),
    outlet,
    from: range.from,
    to: range.to,
    today: outletCalendarDate(now, outlet.timezone),
    now: now.toISOString(),
    currentUserId: actor.userId,
    isSuperAdmin: actor.access.isSuperAdmin,
    staff,
    templates: templateRows.map(toTemplate),
    shifts,
    unscheduled: unscheduledInRange.map((session) => ({
      id: session.id,
      userId: session.userId,
      name: names.get(session.userId) ?? "Former staff",
      date: outletCalendarDate(session.clockInAt, outlet.timezone),
      clockInTime: localTime(session.clockInAt, outlet.timezone),
      clockOutTime: session.clockOutAt
        ? localTime(session.clockOutAt, outlet.timezone)
        : null,
      workedMinutes: session.workedMinutes,
    })),
    summary: summarizeAttendance(
      published.map((shift) => ({
        ...shift,
        attendance: results.get(shift.id) ?? null,
      })),
      unscheduledInRange,
    ),
  };
}
