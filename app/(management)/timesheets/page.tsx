"use client";

import {
  TimesheetCreateDialog,
  type TimesheetCreateValues,
} from "@/app/(management)/timesheets/_components/timesheet-create-dialog";
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
import { useEffect, useState, type FormEvent } from "react";

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
  | { kind: "off-day"; date: string };

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
    imageUrl?: string | null;
  }[];
  employees: { id: string; name: string; email: string }[];
  staff: TimesheetStaff[];
  currentUserId: string;
  isSuperAdmin: boolean;
  rows: TimesheetRow[];
  storeHubStatus: "not_configured" | "available" | "unavailable";
  storeHubFetchedAt: string | null;
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

function buildTimeline(
  group: TimesheetStaffGroup,
  filters: Filters,
): TimelineItem[] {
  const items: TimelineItem[] = group.rows.map((row) => ({
    kind: "shift" as const,
    date: row.clockInLocal.slice(0, 10),
    row,
  }));
  if (group.userId) {
    const today = formatOutletDateTime(new Date(), group.timezone).slice(0, 10);
    const offDays = getOffDayDateKeys({
      from: filters.from,
      to: filters.to,
      today,
      workedDateKeys: items.map((item) => item.date),
    });
    items.push(...offDays.map((date) => ({ kind: "off-day" as const, date })));
  }
  return items.sort((left, right) => left.date.localeCompare(right.date));
}

export default function TimesheetsPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [data, setData] = useState<TimesheetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<TimesheetRow | null>(null);
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

  async function load(nextFilters: Filters) {
    setIsLoading(true);
    try {
      setData(await fetchTimesheetData(nextFilters));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load timesheets.",
      );
    } finally {
      setIsLoading(false);
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
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveFilters(filters);
    setMessage("");
    void load(filters);
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
      setMessage("Timesheet entry updated.");
      await load(filters);
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
        (filters.from && shiftDate < filters.from) ||
        (filters.to && shiftDate > filters.to),
      );
      setCreatingFor(null);
      setMessage(
        `Shift added for ${target.employeeName}.${
          outsideDateFilter
            ? " It is outside the current date filter, so it is not listed."
            : ""
        }`,
      );
      await load(filters);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not add this shift.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteShift(row: TimesheetRow) {
    if (isSaving) return;
    if (
      !(await confirm({
        title: "Delete this shift?",
        description: `${row.employeeName}'s shift on ${formatShiftDate(row.clockInLocal.slice(0, 10))} and its breaks will be permanently removed. The deletion is kept in the audit log.`,
        confirmLabel: "Delete shift",
        tone: "danger",
      }))
    )
      return;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/timesheets?id=${encodeURIComponent(row.id)}`,
        { method: "DELETE" },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not delete this shift.");
      setMessage(`Shift deleted for ${row.employeeName}.`);
      await load(filters);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not delete this shift.",
      );
    } finally {
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
    group.timeline = buildTimeline(group, filters);
  }
  const csvQuery = filterQuery(filters, "csv");
  const importExportHref = (outletId: string) =>
    `/api/timesheets?${filterQuery({ ...filters, outletId }, "import-csv")}`;

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
            disabled={!data?.outlets.length || !filters.outletId}
            title={filters.outletId ? undefined : "Choose an outlet to import"}
            onClick={() => setImporting(true)}
          >
            Import CSV
          </button>
          <a className="btn btn-secondary" href={`/api/timesheets?${csvQuery}`}>
            <span aria-hidden="true">↓</span> Export CSV
          </a>
        </div>
      </div>

      <form className="timesheet-filters" onSubmit={handleFilterSubmit}>
        <label>
          Outlet
          <select
            value={filters.outletId}
            onChange={(event) =>
              setFilters({ ...filters, outletId: event.target.value })
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
              setFilters({ ...filters, employeeId: event.target.value })
            }
          >
            <option value="">All employees</option>
            {data?.employees.map((employee) => (
              <option value={employee.id} key={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters({ ...filters, from: event.target.value })
            }
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.to}
            onChange={(event) =>
              setFilters({ ...filters, to: event.target.value })
            }
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={isLoading}>
          Apply filters
        </button>
      </form>

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
          outletId={filters.outletId}
          importExportHref={importExportHref(filters.outletId)}
          onOpenChange={(open) => {
            if (!open) setImporting(false);
          }}
          onImported={(importMessage) => {
            setImporting(false);
            setMessage(importMessage);
            void load(filters);
          }}
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

      <section className="timesheet-table-section" aria-label="Shift records">
        {staffGroups.map((group, groupIndex) => (
          <section
            className="timesheet-staff-group"
            aria-labelledby={`timesheet-staff-${groupIndex}`}
            key={group.key}
          >
            <header className="timesheet-staff-heading">
              <div>
                <h2 id={`timesheet-staff-${groupIndex}`}>
                  {group.employeeName}
                </h2>
                {group.employeeEmail && <small>{group.employeeEmail}</small>}
              </div>
              <div className="timesheet-staff-actions">
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
            <div className="team-table-wrap">
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
                    if (item.kind === "off-day") {
                      return (
                        <tr
                          className="timesheet-off-day-row"
                          key={`off-day-${item.date}`}
                        >
                          <td colSpan={5}>
                            <time dateTime={item.date}>
                              {formatShiftDate(item.date)}
                            </time>
                            <span aria-hidden="true"> · </span>
                            Off day
                          </td>
                        </tr>
                      );
                    }
                    const row = item.row;
                    const clockIn = splitLocalTimestamp(row.clockInLocal);
                    const clockOut = splitLocalTimestamp(row.clockOutLocal);
                    const isExpanded = expandedShiftIds.has(row.id);
                    const isLongShift =
                      row.durationMinutes !== null &&
                      row.durationMinutes > LONG_SHIFT_MINUTES;
                    return (
                      <tr key={row.id} data-expanded={isExpanded}>
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
                              title={
                                isLongShift ? "Longer than 10 hours" : undefined
                              }
                            >
                              {formatDuration(row.durationMinutes)}
                            </strong>
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
                          {row.breakMinutes !== 0 && (
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
                                      onClick={() => void deleteShift(row)}
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
