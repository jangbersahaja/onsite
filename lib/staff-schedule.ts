import { SHIFT_COLORS, type ShiftColor } from "@/lib/schedule-rules";
import type { ScheduledShift } from "@/lib/schedule-types";

export type StaffScheduleOutlet = {
  id: string;
  name: string;
  timezone: string;
  imageUrl: string | null | undefined;
};

export type StaffScheduledShift = {
  id: string;
  outletId: string;
  date: string;
  startAt: string;
  endAt: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  breakMinutes: number;
  note: string | null;
  template: {
    name: string;
    code: string;
    color: ShiftColor;
  } | null;
};

export type StaffScheduleData = {
  outlets: StaffScheduleOutlet[];
  outlet: StaffScheduleOutlet;
  from: string;
  to: string;
  today: string;
  now: string;
  shifts: StaffScheduledShift[];
};

export function toStaffScheduledShift(
  shift: ScheduledShift,
  template: { name: string; code: string; color: string } | null,
): StaffScheduledShift {
  return {
    id: shift.id,
    outletId: shift.outletId,
    date: shift.date,
    startAt: shift.startAt,
    endAt: shift.endAt,
    startTime: shift.startTime,
    endTime: shift.endTime,
    endsNextDay: shift.endsNextDay,
    breakMinutes: shift.breakMinutes,
    note: shift.note,
    template:
      template && (SHIFT_COLORS as readonly string[]).includes(template.color)
        ? { ...template, color: template.color as ShiftColor }
        : template
          ? { ...template, color: "slate" }
          : null,
  };
}

function escapeIcsText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function toIcsDate(value: string) {
  return new Date(value)
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".000", "");
}

export function scheduleCalendarFile(
  shifts: StaffScheduledShift[],
  outletName: string,
  generatedAt = new Date(),
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OnSITE//Staff Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const shift of shifts) {
    const title = shift.template?.name ?? "Scheduled shift";
    const description = [
      shift.note,
      shift.breakMinutes ? `Unpaid break: ${shift.breakMinutes} minutes` : null,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${shift.id}@onsite`,
      `DTSTAMP:${toIcsDate(generatedAt.toISOString())}`,
      `DTSTART:${toIcsDate(shift.startAt)}`,
      `DTEND:${toIcsDate(shift.endAt)}`,
      `SUMMARY:${escapeIcsText(title)}`,
      `LOCATION:${escapeIcsText(outletName)}`,
      ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function nextScheduledShift(shifts: StaffScheduledShift[], now: string) {
  const nowMs = new Date(now).getTime();
  return shifts.find((shift) => new Date(shift.endAt).getTime() >= nowMs);
}
