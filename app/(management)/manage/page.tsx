"use client";

import { OutletAlertBell } from "@/app/(management)/manage/_components/outlet-alert-bell";
import { RefreshIcon } from "@/app/_components/icons";
import { OutletAvatar } from "@/app/_components/outlet-avatar";
import { OutletHero } from "@/app/_components/outlet-hero";
import {
  dashboardRowFlags,
  getTimelineSpan,
  outletCalendarDate,
  type DashboardShiftStatus,
} from "@/lib/dashboard-data";
import type { AttendanceFlag } from "@/lib/schedule-rules";
import { animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

type DashboardView = "today" | "yesterday" | "custom";

type DashboardSchedule = {
  startAt: string;
  endAt: string;
  flags: AttendanceFlag[];
};

type DashboardShift = {
  id: string;
  source: "onsite" | "storehub" | "scheduled";
  userId: string | null;
  employeeName: string;
  profilePhotoUrl: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  clockInLocal: string | null;
  clockOutLocal: string | null;
  status: DashboardShiftStatus;
  workedMinutes: number | null;
  breakMinutes: number | null;
  breaks: { startedAt: string; endedAt: string | null }[];
  schedule: DashboardSchedule | null;
  unscheduled: boolean;
};

type DashboardOutlet = {
  id: string;
  name: string;
  address: string;
  timezone: string;
  imageUrl?: string | null;
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

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

function formatClock(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value));
}

function timestampMs(value: string) {
  return Date.parse(value);
}

function AnimatedNumber({
  value,
  format,
}: {
  value: number | null;
  format: (value: number) => string;
}) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (value === null || reduceMotion) return;
    const controls = animate(current.current, value, {
      duration: 0.6,
      ease: "easeOut",
      onUpdate: (latest) => {
        current.current = latest;
        setDisplay(latest);
      },
    });
    return () => controls.stop();
  }, [value, reduceMotion]);

  if (value === null) return <>Not provided</>;
  return <>{format(Math.round(reduceMotion ? value : display))}</>;
}

function DashboardSkeleton() {
  return (
    <div
      className="dashboard-skeleton"
      role="status"
      aria-label="Loading schedule"
    >
      <div className="dashboard-skeleton-block is-summary" />
      <div className="dashboard-skeleton-block" />
      <div className="dashboard-skeleton-block" />
    </div>
  );
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function breakRange(
  interval: { startedAt: string; endedAt: string | null },
  timeZone: string,
) {
  const start = formatClock(interval.startedAt, timeZone);
  const end = interval.endedAt
    ? formatClock(interval.endedAt, timeZone)
    : "ongoing";
  return `Break ${start} – ${end}`;
}

function scheduleTimeLabel(
  schedule: DashboardSchedule,
  outlet: DashboardOutlet,
) {
  const start = formatClock(schedule.startAt, outlet.timezone);
  const end = formatClock(schedule.endAt, outlet.timezone);
  const endsNextDay =
    outletCalendarDate(schedule.endAt, outlet.timezone) !== outlet.date;
  return `${start} – ${end}${endsNextDay ? " (+1 day)" : ""}`;
}

function RosterRow({
  shift,
  index,
  outlet,
  nowPercent,
  showNow,
}: {
  shift: DashboardShift;
  index: number;
  outlet: DashboardOutlet;
  nowPercent: number;
  showNow: boolean;
}) {
  const isLive = shift.status === "on_shift" || shift.status === "on_break";
  const span =
    shift.clockInAt === null
      ? null
      : getTimelineSpan(
          shift.clockInAt,
          shift.clockOutAt,
          outlet.windowStartAt,
          outlet.windowEndAt,
          outlet.evaluatedAt,
        );
  const scheduleSpan = shift.schedule
    ? getTimelineSpan(
        shift.schedule.startAt,
        shift.schedule.endAt,
        outlet.windowStartAt,
        outlet.windowEndAt,
        outlet.windowEndAt,
      )
    : null;
  const anchor = span ?? scheduleSpan;
  const scheduleLabel = shift.schedule
    ? scheduleTimeLabel(shift.schedule, outlet)
    : null;
  const timeRange = shift.clockInLocal
    ? `${formatShiftTime(shift.clockInLocal, outlet.date)} – ${
        shift.clockOutLocal
          ? formatShiftTime(shift.clockOutLocal, outlet.date)
          : "In progress"
      }`
    : `Scheduled ${scheduleLabel}`;
  const flags = shift.schedule
    ? dashboardRowFlags(shift.schedule.flags, shift.status)
    : [];
  const chips = [
    ...(shift.unscheduled
      ? [{ key: "unscheduled", label: "Not scheduled", tone: "is-alert" }]
      : []),
    ...flags.map((flag) => ({
      key: flag,
      label: flagLabels[flag],
      tone: alertFlags.has(flag) ? "is-alert" : "is-note",
    })),
  ];
  const visibleChips = chips.slice(0, MAX_FLAG_CHIPS);
  const hiddenChipCount = chips.length - visibleChips.length;

  return (
    <motion.div
      layout
      className={`dashboard-roster-row is-${shift.status}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
    >
      <div className="dashboard-roster-person">
        {shift.profilePhotoUrl ? (
          <Image
            className="dashboard-roster-avatar"
            src={shift.profilePhotoUrl}
            alt=""
            width={64}
            height={64}
            unoptimized
          />
        ) : (
          <span
            className="dashboard-roster-avatar dashboard-roster-initials"
            aria-hidden="true"
          >
            {initialsOf(shift.employeeName)}
          </span>
        )}
        <div className="dashboard-roster-id">
          <strong title={shift.employeeName}>{shift.employeeName}</strong>
          <span className={`dashboard-status is-${shift.status}`}>
            {isLive && (
              <span className="dashboard-live-dot" aria-hidden="true" />
            )}
            {statusLabels[shift.status]}
          </span>
          {visibleChips.length > 0 && (
            <span className="dashboard-flags">
              {visibleChips.map((chip) => (
                <span key={chip.key} className={`dashboard-flag ${chip.tone}`}>
                  {chip.label}
                </span>
              ))}
              {hiddenChipCount > 0 && (
                <span className="dashboard-flag is-note">
                  +{hiddenChipCount}
                </span>
              )}
            </span>
          )}
          {shift.source === "storehub" && (
            <span className="storehub-source-label">StoreHub · read-only</span>
          )}
        </div>
      </div>
      <div className="dashboard-roster-track-cell">
        <div className="dashboard-roster-track">
          {scheduleSpan && (
            <span
              className="dashboard-roster-scheduled"
              title={`Scheduled ${scheduleLabel}`}
              style={{
                left: `${scheduleSpan.left}%`,
                width: `${scheduleSpan.width}%`,
              }}
            />
          )}
          {span && (
            <motion.div
              className={`dashboard-roster-bar is-${shift.status}`}
              style={{ left: `${span.left}%`, width: `${span.width}%` }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{
                duration: 0.5,
                delay: index * 0.03,
                ease: "easeOut",
              }}
            />
          )}
          {shift.breaks.map((interval, breakIndex) => {
            const breakSpan = getTimelineSpan(
              interval.startedAt,
              interval.endedAt,
              outlet.windowStartAt,
              outlet.windowEndAt,
              outlet.evaluatedAt,
            );
            if (!breakSpan) return null;
            return (
              <span
                key={breakIndex}
                className="dashboard-roster-break"
                title={breakRange(interval, outlet.timezone)}
                style={{
                  left: `${breakSpan.left}%`,
                  width: `${breakSpan.width}%`,
                }}
              />
            );
          })}
          {showNow && isLive && (
            <span
              className="dashboard-roster-now"
              style={{ left: `${nowPercent}%` }}
            />
          )}
        </div>
        <div
          className="dashboard-roster-meta"
          style={{ marginLeft: anchor ? `${anchor.left}%` : undefined }}
        >
          <span className="dashboard-roster-time">{timeRange}</span>
          {shift.breaks.map((interval, breakIndex) => (
            <span key={breakIndex} className="dashboard-roster-break-chip">
              {breakRange(interval, outlet.timezone)}
            </span>
          ))}
        </div>
      </div>
      <div className="dashboard-roster-metric">
        <small>Worked</small>
        <strong>{formatDuration(shift.workedMinutes)}</strong>
      </div>
      <div className="dashboard-roster-metric">
        <small>Break</small>
        <strong>{formatDuration(shift.breakMinutes)}</strong>
      </div>
    </motion.div>
  );
}

function ShiftRoster({ outlet }: { outlet: DashboardOutlet }) {
  const windowStart = timestampMs(outlet.windowStartAt);
  const windowEnd = timestampMs(outlet.windowEndAt);
  const nowPercent =
    ((timestampMs(outlet.evaluatedAt) - windowStart) /
      (windowEnd - windowStart)) *
    100;
  const showNow = nowPercent > 0 && nowPercent < 100;
  const upcoming = outlet.shifts.filter((shift) => shift.status === "upcoming");
  const current = outlet.shifts.filter((shift) => shift.status !== "upcoming");

  return (
    <div
      className="dashboard-roster"
      aria-label={`Staff shifts for ${outlet.name}`}
    >
      <div className="dashboard-roster-head" aria-hidden="true">
        <span>Staff</span>
        <div className="dashboard-roster-scale">
          {["06:00", "12:00", "18:00", "00:00", "06:00"].map((label, index) => (
            <span key={index} style={{ left: `${index * 25}%` }}>
              {label}
            </span>
          ))}
        </div>
        <span>Worked</span>
        <span>Break</span>
      </div>
      {current.map((shift, index) => (
        <RosterRow
          key={shift.id}
          shift={shift}
          index={index}
          outlet={outlet}
          nowPercent={nowPercent}
          showNow={showNow}
        />
      ))}
      {upcoming.length > 0 && (
        <details className="dashboard-roster-upcoming">
          <summary>Upcoming ({upcoming.length})</summary>
          {upcoming.map((shift, index) => (
            <RosterRow
              key={shift.id}
              shift={shift}
              index={index}
              outlet={outlet}
              nowPercent={nowPercent}
              showNow={showNow}
            />
          ))}
        </details>
      )}
    </div>
  );
}

const statusLabels: Record<DashboardShiftStatus, string> = {
  absent: "Absent",
  not_clocked_in: "Not clocked in",
  on_shift: "On shift",
  on_break: "On break",
  upcoming: "Upcoming",
  finished: "Finished",
};

const flagLabels: Record<AttendanceFlag, string> = {
  absent: "Absent",
  late: "Late",
  left_early: "Left early",
  overtime: "Overtime",
  short_break: "Short break",
  long_break: "Long break",
  missed_break: "No break",
};

const alertFlags = new Set<AttendanceFlag>([
  "absent",
  "late",
  "left_early",
  "missed_break",
]);

const MAX_FLAG_CHIPS = 2;

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
    const doc = document as ViewTransitionDocument;
    if (!doc.startViewTransition) {
      setView(nextView);
      return;
    }
    doc.startViewTransition(() => flushSync(() => setView(nextView)));
  }

  return (
    <MotionConfig reducedMotion="user">
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
                  className={`dashboard-date-tab${view === option ? " is-active" : ""}`}
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
              className="btn btn-secondary btn-icon"
              type="button"
              aria-label="Refresh schedule"
              title="Refresh schedule"
              disabled={isLoading}
              onClick={() => setRefreshCount((count) => count + 1)}
            >
              <RefreshIcon />
            </button>
          </div>
        </div>

        {message && (
          <p className="team-message" role="status">
            {message}
          </p>
        )}
        {isLoading && !data && <DashboardSkeleton />}
        {!isLoading && !message && data?.outlets.length === 0 && (
          <p className="dashboard-empty">
            No accessible outlets are available.
          </p>
        )}
        {!isLoading &&
          !message &&
          data?.outlets.map((outlet) => {
            return (
              <section className="dashboard-outlet" key={outlet.id}>
                <OutletHero
                  name={outlet.name}
                  imageUrl={outlet.imageUrl}
                  muted={outlet.onShiftCount === 0}
                />
                <header className="dashboard-outlet-heading">
                  <div className="outlet-inline">
                    {!outlet.imageUrl && <OutletAvatar name={outlet.name} />}
                    <div>
                      <h2>{outlet.name}</h2>
                      <p>{outlet.address}</p>
                    </div>
                  </div>
                  <div className="dashboard-outlet-meta">
                    <div className="dashboard-window">
                      <strong>{formatDate(outlet.date)}</strong>
                      <span>06:00 – 06:00 next day</span>
                    </div>
                    <OutletAlertBell
                      outletId={outlet.id}
                      outletName={outlet.name}
                    />
                  </div>
                </header>

                <div className="dashboard-summary">
                  <div>
                    <span>On shift</span>
                    <strong>
                      <AnimatedNumber
                        value={outlet.onShiftCount}
                        format={String}
                      />
                    </strong>
                  </div>
                  <div>
                    <span>On break</span>
                    <strong>
                      <AnimatedNumber
                        value={outlet.onBreakCount}
                        format={String}
                      />
                    </strong>
                  </div>
                  <div>
                    <span>Worked</span>
                    <strong>
                      <AnimatedNumber
                        value={outlet.workedMinutes}
                        format={formatDuration}
                      />
                    </strong>
                  </div>
                  <div>
                    <span>Break time</span>
                    <strong>
                      <AnimatedNumber
                        value={outlet.breakMinutes}
                        format={formatDuration}
                      />
                    </strong>
                  </div>
                </div>
                {outlet.storeHubStatus === "unavailable" && (
                  <p className="team-message" role="status">
                    StoreHub attendance is temporarily unavailable. OnSITE
                    shifts are still shown.
                  </p>
                )}

                {outlet.shifts.length > 0 ? (
                  <ShiftRoster outlet={outlet} />
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
    </MotionConfig>
  );
}
