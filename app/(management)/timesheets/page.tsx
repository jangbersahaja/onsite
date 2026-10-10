"use client";

import {
  TimesheetEditDialog,
  type TimesheetEditValues,
} from "@/app/(management)/timesheets/_components/timesheet-edit-dialog";
import { outletDateTimeToISOString } from "@/lib/outlet-time";
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

type TimesheetStaffGroup = {
  key: string;
  employeeName: string;
  employeeEmail: string | null;
  outletName: string;
  rows: TimesheetRow[];
};

type TimesheetData = {
  outlets: { id: string; name: string; address: string }[];
  employees: { id: string; name: string; email: string }[];
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

function filterQuery(filters: Filters, format?: "csv") {
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
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function staffGroupKey(row: TimesheetRow) {
  const identity = row.userId
    ? `user:${row.userId}`
    : row.employeeEmail
      ? `email:${row.employeeEmail.toLowerCase()}`
      : `name:${row.employeeName.trim().toLowerCase()}`;
  return `${row.outletId}:${identity}`;
}

export default function TimesheetsPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [data, setData] = useState<TimesheetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<TimesheetRow | null>(null);

  async function load(nextFilters: Filters) {
    setIsLoading(true);
    setMessage("");
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
    void load(filters);
  }

  function startEdit(row: TimesheetRow) {
    if (row.source !== "onsite") return;
    setEditing(row);
  }

  async function saveEdit(values: TimesheetEditValues) {
    if (!editing || isSaving) return;
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
      setMessage("Shift updated and audit record saved.");
      await load(filters);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update this shift.",
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
        employeeName: row.employeeName,
        employeeEmail: row.employeeEmail,
        outletName: row.outletName,
        rows: [row],
      });
    }
  }
  const csvQuery = filterQuery(filters, "csv");

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
          <Link className="timesheet-cancel" href="/corrections/review">
            Review requests
          </Link>
          <a className="timesheet-export" href={`/api/timesheets?${csvQuery}`}>
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
        <button className="auth-submit" type="submit" disabled={isLoading}>
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
              <span>{group.outletName}</span>
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
                  {group.rows.map((row) => {
                    const clockIn = splitLocalTimestamp(row.clockInLocal);
                    const clockOut = splitLocalTimestamp(row.clockOutLocal);
                    return (
                      <tr key={row.id}>
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
                        <td className="timesheet-clock-time">
                          {clockIn?.time}
                        </td>
                        <td className="timesheet-clock-time">
                          {clockOut?.time ?? "Open shift"}
                        </td>
                        <td>
                          <strong className="timesheet-worked">
                            {formatDuration(row.durationMinutes)}
                          </strong>
                          <small className="timesheet-duration-detail">
                            Gross {formatDuration(row.grossDurationMinutes)}
                            <span aria-hidden="true"> · </span>
                            Break{" "}
                            {row.breakMinutes === null
                              ? "Not provided"
                              : formatDuration(row.breakMinutes)}
                          </small>
                        </td>
                        <td>
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
                              <button
                                className="timesheet-edit-button"
                                type="button"
                                onClick={() => startEdit(row)}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      {group.rows.length} shift{" "}
                      {group.rows.length === 1 ? "record" : "records"}
                    </td>
                    <td className="timesheet-table-total-hours" colSpan={2}>
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
    </div>
  );
}
