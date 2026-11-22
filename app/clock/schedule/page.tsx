"use client";

import { CloseIcon, RefreshIcon } from "@/app/_components/icons";
import { useLocale } from "@/app/_components/locale-provider";
import { ModalDialog } from "@/app/_components/modal-dialog";
import { useReportClockWorkspace } from "@/app/clock/_components/clock-workspace";
import { SignInForm } from "@/app/clock/_components/sign-in-form";
import { authClient } from "@/lib/auth-client";
import { localeTags } from "@/lib/i18n/config";
import {
  addMonths,
  dateRangeKeys,
  endOfMonth,
  startOfMonth,
  startOfWeek,
} from "@/lib/schedule-rules";
import {
  nextScheduledShift,
  scheduleCalendarFile,
  type StaffScheduleData,
  type StaffScheduledShift,
} from "@/lib/staff-schedule";
import { addDaysToDateKey } from "@/lib/timesheet-off-days";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type View = "week" | "month";
type Display = "calendar" | "agenda";
type Query = { outletId: string; view: View; anchor: string };

const PREFS_KEY = "onsite-staff-schedule-prefs";

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function rangeFor(view: View, anchor: string) {
  if (view === "month") {
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  }
  const from = startOfWeek(anchor);
  return { from, to: addDaysToDateKey(from, 6) };
}

function readPrefs(): Query {
  const fallback: Query = {
    outletId: "",
    view: "week",
    anchor: localDateKey(),
  };
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(PREFS_KEY) ?? "null",
    ) as Partial<Query> | null;
    if (!saved || typeof saved !== "object") return fallback;
    return {
      outletId: typeof saved.outletId === "string" ? saved.outletId : "",
      view: saved.view === "month" ? "month" : "week",
      anchor: fallback.anchor,
    };
  } catch {
    return fallback;
  }
}

function savePrefs(query: Query) {
  try {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ outletId: query.outletId, view: query.view }),
    );
  } catch {
    return;
  }
}

async function fetchSchedule(query: Query) {
  const { from, to } = rangeFor(query.view, query.anchor);
  const params = new URLSearchParams({ from, to });
  if (query.outletId) params.set("outletId", query.outletId);
  const response = await fetch(`/api/clock/schedule?${params}`, {
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Could not load your schedule.");
  }
  return body as StaffScheduleData;
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function shiftMinutes(shift: StaffScheduledShift) {
  return Math.max(
    0,
    Math.round(
      (new Date(shift.endAt).getTime() - new Date(shift.startAt).getTime()) /
        60_000,
    ) - shift.breakMinutes,
  );
}

function dateValue(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(
  date: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(dateValue(date));
}

function formatRange(from: string, to: string, view: View, locale: string) {
  if (view === "month") {
    return formatDate(from, locale, { month: "long", year: "numeric" });
  }
  const start = dateValue(from);
  const end = dateValue(to);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return `${new Intl.DateTimeFormat(locale, {
    day: "numeric",
    ...(sameMonth ? {} : { month: "short" }),
    timeZone: "UTC",
  }).format(start)} - ${new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(end)}`;
}

function dayIndex(date: string) {
  return (dateValue(date).getUTCDay() + 6) % 7;
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  );
}

function ShiftDetails({
  shift,
  outletName,
  locale,
  onClose,
}: {
  shift: StaffScheduledShift;
  outletName: string;
  locale: string;
  onClose: () => void;
}) {
  const { messages } = useLocale();
  const dateLabel = formatDate(shift.date, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      labelledBy="staff-schedule-shift-title"
    >
      <div className="dialog-panel staff-schedule-dialog">
        <header className="dialog-header">
          <div>
            <h2 id="staff-schedule-shift-title">
              {messages.schedule.shift.details}
            </h2>
            <p>{outletName}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={messages.schedule.shift.close}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="staff-schedule-dialog-date">
          <span>{dateLabel}</span>
          <strong>
            {shift.startTime} - {shift.endTime}
            {shift.endsNextDay ? " +1" : ""}
          </strong>
        </div>
        <dl className="staff-schedule-detail-grid">
          <div>
            <dt>{messages.schedule.shift.outlet}</dt>
            <dd>{outletName}</dd>
          </div>
          <div>
            <dt>{messages.schedule.shift.paidTime}</dt>
            <dd>{formatMinutes(shiftMinutes(shift))}</dd>
          </div>
          <div>
            <dt>{messages.schedule.shift.break}</dt>
            <dd>{formatMinutes(shift.breakMinutes)}</dd>
          </div>
          <div>
            <dt>{messages.schedule.shift.published}</dt>
            <dd>{shift.template?.name ?? "Custom"}</dd>
          </div>
        </dl>
        {shift.note && (
          <div className="staff-schedule-note">
            <span>{messages.schedule.shift.note}</span>
            <p>{shift.note}</p>
          </div>
        )}
        <Link
          className="btn btn-primary staff-schedule-open-clock"
          href="/clock"
        >
          {messages.schedule.shift.openClock}
        </Link>
      </div>
    </ModalDialog>
  );
}

export default function ClockSchedulePage() {
  const { locale, messages } = useLocale();
  const localeTag = localeTags[locale];
  const authSession = authClient.useSession();
  const router = useRouter();
  const [query, setQuery] = useState<Query>({
    outletId: "",
    view: "week",
    anchor: "",
  });
  const [data, setData] = useState<StaffScheduleData | null>(null);
  const [display, setDisplay] = useState<Display>("agenda");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [selectedShift, setSelectedShift] =
    useState<StaffScheduledShift | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (next: Query, quiet = false) => {
      const id = ++requestId.current;
      if (!quiet) setIsLoading(true);
      setMessage("");
      setQuery(next);
      try {
        let effective = next;
        let loaded: StaffScheduleData;
        try {
          loaded = await fetchSchedule(effective);
        } catch (error) {
          if (!effective.outletId) throw error;
          effective = { ...effective, outletId: "" };
          loaded = await fetchSchedule(effective);
        }
        if (id !== requestId.current) return;
        const resolved = {
          ...effective,
          outletId: loaded.outlet.id,
          anchor: effective.anchor || loaded.today,
        };
        setData(loaded);
        setQuery(resolved);
        savePrefs(resolved);
      } catch (error) {
        if (id === requestId.current) {
          setMessage(
            error instanceof Error
              ? error.message
              : messages.schedule.errors.loadFailed,
          );
        }
      } finally {
        if (id === requestId.current) setIsLoading(false);
      }
    },
    [messages.schedule.errors.loadFailed],
  );

  useEffect(() => {
    if (!authSession.data?.user.canAccessClock) return;
    const timer = window.setTimeout(() => {
      void load(readPrefs());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authSession.data?.user.canAccessClock, load]);

  useEffect(() => {
    const user = authSession.data?.user;
    if (user && !user.canAccessClock && user.canAccessBackoffice) {
      router.replace("/manage");
    }
  }, [authSession.data?.user, router]);

  const outlet = data?.outlet;
  const days = useMemo(
    () => (data ? dateRangeKeys(data.from, data.to) : []),
    [data],
  );
  const shiftsByDate = useMemo(() => {
    const result = new Map<string, StaffScheduledShift[]>();
    for (const shift of data?.shifts ?? []) {
      result.set(shift.date, [...(result.get(shift.date) ?? []), shift]);
    }
    return result;
  }, [data]);
  const nextShift = data
    ? nextScheduledShift(data.shifts, data.now)
    : undefined;
  const scheduledMinutes = (data?.shifts ?? []).reduce(
    (total, shift) => total + shiftMinutes(shift),
    0,
  );

  const workspaceReport = useMemo(
    () => ({
      pageTitle: messages.schedule.page.title,
      workspaceName: outlet?.name ?? messages.schedule.page.fallbackWorkspace,
      outlets: data?.outlets,
      selectedOutletId: outlet?.id,
      onOutletChange: (outletId: string) => {
        if (outletId === query.outletId) return;
        void load({ ...query, outletId });
      },
      reconciliationCount: 0,
    }),
    [data?.outlets, load, messages.schedule.page, outlet, query],
  );
  useReportClockWorkspace(workspaceReport);

  if (authSession.isPending) {
    return (
      <main className="loading-screen">{messages.schedule.states.loading}</main>
    );
  }
  if (!authSession.data) return <SignInForm />;
  if (!authSession.data.user.canAccessClock) {
    return (
      <main className="loading-screen">
        {messages.schedule.states.openingBackoffice}
      </main>
    );
  }

  const range = data
    ? formatRange(data.from, data.to, query.view, localeTag)
    : "...";
  const isCurrent = data
    ? data.today >= data.from && data.today <= data.to
    : true;

  function navigate(patch: Partial<Query>) {
    setSelectedShift(null);
    void load({ ...query, ...patch });
  }

  function step(direction: -1 | 1) {
    const anchor =
      query.view === "month"
        ? addMonths(startOfMonth(query.anchor), direction)
        : addDaysToDateKey(query.anchor, direction * 7);
    navigate({ anchor });
  }

  function downloadCalendar() {
    if (!data?.shifts.length || !outlet) return;
    const url = URL.createObjectURL(
      new Blob([scheduleCalendarFile(data.shifts, outlet.name)], {
        type: "text/calendar;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `schedule-${data.from}-to-${data.to}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page-content staff-schedule-page">
      <div className="page-heading staff-schedule-heading">
        <div>
          <h1>{messages.schedule.page.title}</h1>
          <p className="subheading">{messages.schedule.page.subheading}</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary staff-schedule-download"
          disabled={!data?.shifts.length}
          onClick={downloadCalendar}
        >
          <CalendarIcon />
          {messages.schedule.controls.download}
        </button>
      </div>

      <div className="staff-schedule-controls">
        <div
          className="team-view-nav staff-schedule-segmented"
          role="group"
          aria-label="Range"
        >
          {(["week", "month"] as const).map((view) => (
            <button
              key={view}
              type="button"
              className={`team-view-tab${query.view === view ? " is-active" : ""}`}
              aria-pressed={query.view === view}
              onClick={() => navigate({ view })}
            >
              {messages.schedule.controls[view]}
            </button>
          ))}
        </div>
        <div className="staff-schedule-date-nav">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={
              query.view === "week"
                ? messages.schedule.controls.previousWeek
                : messages.schedule.controls.previousMonth
            }
            onClick={() => step(-1)}
          >
            <Chevron direction="left" />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isCurrent}
            onClick={() => navigate({ anchor: data?.today ?? localDateKey() })}
          >
            {messages.schedule.controls.today}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={
              query.view === "week"
                ? messages.schedule.controls.nextWeek
                : messages.schedule.controls.nextMonth
            }
            onClick={() => step(1)}
          >
            <Chevron direction="right" />
          </button>
          <label className="staff-schedule-range">
            <strong>{range}</strong>
            <input
              type="date"
              aria-label={messages.schedule.controls.jumpToDate}
              value={query.anchor}
              onChange={(event) => {
                if (event.target.value)
                  navigate({ anchor: event.target.value });
              }}
            />
          </label>
        </div>
        <div
          className="staff-schedule-display"
          role="group"
          aria-label="Display"
        >
          {(["calendar", "agenda"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn btn-ghost btn-sm${display === mode ? " is-active" : ""}`}
              aria-pressed={display === mode}
              onClick={() => setDisplay(mode)}
            >
              {messages.schedule.controls[mode]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label={messages.schedule.controls.refresh}
          disabled={isLoading}
          onClick={() => void load(query, true)}
        >
          <RefreshIcon />
        </button>
      </div>

      {message && (
        <p className="team-message" role="status">
          {message}
        </p>
      )}

      <section
        className="staff-schedule-summary"
        aria-label={messages.schedule.page.title}
      >
        <div>
          <span>{messages.schedule.summary.shifts}</span>
          <strong>{data ? data.shifts.length : "-"}</strong>
        </div>
        <div>
          <span>{messages.schedule.summary.scheduledTime}</span>
          <strong>{data ? formatMinutes(scheduledMinutes) : "-"}</strong>
        </div>
        <div className="staff-schedule-next">
          <span>{messages.schedule.summary.nextShift}</span>
          {nextShift ? (
            <button type="button" onClick={() => setSelectedShift(nextShift)}>
              <strong>
                {formatDate(nextShift.date, localeTag, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </strong>
              <small>
                {nextShift.startTime} - {nextShift.endTime}
                {nextShift.endsNextDay ? " +1" : ""}
              </small>
            </button>
          ) : (
            <strong>{messages.schedule.summary.noneScheduled}</strong>
          )}
        </div>
      </section>

      {isLoading && !data ? (
        <div
          className="staff-schedule-skeleton"
          aria-label={messages.schedule.states.loading}
        />
      ) : !outlet ? (
        <div className="staff-schedule-empty">
          <h2>{messages.schedule.states.noOutletTitle}</h2>
          <p>{messages.schedule.states.noOutletBody}</p>
        </div>
      ) : !data?.shifts.length ? (
        <div className="staff-schedule-empty">
          <h2>{messages.schedule.states.emptyTitle}</h2>
          <p>{messages.schedule.states.emptyBody}</p>
        </div>
      ) : (
        <section className="staff-schedule-board" aria-busy={isLoading}>
          {display === "calendar" && (
            <div className="staff-schedule-calendar">
              <div className="staff-schedule-calendar-head" aria-hidden="true">
                {Array.from({ length: 7 }, (_, index) => {
                  const date = days[index] ?? days[0];
                  const weekdayDate = addDaysToDateKey(
                    date,
                    index - dayIndex(date),
                  );
                  return (
                    <span key={index}>
                      {formatDate(weekdayDate, localeTag, { weekday: "short" })}
                    </span>
                  );
                })}
              </div>
              <div className="staff-schedule-calendar-grid">
                {Array.from({ length: dayIndex(data.from) }, (_, index) => (
                  <span
                    className="staff-schedule-day is-blank"
                    key={`blank-${index}`}
                  />
                ))}
                {days.map((date) => {
                  const shifts = shiftsByDate.get(date) ?? [];
                  return (
                    <div
                      key={date}
                      className={`staff-schedule-day${date === data.today ? " is-today" : ""}${date < data.today ? " is-past" : ""}`}
                    >
                      <span className="staff-schedule-day-number">
                        {formatDate(date, localeTag, { day: "numeric" })}
                      </span>
                      <div className="staff-schedule-day-shifts">
                        {shifts.map((shift) => (
                          <button
                            type="button"
                            key={shift.id}
                            className={`staff-schedule-shift shift-color-${shift.template?.color ?? "slate"}`}
                            onClick={() => setSelectedShift(shift)}
                          >
                            <strong>
                              {shift.startTime} - {shift.endTime}
                              {shift.endsNextDay ? " +1" : ""}
                            </strong>
                            <span>{shift.template?.name ?? "Custom"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {display === "agenda" && (
            <div className="staff-schedule-agenda">
              {days
                .filter((date) => shiftsByDate.has(date))
                .map((date) => (
                  <section key={date} className="staff-schedule-agenda-day">
                    <div className="staff-schedule-agenda-date">
                      <strong>
                        {formatDate(date, localeTag, { weekday: "long" })}
                      </strong>
                      <span>
                        {formatDate(date, localeTag, {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                    <div className="staff-schedule-agenda-shifts">
                      {(shiftsByDate.get(date) ?? []).map((shift) => (
                        <button
                          type="button"
                          key={shift.id}
                          className="staff-schedule-agenda-shift"
                          onClick={() => setSelectedShift(shift)}
                        >
                          <span
                            className={`staff-schedule-shift-mark shift-color-${shift.template?.color ?? "slate"}`}
                          />
                          <span>
                            <strong>
                              {shift.startTime} - {shift.endTime}
                              {shift.endsNextDay ? " +1" : ""}
                            </strong>
                            <small>{shift.template?.name ?? "Custom"}</small>
                          </span>
                          <span className="staff-schedule-agenda-duration">
                            {formatMinutes(shiftMinutes(shift))}
                            {shift.note && <small>{shift.note}</small>}
                          </span>
                          <Chevron direction="right" />
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
            </div>
          )}
        </section>
      )}

      {selectedShift && outlet && (
        <ShiftDetails
          shift={selectedShift}
          outletName={outlet.name}
          locale={localeTag}
          onClose={() => setSelectedShift(null)}
        />
      )}
    </main>
  );
}
