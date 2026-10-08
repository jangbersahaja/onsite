"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type DashboardView = "today" | "yesterday" | "custom";
type ShiftStatus = "on_shift" | "on_break" | "finished";

type DashboardShift = {
  id: string;
  source: "onsite" | "storehub";
  userId: string | null;
  employeeName: string;
  profilePhotoUrl: string | null;
  clockInAt: string;
  clockOutAt: string | null;
  clockInLocal: string;
  clockOutLocal: string | null;
  status: ShiftStatus;
  workedMinutes: number | null;
  breakMinutes: number | null;
};

type DashboardOutlet = {
  id: string;
  name: string;
  address: string;
  timezone: string;
  date: string;
  windowStartAt: string;
  windowEndAt: string;
  evaluatedAt: string;
  storeHubStatus: "not_configured" | "available" | "unavailable";
  storeHubFetchedAt: string | null;
  onShiftCount: number;
  onBreakCount: number | null;
  workedMinutes: number | null;
  breakMinutes: number | null;
  shifts: DashboardShift[];
};

type DashboardData = {
  view: DashboardView;
  customDate: string | null;
  outlets: DashboardOutlet[];
};

function formatDuration(minutes: number | null) {
  if (minutes === null) return "Not provided";
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatShiftTime(value: string, scheduleDate: string) {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  return date === scheduleDate ? time : `${date.slice(5)} ${time}`;
}

const statusLabels: Record<ShiftStatus, string> = {
  on_shift: "On shift",
  on_break: "On break",
  finished: "Finished",
};

function DashboardShiftItem({
  shift,
  scheduleDate,
  layout,
}: {
  shift: DashboardShift;
  scheduleDate: string;
  layout: "card" | "row";
}) {
  return (
    <article
      className={
        layout === "card" ? "dashboard-staff-card" : "dashboard-staff-row"
      }
    >
      <div className="dashboard-staff-person">
        {shift.profilePhotoUrl ? (
          <Image
            className="dashboard-staff-avatar"
            src={shift.profilePhotoUrl}
            alt=""
            width={72}
            height={72}
            unoptimized
          />
        ) : (
          <span
            className="dashboard-staff-avatar dashboard-staff-initials"
            aria-hidden="true"
          >
            {shift.employeeName
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase())
              .join("")}
          </span>
        )}
        <div className="dashboard-staff-name">
          <strong>{shift.employeeName}</strong>
          {shift.source === "storehub" && (
            <span className="storehub-source-label">StoreHub · read-only</span>
          )}
          {layout === "card" && (
            <span className={`dashboard-status is-${shift.status}`}>
              {statusLabels[shift.status]}
            </span>
          )}
        </div>
      </div>
      <div className="dashboard-staff-detail dashboard-staff-shift">
        <small>SHIFT</small>
        <span>
          {formatShiftTime(shift.clockInLocal, scheduleDate)} –{" "}
          {shift.clockOutLocal
            ? formatShiftTime(shift.clockOutLocal, scheduleDate)
            : "In progress"}
        </span>
      </div>
      <div className="dashboard-staff-detail">
        <small>WORKED</small>
        <strong>{formatDuration(shift.workedMinutes)}</strong>
      </div>
      <div className="dashboard-staff-detail">
        <small>BREAK</small>
        <strong>{formatDuration(shift.breakMinutes)}</strong>
      </div>
    </article>
  );
}

export default function ManagePage() {
  const [view, setView] = useState<DashboardView>("today");
  const [customDate, setCustomDate] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let active = true;
    let refreshTimer: number | undefined;

    async function load(quiet = false) {
      if (view === "custom" && !customDate) {
        setIsLoading(false);
        return;
      }
      if (!quiet) setIsLoading(true);
      setMessage("");
      const params = new URLSearchParams({ view });
      if (view === "custom") params.set("date", customDate);
      try {
        const response = await fetch(`/api/dashboard?${params}`, {
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Could not load the schedule.");
        if (active) setData(body as DashboardData);
      } catch (error) {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load the schedule.",
          );
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void load();
    if (view === "today") {
      refreshTimer = window.setInterval(() => void load(true), 60_000);
    }
    return () => {
      active = false;
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    };
  }, [view, customDate, refreshCount]);

  function chooseView(nextView: DashboardView) {
    if (nextView === "custom" && !customDate) {
      setCustomDate(
        data?.outlets[0]?.date ?? new Date().toISOString().slice(0, 10),
      );
    }
    setView(nextView);
  }

  return (
    <main className="team-page-content dashboard-content">
      <div className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">MANAGEMENT</p>
          <h1>Daily schedule</h1>
          <p className="subheading">
            Staff activity and time totals across your outlets.
          </p>
        </div>
        <div className="dashboard-date-controls" aria-label="Schedule date">
          <div
            className="dashboard-date-tabs"
            role="group"
            aria-label="Date range"
          >
            {(["today", "yesterday", "custom"] as const).map((option) => (
              <button
                className={view === option ? "is-active" : ""}
                type="button"
                key={option}
                aria-pressed={view === option}
                onClick={() => chooseView(option)}
              >
                {option === "today"
                  ? "Today"
                  : option === "yesterday"
                    ? "Yesterday"
                    : "Custom"}
              </button>
            ))}
          </div>
          {view === "custom" && (
            <label className="dashboard-custom-date">
              <span className="sr-only">Custom schedule date</span>
              <input
                type="date"
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
              />
            </label>
          )}
          <button
            className="dashboard-refresh"
            type="button"
            aria-label="Refresh schedule"
            title="Refresh schedule"
            disabled={isLoading}
            onClick={() => setRefreshCount((count) => count + 1)}
          >
            <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>

      {message && (
        <p className="team-message" role="status">
          {message}
        </p>
      )}
      {isLoading && !data && (
        <p className="dashboard-empty">Loading schedule…</p>
      )}
      {!isLoading && !message && data?.outlets.length === 0 && (
        <p className="dashboard-empty">No accessible outlets are available.</p>
      )}
      {!isLoading &&
        !message &&
        data?.outlets.map((outlet) => {
          const activeShifts = outlet.shifts.filter(
            (shift) => shift.status !== "finished",
          );
          const finishedShifts = outlet.shifts.filter(
            (shift) => shift.status === "finished",
          );

          return (
            <section className="dashboard-outlet" key={outlet.id}>
              <header className="dashboard-outlet-heading">
                <div>
                  <p className="eyebrow">{outlet.timezone}</p>
                  <h2>{outlet.name}</h2>
                  <p>{outlet.address}</p>
                </div>
                <div className="dashboard-window">
                  <strong>{formatDate(outlet.date)}</strong>
                  <span>06:00 – 06:00 next day</span>
                </div>
              </header>

              <div className="dashboard-summary">
                <div>
                  <span>On shift</span>
                  <strong>{outlet.onShiftCount}</strong>
                </div>
                <div>
                  <span>On break</span>
                  <strong>{outlet.onBreakCount ?? "Not provided"}</strong>
                </div>
                <div>
                  <span>Worked</span>
                  <strong>{formatDuration(outlet.workedMinutes)}</strong>
                </div>
                <div>
                  <span>Break time</span>
                  <strong>{formatDuration(outlet.breakMinutes)}</strong>
                </div>
              </div>
              {outlet.storeHubStatus === "unavailable" && (
                <p className="team-message" role="status">
                  StoreHub attendance is temporarily unavailable. OnSITE shifts
                  are still shown.
                </p>
              )}

              {outlet.shifts.length > 0 ? (
                <>
                  {activeShifts.length > 0 && (
                    <div className="dashboard-staff-list">
                      {activeShifts.map((shift) => (
                        <DashboardShiftItem
                          key={shift.id}
                          shift={shift}
                          scheduleDate={outlet.date}
                          layout="card"
                        />
                      ))}
                    </div>
                  )}
                  {finishedShifts.length > 0 && (
                    <div className="dashboard-finished-section">
                      <h3>Finished shifts</h3>
                      <div className="dashboard-finished-list">
                        {finishedShifts.map((shift) => (
                          <DashboardShiftItem
                            key={shift.id}
                            shift={shift}
                            scheduleDate={outlet.date}
                            layout="row"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="dashboard-empty">
                  No shift records for this date.
                </p>
              )}
            </section>
          );
        })}
      {isLoading && data && (
        <p className="dashboard-updating" role="status">
          Updating schedule…
        </p>
      )}
    </main>
  );
}
