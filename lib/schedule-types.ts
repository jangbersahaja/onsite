import type {
  AttendanceSummaryRow,
  ShiftAttendance,
  ShiftColor,
} from "@/lib/schedule-rules";

export type ScheduleOutlet = {
  id: string;
  name: string;
  timezone: string;
  imageUrl?: string | null;
};

export type ScheduleStaff = {
  userId: string;
  name: string;
  email: string;
  photoUrl: string | null;
  /** False when the person has shifts here but is no longer assigned to the outlet. */
  isMember: boolean;
  canEdit: boolean;
};

export type ShiftTemplate = {
  id: string;
  outletId: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  color: ShiftColor;
};

export type ScheduledShift = {
  id: string;
  userId: string;
  outletId: string;
  date: string;
  startAt: string;
  endAt: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  breakMinutes: number;
  templateId: string | null;
  note: string | null;
  status: "draft" | "published";
  attendance: ShiftAttendance | null;
};

export type UnscheduledSession = {
  id: string;
  userId: string;
  name: string;
  date: string;
  clockInTime: string;
  clockOutTime: string | null;
  workedMinutes: number | null;
};

export type ScheduleData = {
  outlets: ScheduleOutlet[];
  outlet: ScheduleOutlet;
  from: string;
  to: string;
  today: string;
  now: string;
  currentUserId: string;
  isSuperAdmin: boolean;
  staff: ScheduleStaff[];
  templates: ShiftTemplate[];
  shifts: ScheduledShift[];
  unscheduled: UnscheduledSession[];
  summary: AttendanceSummaryRow[];
};
