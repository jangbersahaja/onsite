import {
  evaluateAttendance,
  type AttendanceSession,
  type AttendanceShift,
} from "@/lib/schedule-rules";
import type { StaffScheduledShift } from "@/lib/staff-schedule";
import {
  getCompletedBreakMinutes,
  getWorkedMinutes,
  type WorkBreakInterval,
} from "@/lib/work-breaks";

export type DutyStaff = {
  userId: string;
  name: string;
  photoUrl: string | null;
};

export type DutySession = {
  id: string;
  userId: string;
  clockInAt: string;
  clockOutAt: string | null;
  breaks: WorkBreakInterval[];
};

export type DutyShift = StaffScheduledShift & { userId: string };

export type DutyBoardData = {
  today: string;
  currentUserId: string;
  staff: DutyStaff[];
  shifts: DutyShift[];
  sessions: DutySession[];
};

export type DutyState =
  | "upcoming"
  | "late"
  | "on_duty"
  | "on_break"
  | "completed"
  | "absent";

export type DutyPerson = DutyStaff & { isCurrentUser: boolean };

export type DutyShiftRow = {
  shift: DutyShift;
  person: DutyPerson;
  state: DutyState;
  clockInAt: string | null;
  breakStartedAt: string | null;
  startsInMinutes: number | null;
  lateMinutes: number;
  endsInMinutes: number | null;
  isPastEnd: boolean;
};

export type DutyOnDuty = {
  sessionId: string;
  person: DutyPerson;
  state: "on_duty" | "on_break";
  clockInAt: string;
  breakStartedAt: string | null;
  shiftId: string | null;
};

export type DutyBoard = {
  onDuty: DutyOnDuty[];
  shifts: DutyShiftRow[];
};

function minutesFrom(fromMs: number, toMs: number) {
  return Math.max(0, Math.ceil((toMs - fromMs) / 60_000));
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function openBreakStart(session: DutySession) {
  const open = session.breaks.find((item) => !item.endedAt);
  return open ? toIso(open.startedAt) : null;
}

/**
 * Derives who is on duty and each of today's shifts' live state at `now`.
 * Pure, so the panel can recompute it every tick as the schedule progresses.
 */
export function buildDutyBoard(data: DutyBoardData, now: Date): DutyBoard {
  const nowMs = now.getTime();
  const members = new Map(data.staff.map((member) => [member.userId, member]));
  const personFor = (userId: string): DutyPerson => {
    const member = members.get(userId);
    return {
      userId,
      name: member?.name ?? "Former staff",
      photoUrl: member?.photoUrl ?? null,
      isCurrentUser: userId === data.currentUserId,
    };
  };

  const attendanceShifts: AttendanceShift[] = data.shifts.map((shift) => ({
    id: shift.id,
    userId: shift.userId,
    startAt: shift.startAt,
    endAt: shift.endAt,
    breakMinutes: shift.breakMinutes,
  }));
  const attendanceSessions: AttendanceSession[] = data.sessions.map(
    (session) => ({
      id: session.id,
      userId: session.userId,
      clockInAt: session.clockInAt,
      clockOutAt: session.clockOutAt,
      workedMinutes: getWorkedMinutes(
        session.clockInAt,
        session.clockOutAt,
        session.breaks,
      ),
      completedBreakMinutes: getCompletedBreakMinutes(session.breaks),
    }),
  );
  const { results } = evaluateAttendance(
    attendanceShifts,
    attendanceSessions,
    now,
  );

  const sessionById = new Map(data.sessions.map((s) => [s.id, s]));
  const shiftIdBySession = new Map<string, string>();
  for (const [shiftId, attendance] of results) {
    for (const sessionId of attendance.sessionIds) {
      shiftIdBySession.set(sessionId, shiftId);
    }
  }

  const onDuty: DutyOnDuty[] = data.sessions
    .filter((session) => session.clockOutAt === null)
    .map((session): DutyOnDuty => {
      const breakStartedAt = openBreakStart(session);
      return {
        sessionId: session.id,
        person: personFor(session.userId),
        state: breakStartedAt ? "on_break" : "on_duty",
        clockInAt: session.clockInAt,
        breakStartedAt,
        shiftId: shiftIdBySession.get(session.id) ?? null,
      };
    })
    .sort((a, b) => Date.parse(a.clockInAt) - Date.parse(b.clockInAt));

  const shifts = data.shifts
    .filter((shift) => shift.date === data.today)
    .map((shift): DutyShiftRow => {
      const attendance = results.get(shift.id);
      const openSession = (attendance?.sessionIds ?? [])
        .map((id) => sessionById.get(id))
        .find((session) => session && session.clockOutAt === null);
      const breakStartedAt = openSession ? openBreakStart(openSession) : null;
      const startMs = Date.parse(shift.startAt);
      const endMs = Date.parse(shift.endAt);

      let state: DutyState = "upcoming";
      switch (attendance?.status) {
        case "not_clocked_in":
          state = "late";
          break;
        case "in_progress":
          state = breakStartedAt ? "on_break" : "on_duty";
          break;
        case "completed":
          state = "completed";
          break;
        case "absent":
          state = "absent";
          break;
      }

      const isActive = state === "on_duty" || state === "on_break";
      return {
        shift,
        person: personFor(shift.userId),
        state,
        clockInAt: attendance?.clockInAt ?? null,
        breakStartedAt,
        startsInMinutes:
          state === "upcoming" ? minutesFrom(nowMs, startMs) : null,
        lateMinutes: state === "late" ? minutesFrom(startMs, nowMs) : 0,
        endsInMinutes: isActive ? minutesFrom(nowMs, endMs) : null,
        isPastEnd: isActive && nowMs >= endMs,
      };
    })
    .sort((a, b) => Date.parse(a.shift.startAt) - Date.parse(b.shift.startAt));

  return { onDuty, shifts };
}
