import type { ScheduledShift, ShiftTemplate } from "@/lib/schedule-types";

export type ScheduleView = "week" | "month";

export type ShiftDraft = {
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  templateId?: string | null;
  note?: string | null;
};

function utcDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function localDateKey(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function dayParts(date: string) {
  const value = utcDate(date);
  return {
    weekday: new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      timeZone: "UTC",
    }).format(value),
    narrowWeekday: new Intl.DateTimeFormat("en-GB", {
      weekday: "narrow",
      timeZone: "UTC",
    }).format(value),
    day: value.getUTCDate(),
    month: new Intl.DateTimeFormat("en-GB", {
      month: "short",
      timeZone: "UTC",
    }).format(value),
    isWeekend: value.getUTCDay() === 0 || value.getUTCDay() === 6,
  };
}

export function formatLongDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(date));
}

export function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(utcDate(date));
}

export function formatRangeLabel(from: string, to: string, view: ScheduleView) {
  if (view === "month") {
    return new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(utcDate(from));
  }
  const start = utcDate(from);
  const end = utcDate(to);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    ...(sameMonth ? {} : { month: "short" }),
    timeZone: "UTC",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);
  return `${startLabel} – ${endLabel}`;
}

export function formatHours(minutes: number) {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? ` ${String(rest).padStart(2, "0")}m` : ""}`;
}

/** "09:00" → "9a", "13:30" → "1:30p" for dense month cells. */
export function compactTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours < 12 ? "a" : "p";
  const hour12 = hours % 12 || 12;
  return `${hour12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${suffix}`;
}

export function shiftDurationMinutes(shift: {
  startAt: string;
  endAt: string;
  breakMinutes: number;
}) {
  return Math.max(
    0,
    Math.round(
      (new Date(shift.endAt).getTime() - new Date(shift.startAt).getTime()) /
        60_000,
    ) - shift.breakMinutes,
  );
}

export function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

export function cellKey(userId: string, date: string) {
  return `${userId}|${date}`;
}

export function templateMatches(
  template: ShiftTemplate | undefined,
  values: { startTime: string; endTime: string; breakMinutes: number },
) {
  return Boolean(
    template &&
      template.startTime === values.startTime &&
      template.endTime === values.endTime &&
      template.breakMinutes === values.breakMinutes,
  );
}

export type AttendanceBadge = {
  tone: "success" | "warning" | "danger" | "info" | "overtime";
  label: string;
  short: string;
};

export function attendanceBadges(shift: ScheduledShift): AttendanceBadge[] {
  const attendance = shift.attendance;
  if (!attendance || attendance.status === "upcoming") return [];
  if (attendance.status === "absent") {
    return [{ tone: "danger", label: "Absent", short: "ABS" }];
  }
  if (attendance.status === "not_clocked_in") {
    return [
      {
        tone: "danger",
        label: `Not in · ${formatMinutes(attendance.lateMinutes)}`,
        short: "LATE",
      },
    ];
  }
  const badges: AttendanceBadge[] = [];
  if (attendance.flags.includes("late")) {
    badges.push({
      tone: "warning",
      label: `Late ${formatMinutes(attendance.lateMinutes)}`,
      short: "LATE",
    });
  }
  if (attendance.flags.includes("left_early")) {
    badges.push({
      tone: "warning",
      label: `Left ${formatMinutes(attendance.earlyLeaveMinutes)} early`,
      short: "EARLY",
    });
  }
  if (attendance.flags.includes("overtime")) {
    badges.push({
      tone: "overtime",
      label: `+${formatMinutes(attendance.overtimeMinutes)} OT`,
      short: "OT",
    });
  }
  if (attendance.status === "in_progress") {
    badges.push({ tone: "info", label: "On shift", short: "ON" });
  } else if (!badges.length) {
    badges.push({ tone: "success", label: "On time", short: "OK" });
  }
  return badges;
}

export async function scheduleRequest<T>(
  url: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const response = await fetch(url, {
    method: init.method,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      (body as { error?: string }).error ?? "Something went wrong.",
    );
  }
  return body as T;
}
