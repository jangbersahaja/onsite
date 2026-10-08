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
  const csvQuery = filterQuery(filters, "csv");

  return (
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
        <div className="team-table-wrap">
          <table className="team-table timesheet-table">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>OUTLET</th>
                <th>CLOCK IN</th>
                <th>CLOCK OUT</th>
                <th>GROSS</th>
                <th>BREAK</th>
                <th>WORKED</th>
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
                    {row.employeeEmail && <small>{row.employeeEmail}</small>}
                    {row.source === "storehub" && (
                      <small className="storehub-source-label">
                        StoreHub · read-only
                      </small>
                    )}
                  </td>
                  <td>{row.outletName}</td>
                  <td>{row.clockInLocal}</td>
                  <td>{row.clockOutLocal ?? "Open shift"}</td>
                  <td>{formatDuration(row.grossDurationMinutes)}</td>
                  <td>
                    {row.breakMinutes === null
                      ? "Not provided"
                      : formatDuration(row.breakMinutes)}
                  </td>
                  <td>{formatDuration(row.durationMinutes)}</td>
                  <td>
                    {row.source === "storehub" ? (
                      <span className="storehub-source-label">
                        StoreHub import
                      </span>
                    ) : row.clockInSource === "manual" ||
                      row.clockOutSource === "manual" ? (
                      <span className="manual-adjustment-label">
                        Manually adjusted
                      </span>
                    ) : (
                      <span className="gps-source-label">GPS verified</span>
                    )}
                  </td>
                  <td>
                    {row.source === "onsite" ? (
                      <button
                        className="timesheet-edit-button"
                        type="button"
                        onClick={() => startEdit(row)}
                      >
                        Edit
                      </button>
                    ) : (
                      <span className="storehub-source-label">Read only</span>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.rows.length === 0 && (
                <tr>
                  <td className="timesheet-empty" colSpan={9}>
                    No shifts match these filters.
                  </td>
                </tr>
              )}
              {!data && isLoading && (
                <tr>
                  <td className="timesheet-empty" colSpan={9}>
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
  );
}
