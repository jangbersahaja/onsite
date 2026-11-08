"use client";

import {
  TimesheetCreateDialog,
  type TimesheetCreateValues,
} from "@/app/(management)/timesheets/_components/timesheet-create-dialog";
import { TimesheetDeleteDialog } from "@/app/(management)/timesheets/_components/timesheet-delete-dialog";
import {
  TimesheetEditDialog,
  type TimesheetEditValues,
} from "@/app/(management)/timesheets/_components/timesheet-edit-dialog";
import { TimesheetImportDialog } from "@/app/(management)/timesheets/_components/timesheet-import-dialog";
import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { EditIcon, PlusIcon, TrashIcon } from "@/app/_components/icons";
import { OutletAvatar } from "@/app/_components/outlet-avatar";
import {
  formatOutletDateTime,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import { getOffDayDateKeys } from "@/lib/timesheet-off-days";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type TimesheetRow = {
  id: string;
  source: "onsite" | "storehub";
  userId: string | null;
  employeeName: string;
  employeeEmail: string | null;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string | null;
  clockInLocal: string;
  clockOutLocal: string | null;
  grossDurationMinutes: number | null;
  breakMinutes: number | null;
  durationMinutes: number | null;
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
  clockInSource: "gps" | "manual" | "storehub";
  clockOutSource: "gps" | "manual" | "storehub" | null;
};

type TimelineItem =
  | { kind: "shift"; date: string; row: TimesheetRow }
  | { kind: "off-days"; from: string; to: string; count: number };

type TimesheetStaffGroup = {
  key: string;
  userId: string | null;
  outletId: string;
  outletName: string;
  timezone: string;
  employeeName: string;
  employeeEmail: string | null;
  rows: TimesheetRow[];
  timeline: TimelineItem[];
};

type TimesheetStaff = {
  userId: string;
  name: string;
  email: string;
  outletId: string;
  outletName: string;
  timezone: string;
};

type ShiftTarget = {
  userId: string;
  outletId: string;
  outletName: string;
  timezone: string;
  employeeName: string;
};

type TimesheetData = {
  outlets: {
    id: string;
    name: string;
    address: string;
    timezone: string;
    imageUrl?: string | null;
  }[];
  employees: {
    id: string;
    name: string;
    email: string;
    outletIds: string[];
  }[];
  staff: TimesheetStaff[];
  currentUserId: string;
  isSuperAdmin: boolean;
  rows: TimesheetRow[];
  storeHubStatus: "not_configured" | "available" | "unavailable";
  storeHubFetchedAt: string | null;
  truncated: boolean;
};

type Filters = {
  outletId: string;
  employeeId: string;
  from: string;
  to: string;
};

const emptyFilters: Filters = {
  outletId: "",
  employeeId: "",
  from: "",
  to: "",
};

const timesheetFiltersStorageKey = "onsite-timesheet-filters";

// Ignores responses from superseded filter requests.
let latestLoadId = 0;

function readSavedFilters(): Filters {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(timesheetFiltersStorageKey) ?? "null",
    ) as Partial<Filters> | null;
    if (!saved || typeof saved !== "object") return emptyFilters;
    return {
      outletId: typeof saved.outletId === "string" ? saved.outletId : "",
      employeeId: typeof saved.employeeId === "string" ? saved.employeeId : "",
      from: typeof saved.from === "string" ? saved.from : "",
      to: typeof saved.to === "string" ? saved.to : "",
    };
  } catch {
    return emptyFilters;
  }
}

function saveFilters(filters: Filters) {
  try {
    window.localStorage.setItem(
      timesheetFiltersStorageKey,
      JSON.stringify(filters),
    );
  } catch {
    return;
  }
}

function filterQuery(filters: Filters, format?: "csv" | "import-csv") {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (format) params.set("format", format);
  return params.toString();
}

async function fetchTimesheetData(nextFilters: Filters) {
  const query = filterQuery(nextFilters);
  const response = await fetch(`/api/timesheets${query ? `?${query}` : ""}`, {
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not load timesheets.");
  return body as TimesheetData;
}

const LONG_SHIFT_MINUTES = 10 * 60;

function formatDuration(minutes: number | null) {
  if (minutes === null) return "In progress";
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function splitLocalTimestamp(timestamp: string | null) {
  if (!timestamp) return null;
  const separator = timestamp.indexOf(" ");
  if (separator < 0) return { date: timestamp, time: "" };
  return {
    date: timestamp.slice(0, separator),
    time: timestamp.slice(separator + 1),
  };
}

function formatShiftDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatBreakTime(timestamp: string, timezone: string) {
  return formatOutletDateTime(timestamp, timezone).slice(11);
}

function staffGroupKey(row: TimesheetRow) {
  const identity = row.userId
    ? `user:${row.userId}`
    : row.employeeEmail
      ? `email:${row.employeeEmail.toLowerCase()}`
      : `name:${row.employeeName.trim().toLowerCase()}`;
  return `${row.outletId}:${identity}`;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function timelineStart(item: TimelineItem) {
  return item.kind === "shift" ? item.date : item.from;
}

function buildTimeline(
  group: TimesheetStaffGroup,
  filters: Filters,
  truncated: boolean,
): TimelineItem[] {
  const shifts: TimelineItem[] = group.rows.map((row) => ({
    kind: "shift" as const,
    date: row.clockInLocal.slice(0, 10),
    row,
  }));
  const offDays: TimelineItem[] = [];
  if (group.userId && !truncated) {
    const today = formatOutletDateTime(new Date(), group.timezone).slice(0, 10);
    const offDayDates = getOffDayDateKeys({
      from: filters.from,
      to: filters.to,
      today,
      workedDateKeys: shifts.map((item) => timelineStart(item)),
    });
    offDays.push(
      ...offDayDates.map((date) => ({
        kind: "off-days" as const,
        from: date,
        to: date,
        count: 1,
      })),
    );
  }
  const sorted = [...shifts, ...offDays].sort((left, right) =>
    timelineStart(left).localeCompare(timelineStart(right)),
  );

  const timeline: TimelineItem[] = [];
  for (const item of sorted) {
    const last = timeline[timeline.length - 1];
    if (
      item.kind === "off-days" &&
      last?.kind === "off-days" &&
      addDays(last.to, 1) === item.from
    ) {
      last.to = item.to;
      last.count += item.count;
      continue;
    }
    timeline.push(item);
  }
  return timeline;
}

type DatePreset =
  | "today"
  | "week"
  | "last7"
  | "month"
  | "lastMonth"
  | "salary"
  | "lastSalary"
  | "all";

// Payroll periods run from the day after this cutoff to the cutoff of the next month.
const SALARY_CUTOFF_DAY = 25;

const datePresets: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "last7", label: "Last 7 days" },
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "salary", label: "Salary period" },
  { value: "lastSalary", label: "Last salary period" },
  { value: "all", label: "All dates" },
];

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

// Preset ranges are calculated from the outlet's "today" date key.
function presetRange(preset: DatePreset, today: string) {
  const [year, monthNumber, day] = today.split("-").map(Number);
  const month = monthNumber - 1;
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const offset = (new Date(Date.UTC(year, month, day)).getUTCDay() + 6) % 7;
      return {
        from: utcDateKey(new Date(Date.UTC(year, month, day - offset))),
        to: utcDateKey(new Date(Date.UTC(year, month, day - offset + 6))),
      };
    }
    case "last7":
      return {
        from: utcDateKey(new Date(Date.UTC(year, month, day - 6))),
        to: today,
      };
    case "month":
      return {
        from: utcDateKey(new Date(Date.UTC(year, month, 1))),
        to: utcDateKey(new Date(Date.UTC(year, month + 1, 0))),
      };
    case "lastMonth":
      return {
        from: utcDateKey(new Date(Date.UTC(year, month - 1, 1))),
        to: utcDateKey(new Date(Date.UTC(year, month, 0))),
      };
    case "salary":
      return salaryRange(year, month, day, 0);
    case "lastSalary":
      return salaryRange(year, month, day, -1);
    case "all":
      return { from: "", to: "" };
  }
}

function salaryRange(year: number, month: number, day: number, shift: number) {
  const base = day > SALARY_CUTOFF_DAY ? 0 : -1;
  const start = Date.UTC(year, month + base + shift, SALARY_CUTOFF_DAY + 1);
  const end = Date.UTC(year, month + base + shift + 1, SALARY_CUTOFF_DAY);
  return {
    from: utcDateKey(new Date(start)),
    to: utcDateKey(new Date(end)),
  };
}

function describeDateRange(from: string, to: string) {
  if (from && to) {
    return from === to
      ? formatShiftDate(from)
      : `${formatShiftDate(from)} – ${formatShiftDate(to)}`;
  }
  return from
    ? `From ${formatShiftDate(from)}`
    : `Until ${formatShiftDate(to)}`;
}

export default function TimesheetsPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [data, setData] = useState<TimesheetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<TimesheetRow | null>(null);
  const [deleting, setDeleting] = useState<TimesheetRow | null>(null);
  const [creatingFor, setCreatingFor] = useState<ShiftTarget | null>(null);
  const [importing, setImporting] = useState(false);
  const [expandedShiftIds, setExpandedShiftIds] = useState<
    Set<TimesheetRow["id"]>
  >(() => new Set());

  function toggleShiftDetails(id: TimesheetRow["id"]) {
    setExpandedShiftIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const [openLongTipId, setOpenLongTipId] = useState<TimesheetRow["id"] | null>(
    null,
  );

  useEffect(() => {
    if (openLongTipId === null) return;
    function handlePointerDown(event: Event) {
      if (!(event.target as Element).closest?.("[data-long-tip]"))
        setOpenLongTipId(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenLongTipId(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openLongTipId]);

  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(
    () => new Set(),
  );

  function toggleGroupCollapsed(key: string) {
    setCollapsedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const [rangeOpen, setRangeOpen] = useState(false);
  const [draftRange, setDraftRange] = useState({ from: "", to: "" });
  const rangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rangeOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rangeRef.current?.contains(event.target as Node))
        setRangeOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setRangeOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [rangeOpen]);

  async function load(nextFilters: Filters) {
    const requestId = ++latestLoadId;
    setIsLoading(true);
    try {
      const loaded = await fetchTimesheetData(nextFilters);
      if (requestId === latestLoadId) setData(loaded);
    } catch (error) {
      if (requestId === latestLoadId)
        setMessage(
          error instanceof Error ? error.message : "Could not load timesheets.",
        );
    } finally {
      if (requestId === latestLoadId) setIsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const savedFilters = readSavedFilters();
    fetchTimesheetData(savedFilters)
      .then((loaded) => {
        if (active) setData(loaded);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load timesheets.",
          );
      })
      .finally(() => {
        if (active) {
          setFilters(savedFilters);
          setAppliedFilters(savedFilters);
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const presetTimezone =
    data?.outlets.find((outlet) => outlet.id === filters.outletId)?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = formatOutletDateTime(new Date(), presetTimezone).slice(0, 10);
  const activePreset =
    datePresets.find((preset) => {
      const range = presetRange(preset.value, today);
      return range.from === filters.from && range.to === filters.to;
    })?.value ?? null;
  const activePresetLabel = datePresets.find(
    (preset) => preset.value === activePreset,
  )?.label;
  const rangeTitle = activePresetLabel ?? "Custom range";
  const rangeSubtitle =
    filters.from || filters.to
      ? describeDateRange(filters.from, filters.to)
      : "No date limit";
  const draftInvalid = Boolean(
    draftRange.from && draftRange.to && draftRange.from > draftRange.to,
  );
  const employeeOptions = (data?.employees ?? [])
    .filter(
      (employee) =>
        !filters.outletId || employee.outletIds.includes(filters.outletId),
    )
    .sort((left, right) =>
      left.name.localeCompare(right.name, "en", {
        numeric: true,
        sensitivity: "base",
      }),
    );
  const rangeInvalid = Boolean(
    filters.from && filters.to && filters.from > filters.to,
  );
  const activeChips: { key: string; label: string; onRemove: () => void }[] =
    [];
  if (filters.outletId) {
    activeChips.push({
      key: "outlet",
      label:
        data?.outlets.find((outlet) => outlet.id === filters.outletId)?.name ??
        "Outlet",
      onRemove: () => updateFilters({ outletId: "" }),
    });
  }
  if (filters.employeeId) {
    activeChips.push({
      key: "employee",
      label:
        data?.employees.find((employee) => employee.id === filters.employeeId)
          ?.name ?? "Employee",
      onRemove: () => updateFilters({ employeeId: "" }),
    });
  }
  if (filters.from || filters.to) {
    activeChips.push({
      key: "range",
      label: describeDateRange(filters.from, filters.to),
      onRemove: () => updateFilters({ from: "", to: "" }),
    });
  }

  function applyFilters(next: Filters) {
    if (next.from && next.to && next.from > next.to) return;
    saveFilters(next);
    setAppliedFilters(next);
    setMessage("");
    void load(next);
  }

  // Every filter change applies immediately; invalid ranges wait for a fix.
  function updateFilters(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    const outletChanged =
      patch.outletId !== undefined && patch.outletId !== filters.outletId;
    if (outletChanged && next.employeeId) {
      const employee = data?.employees.find(
        (item) => item.id === next.employeeId,
      );
      if (
        !employee ||
        (next.outletId && !employee.outletIds.includes(next.outletId))
      ) {
        next.employeeId = "";
      }
    }
    setFilters(next);
    applyFilters(next);
  }

  function toggleRangePanel() {
    if (!rangeOpen) setDraftRange({ from: filters.from, to: filters.to });
    setRangeOpen(!rangeOpen);
  }

  function pickPreset(preset: DatePreset) {
    updateFilters(presetRange(preset, today));
    setRangeOpen(false);
  }

  function applyDraftRange() {
    if (draftInvalid) return;
    updateFilters(draftRange);
    setRangeOpen(false);
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyFilters(filters);
  }

  function startEdit(row: TimesheetRow) {
    if (row.source !== "onsite") return;
    setEditing(row);
  }

  const { confirm, confirmDialog } = useConfirmDialog();

  async function saveEdit(values: TimesheetEditValues) {
    if (!editing || isSaving) return;
    if (
      !(await confirm({
        title: "Save timesheet changes?",
        description: "This shift's times and breaks will be updated.",
        confirmLabel: "Save changes",
      }))
    )
      return;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/timesheets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          outletId: editing.outletId,
          clockInAt: values.clockInAt,
          clockOutAt: values.clockOutAt || null,
          breaks: values.breaks.map((breakInterval) => ({
            id: breakInterval.id,
            startedAt: outletDateTimeToISOString(
              breakInterval.startedAt,
              editing.timezone,
            ),
            endedAt: breakInterval.endedAt
              ? outletDateTimeToISOString(
                  breakInterval.endedAt,
                  editing.timezone,
                )
              : null,
          })),
          reason: values.reason,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not update this shift.");
      setEditing(null);
      setMessage(
        `Timesheet entry updated for ${editing.employeeName} on ${formatShiftDate(editing.clockInLocal.slice(0, 10))}.`,
      );
      await load(appliedFilters);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update this shift.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function canChangeShifts(userId: string | null) {
    return Boolean(
      data && userId && (data.isSuperAdmin || userId !== data.currentUserId),
    );
  }

  function openCreate(group: TimesheetStaffGroup) {
    if (!group.userId) return;
    setCreatingFor({
      userId: group.userId,
      outletId: group.outletId,
      outletName: group.outletName,
      timezone: group.timezone,
      employeeName: group.employeeName,
    });
  }

  async function saveCreate(values: TimesheetCreateValues) {
    if (!creatingFor || isSaving) return;
    const target = creatingFor;
    const shiftDate = values.clockInAt.slice(0, 10);
    if (
      !(await confirm({
        title: "Add this shift?",
        description: `A shift on ${formatShiftDate(shiftDate)} will be added for ${target.employeeName} and recorded in the audit log.`,
        confirmLabel: "Add shift",
      }))
    )
      return;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: target.outletId,
          userId: target.userId,
          clockInAt: values.clockInAt,
          clockOutAt: values.clockOutAt,
          breaks: values.breaks.map((breakInterval) => ({
            startedAt: outletDateTimeToISOString(
              breakInterval.startedAt,
              target.timezone,
            ),
            endedAt: outletDateTimeToISOString(
              breakInterval.endedAt,
              target.timezone,
            ),
          })),
          reason: values.reason,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not add this shift.");
      const outsideDateFilter = Boolean(
        (appliedFilters.from && shiftDate < appliedFilters.from) ||
        (appliedFilters.to && shiftDate > appliedFilters.to),
      );
      setCreatingFor(null);
      setMessage(
        `Shift added for ${target.employeeName}.${
          outsideDateFilter
            ? " It is outside the current date filter, so it is not listed."
            : ""
        }`,
      );
      await load(appliedFilters);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not add this shift.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteShift(row: TimesheetRow, reason: string) {
    if (isSaving) return;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/timesheets?id=${encodeURIComponent(row.id)}&reason=${encodeURIComponent(reason)}`,
        { method: "DELETE" },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not delete this shift.");
      setMessage(
        `Shift deleted for ${row.employeeName} on ${formatShiftDate(row.clockInLocal.slice(0, 10))}.`,
      );
      await load(appliedFilters);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not delete this shift.",
      );
    } finally {
      setDeleting(null);
      setIsSaving(false);
    }
  }

  const completedRows =
    data?.rows.filter((row) => row.clockOutAt !== null) ?? [];
  const totalMinutes = completedRows.reduce(
    (total, row) => total + (row.durationMinutes ?? 0),
    0,
  );
  const sortedRows = [...(data?.rows ?? [])].sort((left, right) => {
    const outletOrder = left.outletName.localeCompare(right.outletName, "en", {
      numeric: true,
      sensitivity: "base",
    });
    if (outletOrder !== 0) return outletOrder;
    const outletIdOrder = left.outletId.localeCompare(right.outletId);
    if (outletIdOrder !== 0) return outletIdOrder;

    const employeeOrder = left.employeeName.localeCompare(
      right.employeeName,
      "en",
      { numeric: true, sensitivity: "base" },
    );
    if (employeeOrder !== 0) return employeeOrder;
    const staffOrder = staffGroupKey(left).localeCompare(
      staffGroupKey(right),
      "en",
      { numeric: true, sensitivity: "base" },
    );
    if (staffOrder !== 0) return staffOrder;

    return (
      left.clockInLocal
        .slice(0, 10)
        .localeCompare(right.clockInLocal.slice(0, 10)) ||
      left.id.localeCompare(right.id)
    );
  });
  const staffGroups: TimesheetStaffGroup[] = [];
  for (const row of sortedRows) {
    const key = staffGroupKey(row);
    const lastGroup = staffGroups[staffGroups.length - 1];
    if (lastGroup?.key === key) {
      lastGroup.rows.push(row);
    } else {
      staffGroups.push({
        key,
        userId: row.userId,
        outletId: row.outletId,
        outletName: row.outletName,
        timezone: row.timezone,
        employeeName: row.employeeName,
        employeeEmail: row.employeeEmail,
        rows: [row],
        timeline: [],
      });
    }
  }
  // Staff with no shifts in the current range still get a group so shifts can be added.
  const groupKeys = new Set(staffGroups.map((group) => group.key));
  for (const member of data?.staff ?? []) {
    const key = `${member.outletId}:user:${member.userId}`;
    if (groupKeys.has(key)) continue;
    groupKeys.add(key);
    staffGroups.push({
      key,
      userId: member.userId,
      outletId: member.outletId,
      outletName: member.outletName,
      timezone: member.timezone,
      employeeName: member.name,
      employeeEmail: member.email,
      rows: [],
      timeline: [],
    });
  }
  staffGroups.sort(
    (left, right) =>
      left.outletName.localeCompare(right.outletName, "en", {
        numeric: true,
        sensitivity: "base",
      }) ||
      left.outletId.localeCompare(right.outletId) ||
      left.employeeName.localeCompare(right.employeeName, "en", {
        numeric: true,
        sensitivity: "base",
      }) ||
      left.key.localeCompare(right.key),
  );
  for (const group of staffGroups) {
    group.timeline = buildTimeline(
      group,
      appliedFilters,
      Boolean(data?.truncated),
    );
  }
  const csvQuery = filterQuery(appliedFilters, "csv");
  const importExportHref = (outletId: string) =>
    `/api/timesheets?${filterQuery({ ...appliedFilters, outletId }, "import-csv")}`;

  return (
    <div className="team-page-content timesheet-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PAYROLL REVIEW</p>
          <h1>Timesheets</h1>
          <p className="subheading">
            Review shifts and hours across the outlets you manage.
          </p>
        </div>
        <div className="timesheet-heading-actions">
          <Link className="btn btn-secondary" href="/corrections/review">
            Review requests
          </Link>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!data?.outlets.length || !appliedFilters.outletId}
            title={
              appliedFilters.outletId ? undefined : "Choose an outlet to import"
            }
            onClick={() => setImporting(true)}
          >
            Import CSV
          </button>
          <a className="btn btn-secondary" href={`/api/timesheets?${csvQuery}`}>
            <span aria-hidden="true">↓</span> Export CSV
          </a>
        </div>
      </div>

      <form
        className="timesheet-filters timesheet-filter-bar"
        onSubmit={handleFilterSubmit}
      >
        <label>
          Outlet
          <select
            value={filters.outletId}
            onChange={(event) =>
              updateFilters({ outletId: event.target.value })
            }
          >
            <option value="">All managed outlets</option>
            {data?.outlets.map((outlet) => (
              <option value={outlet.id} key={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Employee
          <select
            value={filters.employeeId}
            onChange={(event) =>
              updateFilters({ employeeId: event.target.value })
            }
          >
            <option value="">All employees</option>
            {employeeOptions.map((employee) => (
              <option value={employee.id} key={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
        <div className="timesheet-range-field" ref={rangeRef}>
          <span className="timesheet-range-label">Date range</span>
          <button
            className="timesheet-range-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={rangeOpen}
            onClick={toggleRangePanel}
          >
            <span>
              <strong>{rangeTitle}</strong>
              <small>{rangeSubtitle}</small>
            </span>
            <span aria-hidden="true">{rangeOpen ? "▴" : "▾"}</span>
          </button>
          {rangeOpen && (
            <div
              className="timesheet-range-panel"
              role="dialog"
              aria-label="Choose date range"
            >
              <p className="timesheet-range-heading">Quick ranges</p>
              <div className="timesheet-range-quick">
                {datePresets.map((preset) => (
                  <button
                    className="timesheet-range-option"
                    type="button"
                    key={preset.value}
                    aria-pressed={activePreset === preset.value}
                    onClick={() => pickPreset(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="timesheet-range-divider" />
              <p className="timesheet-range-heading">Custom range</p>
              <div className="timesheet-range-dates">
                <label>
                  From
                  <input
                    type="date"
                    value={draftRange.from}
                    max={draftRange.to || undefined}
                    onChange={(event) =>
                      setDraftRange((current) => ({
                        ...current,
                        from: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={draftRange.to}
                    min={draftRange.from || undefined}
                    onChange={(event) =>
                      setDraftRange((current) => ({
                        ...current,
                        to: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="timesheet-range-actions">
                <button
                  className="timesheet-range-cancel"
                  type="button"
                  onClick={() => setRangeOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="timesheet-range-apply"
                  type="button"
                  disabled={draftInvalid}
                  onClick={applyDraftRange}
                >
                  Apply range
                </button>
              </div>
            </div>
          )}
        </div>
      </form>

      {(rangeInvalid || activeChips.length > 0) && (
        <div className="timesheet-filter-status">
          {rangeInvalid && (
            <p className="timesheet-filter-error" role="alert">
              The From date must be on or before the To date.
            </p>
          )}
          {activeChips.length > 0 && (
            <ul className="timesheet-chips" aria-label="Active filters">
              {activeChips.map((chip) => (
                <li className="timesheet-chip" key={chip.key}>
                  <span>{chip.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label} filter`}
                    onClick={chip.onRemove}
                  >
                    ×
                  </button>
                </li>
              ))}
              <li>
                <button
                  className="timesheet-chip-clear"
                  type="button"
                  onClick={() => updateFilters(emptyFilters)}
                >
                  Reset all
                </button>
              </li>
            </ul>
          )}
        </div>
      )}

      <div className="timesheet-summary" aria-live="polite">
        <div>
          <span>Shift records</span>
          <strong>{data?.rows.length ?? "—"}</strong>
        </div>
        <div>
          <span>Completed</span>
          <strong>{completedRows.length}</strong>
        </div>
        <div>
          <span>Worked hours</span>
          <strong>{(totalMinutes / 60).toFixed(1)}</strong>
        </div>
      </div>

      {data && !appliedFilters.outletId && (
        <p className="timesheet-footnote">
          Choose one outlet to enable CSV import.
        </p>
      )}
      {data?.truncated && (
        <p className="team-message" role="status">
          Showing the first 500 matching shifts. Narrow the date range to see
          the rest.
        </p>
      )}
      {message && (
        <p className="team-message" role="status">
          {message}
        </p>
      )}
      {data?.storeHubStatus === "unavailable" && (
        <p className="team-message" role="status">
          StoreHub attendance is temporarily unavailable. OnSITE timesheets are
          still shown.
        </p>
      )}

      {editing && (
        <TimesheetEditDialog
          key={editing.id}
          row={editing}
          isSaving={isSaving}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSave={saveEdit}
        />
      )}

      {importing && data && (
        <TimesheetImportDialog
          outlets={data.outlets.map((outlet) => ({
            id: outlet.id,
            name: outlet.name,
          }))}
          outletId={appliedFilters.outletId}
          importExportHref={importExportHref(appliedFilters.outletId)}
          onOpenChange={(open) => {
            if (!open) setImporting(false);
          }}
          onImported={(importMessage) => {
            setImporting(false);
            setMessage(importMessage);
            void load(appliedFilters);
          }}
        />
      )}

      {deleting && (
        <TimesheetDeleteDialog
          employeeName={deleting.employeeName}
          shiftLabel={formatShiftDate(deleting.clockInLocal.slice(0, 10))}
          isSaving={isSaving}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onConfirm={(reason) => deleteShift(deleting, reason)}
        />
      )}

      {creatingFor && (
        <TimesheetCreateDialog
          employeeName={creatingFor.employeeName}
          outletName={creatingFor.outletName}
          timezone={creatingFor.timezone}
          isSaving={isSaving}
          onOpenChange={(open) => {
            if (!open) setCreatingFor(null);
          }}
          onSave={saveCreate}
        />
      )}

      {staffGroups.length > 1 && (
        <nav className="timesheet-staff-index" aria-label="Jump to staff">
          <button
            className="timesheet-staff-index-toggle"
            type="button"
            onClick={() =>
              setCollapsedGroupKeys(
                collapsedGroupKeys.size === staffGroups.length
                  ? new Set()
                  : new Set(staffGroups.map((group) => group.key)),
              )
            }
          >
            {collapsedGroupKeys.size === staffGroups.length
              ? "Expand all"
              : "Collapse all"}
          </button>
          {staffGroups.map((group, groupIndex) => (
            <a key={group.key} href={`#timesheet-staff-${groupIndex}`}>
              <span>{group.employeeName}</span>
              <small>
                {formatDuration(
                  group.rows.reduce(
                    (total, row) => total + (row.durationMinutes ?? 0),
                    0,
                  ),
                )}
              </small>
            </a>
          ))}
        </nav>
      )}

      <section className="timesheet-table-section" aria-label="Shift records">
        {staffGroups.map((group, groupIndex) => (
          <section
            className="timesheet-staff-group"
            aria-labelledby={`timesheet-staff-${groupIndex}`}
            data-collapsed={collapsedGroupKeys.has(group.key)}
            key={group.key}
          >
            <header className="timesheet-staff-heading">
              <div>
                <h2 id={`timesheet-staff-${groupIndex}`}>
                  {group.employeeName}
                </h2>
                {group.employeeEmail && <small>{group.employeeEmail}</small>}
                <small className="timesheet-staff-summary">
                  {group.rows.length}{" "}
                  {group.rows.length === 1 ? "record" : "records"} ·{" "}
                  {formatDuration(
                    group.rows.reduce(
                      (total, row) => total + (row.durationMinutes ?? 0),
                      0,
                    ),
                  )}
                </small>
              </div>
              <div className="timesheet-staff-actions">
                <button
                  className="btn btn-secondary btn-sm timesheet-collapse-toggle"
                  type="button"
                  aria-expanded={!collapsedGroupKeys.has(group.key)}
                  aria-controls={`timesheet-table-${groupIndex}`}
                  onClick={() => toggleGroupCollapsed(group.key)}
                >
                  {collapsedGroupKeys.has(group.key) ? "Show" : "Hide"}
                </button>
                <span className="outlet-inline">
                  <OutletAvatar
                    name={group.outletName}
                    imageUrl={
                      data?.outlets.find(
                        (outlet) => outlet.id === group.outletId,
                      )?.imageUrl
                    }
                    className="outlet-avatar outlet-avatar-sm"
                  />
                  {group.outletName}
                </span>
              </div>
            </header>
            <div
              className="team-table-wrap"
              id={`timesheet-table-${groupIndex}`}
            >
              <table className="team-table timesheet-table">
                <thead>
                  <tr>
                    <th>SHIFT DATE</th>
                    <th>CLOCK IN</th>
                    <th>CLOCK OUT</th>
                    <th>WORKED</th>
                    <th>RECORD</th>
                  </tr>
                </thead>
                <tbody>
                  {group.timeline.map((item) => {
                    if (item.kind === "off-days") {
                      return (
                        <tr
                          className="timesheet-off-day-row"
                          key={`off-days-${item.from}`}
                        >
                          <td colSpan={5}>
                            <time dateTime={item.from}>
                              {formatShiftDate(item.from)}
                            </time>
                            {item.count > 1 && (
                              <>
                                <span aria-hidden="true"> – </span>
                                <time dateTime={item.to}>
                                  {formatShiftDate(item.to)}
                                </time>
                              </>
                            )}
                            <span aria-hidden="true"> · </span>
                            {item.count === 1
                              ? "Off day"
                              : `${item.count} off days`}
                          </td>
                        </tr>
                      );
                    }
                    const row = item.row;
                    const clockIn = splitLocalTimestamp(row.clockInLocal);
                    const clockOut = splitLocalTimestamp(row.clockOutLocal);
                    const isExpanded = expandedShiftIds.has(row.id);
                    const isLongTipOpen = openLongTipId === row.id;
                    const isLongShift =
                      row.durationMinutes !== null &&
                      row.durationMinutes > LONG_SHIFT_MINUTES;
                    return (
                      <tr
                        key={row.id}
                        data-expanded={isExpanded}
                        data-long={isLongShift}
                      >
                        <td>
                          <div className="timesheet-shift-date">
                            <time dateTime={row.clockInAt}>
                              {clockIn && formatShiftDate(clockIn.date)}
                            </time>
                            {clockOut &&
                              clockIn &&
                              clockOut.date !== clockIn.date && (
                                <small>
                                  Ends {formatShiftDate(clockOut.date)}
                                </small>
                              )}
                          </div>
                        </td>
                        <td
                          className="timesheet-clock-time"
                          data-label="Clock in"
                        >
                          {clockIn?.time.slice(0, 5)}
                        </td>
                        <td
                          className={
                            clockOut
                              ? "timesheet-clock-time"
                              : "timesheet-clock-time timesheet-open-shift"
                          }
                          data-label="Clock out"
                        >
                          {clockOut ? clockOut.time.slice(0, 5) : "Open shift"}
                        </td>
                        <td data-label="Worked">
                          <div className="timesheet-worked-row">
                            <strong
                              className={
                                isLongShift
                                  ? "timesheet-worked timesheet-worked-long"
                                  : "timesheet-worked"
                              }
                            >
                              {formatDuration(row.durationMinutes)}
                            </strong>
                            {isLongShift && (
                              <button
                                className="timesheet-long-shift"
                                type="button"
                                aria-expanded={isLongTipOpen}
                                aria-label="Over 10 hours. Check this shift for a missed clock-out or a long break."
                                data-long-tip
                                data-tip="Over 10 hours. Check this shift for a missed clock-out or a long break."
                                onClick={() =>
                                  setOpenLongTipId(
                                    isLongTipOpen ? null : row.id,
                                  )
                                }
                              >
                                !
                              </button>
                            )}
                            <button
                              className="timesheet-details-toggle timesheet-icon-button"
                              type="button"
                              aria-expanded={isExpanded}
                              aria-label={
                                isExpanded
                                  ? "Hide shift details"
                                  : "Show shift details"
                              }
                              onClick={() => toggleShiftDetails(row.id)}
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </button>
                          </div>
                          {isExpanded && row.breakMinutes !== 0 && (
                            <small className="timesheet-duration-detail">
                              Gross {formatDuration(row.grossDurationMinutes)}
                              <span aria-hidden="true"> · </span>
                              Break{" "}
                              {row.breakMinutes === null
                                ? "Not provided"
                                : formatDuration(row.breakMinutes)}
                              {row.breaks.map((breakInterval) => (
                                <span
                                  className="timesheet-break-item"
                                  key={breakInterval.id}
                                >
                                  Break start{" "}
                                  {formatBreakTime(
                                    breakInterval.startedAt,
                                    row.timezone,
                                  )}
                                  <span aria-hidden="true"> · </span>
                                  end{" "}
                                  {breakInterval.endedAt
                                    ? formatBreakTime(
                                        breakInterval.endedAt,
                                        row.timezone,
                                      )
                                    : "Not ended"}
                                </span>
                              ))}
                            </small>
                          )}
                        </td>
                        <td data-label="Record">
                          <div className="timesheet-record-cell">
                            {row.source === "storehub" ? (
                              <span className="storehub-source-label">
                                StoreHub · read-only
                              </span>
                            ) : row.clockInSource === "manual" ||
                              row.clockOutSource === "manual" ? (
                              <span className="manual-adjustment-label">
                                Manually adjusted
                              </span>
                            ) : (
                              <span className="gps-source-label">
                                GPS verified
                              </span>
                            )}
                            {row.source === "onsite" && (
                              <div className="timesheet-record-actions">
                                <button
                                  className="btn btn-ghost btn-icon btn-sm timesheet-icon-button"
                                  type="button"
                                  aria-label="Edit shift"
                                  title="Edit shift"
                                  onClick={() => startEdit(row)}
                                >
                                  <EditIcon />
                                </button>
                                {row.clockOutAt &&
                                  canChangeShifts(row.userId) && (
                                    <button
                                      className="btn btn-danger btn-icon btn-sm timesheet-icon-button"
                                      type="button"
                                      aria-label="Delete shift"
                                      title="Delete shift"
                                      onClick={() => setDeleting(row)}
                                    >
                                      <TrashIcon />
                                    </button>
                                  )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {group.timeline.length === 0 && (
                    <tr className="timesheet-empty-row">
                      <td colSpan={5}>No shifts in this range.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      {group.rows.length} shift{" "}
                      {group.rows.length === 1 ? "record" : "records"}
                    </td>
                    <td className="timesheet-table-total-hours">
                      <span>Total work hours</span>
                      <strong>
                        {formatDuration(
                          group.rows.reduce(
                            (total, row) => total + (row.durationMinutes ?? 0),
                            0,
                          ),
                        )}
                      </strong>
                    </td>
                    <td className="timesheet-add-shift-cell">
                      <div className="timesheet-add-shift-action">
                        {group.userId && canChangeShifts(group.userId) && (
                          <button
                            className="btn btn-secondary btn-icon btn-sm timesheet-icon-button"
                            type="button"
                            aria-label={`Add shift for ${group.employeeName}`}
                            title="Add shift"
                            onClick={() => openCreate(group)}
                          >
                            <PlusIcon />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ))}
        {staffGroups.length === 0 && data && (
          <p className="timesheet-empty-message">
            No shifts match these filters.
          </p>
        )}
        {staffGroups.length === 0 && !data && isLoading && (
          <p className="timesheet-empty-message">Loading shift records…</p>
        )}
        <p className="timesheet-footnote">
          Date filters and displayed times use each outlet&apos;s timezone. Up
          to 500 matching shifts are shown.
        </p>
      </section>
      {confirmDialog}
    </div>
  );
}
