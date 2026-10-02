"use client";

import { managementNavigation, WorkspaceShell } from "@/app/workspace-shell";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

type TimesheetRow = {
  id: string;
  userId: string;
  employeeName: string;
  employeeEmail: string;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string | null;
  clockInLocal: string;
  clockOutLocal: string | null;
  durationMinutes: number | null;
  clockInSource: "gps" | "manual";
  clockOutSource: "gps" | "manual" | null;
};

type TimesheetData = {
  outlets: { id: string; name: string; address: string }[];
  employees: { id: string; name: string; email: string }[];
  rows: TimesheetRow[];
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

export default function TimesheetsPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [data, setData] = useState<TimesheetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<TimesheetRow | null>(null);
  const [clockInAt, setClockInAt] = useState("");
  const [clockOutAt, setClockOutAt] = useState("");
  const [reason, setReason] = useState("");

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
    fetchTimesheetData(emptyFilters)
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
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(filters);
  }

  function startEdit(row: TimesheetRow) {
    setEditing(row);
    setClockInAt(row.clockInLocal.slice(0, 16).replace(" ", "T"));
    setClockOutAt(row.clockOutLocal?.slice(0, 16).replace(" ", "T") ?? "");
    setReason("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || isSaving) return;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/timesheets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          clockInAt,
          clockOutAt: clockOutAt || null,
          reason,
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
    data?.rows.filter((row) => row.durationMinutes !== null) ?? [];
  const totalMinutes = completedRows.reduce(
    (total, row) => total + (row.durationMinutes ?? 0),
    0,
  );
  const csvQuery = filterQuery(filters, "csv");

  return (
    <WorkspaceShell
      activeHref="/timesheets"
      pageTitle="Timesheets"
      workspaceName="Operations"
      navigation={managementNavigation}
    >
      <div className="team-page-content timesheet-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">PAYROLL REVIEW</p>
            <h1>Timesheets</h1>
            <p className="subheading">
              Review shifts across the outlets you manage.
            </p>
          </div>
          <div className="timesheet-heading-actions">
            <Link className="timesheet-cancel" href="/corrections/review">
              Review requests
            </Link>
            <a
              className="timesheet-export"
              href={`/api/timesheets?${csvQuery}`}
            >
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
            <span>Recorded hours</span>
            <strong>{(totalMinutes / 60).toFixed(1)}</strong>
          </div>
        </div>

        {message && (
          <p className="team-message" role="status">
            {message}
          </p>
        )}

        {editing && (
          <form className="timesheet-edit-form" onSubmit={saveEdit}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">{editing.outletName}</p>
                <h2>Edit shift · {editing.employeeName}</h2>
              </div>
              <button
                className="timesheet-cancel"
                type="button"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
            <div className="timesheet-edit-fields">
              <label>
                Clock in ({editing.timezone})
                <input
                  type="datetime-local"
                  required
                  value={clockInAt}
                  onChange={(event) => setClockInAt(event.target.value)}
                />
              </label>
              <label>
                Clock out ({editing.timezone})
                <input
                  type="datetime-local"
                  value={clockOutAt}
                  onChange={(event) => setClockOutAt(event.target.value)}
                />
              </label>
              <label className="timesheet-reason">
                Reason for change
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button className="auth-submit" type="submit" disabled={isSaving}>
                {isSaving ? "Saving…" : "Save audited edit"}
              </button>
            </div>
          </form>
        )}

        <section className="timesheet-table-section" aria-label="Shift records">
          <div className="team-table-wrap">
            <table className="team-table timesheet-table">
              <thead>
                <tr>
                  <th>EMPLOYEE</th>
                  <th>OUTLET</th>
                  <th>CLOCK IN</th>
                  <th>CLOCK OUT</th>
                  <th>HOURS</th>
                  <th>SOURCE</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.employeeName}</strong>
                      <small>{row.employeeEmail}</small>
                    </td>
                    <td>{row.outletName}</td>
                    <td>{row.clockInLocal}</td>
                    <td>{row.clockOutLocal ?? "Open shift"}</td>
                    <td>{formatDuration(row.durationMinutes)}</td>
                    <td>
                      {row.clockInSource === "manual" ||
                      row.clockOutSource === "manual" ? (
                        <span className="manual-adjustment-label">
                          Manually adjusted
                        </span>
                      ) : (
                        <span className="gps-source-label">GPS verified</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="timesheet-edit-button"
                        type="button"
                        onClick={() => startEdit(row)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {data && data.rows.length === 0 && (
                  <tr>
                    <td className="timesheet-empty" colSpan={7}>
                      No shifts match these filters.
                    </td>
                  </tr>
                )}
                {!data && isLoading && (
                  <tr>
                    <td className="timesheet-empty" colSpan={7}>
                      Loading shift records…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="timesheet-footnote">
            Date filters and displayed times use each outlet&apos;s timezone. Up
            to 500 matching shifts are shown.
          </p>
        </section>
      </div>
    </WorkspaceShell>
  );
}
