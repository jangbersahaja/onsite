"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/app/_components/locale-provider";
import { AlertIcon, CheckIcon } from "@/app/_components/icons";
import {
  buildDutyBoard,
  type DutyBoardData,
  type DutyOnDuty,
  type DutyShiftRow,
  type DutyState,
} from "@/lib/clock-duty";
import { format } from "@/lib/i18n/format";
import { formatOutletDateTime } from "@/lib/outlet-time";

type DutyOutlet = { id: string; name: string; timezone: string };

const TICK_MS = 30_000;
const REFRESH_MS = 60_000;

async function fetchDuty(outletId: string): Promise<DutyBoardData> {
  const response = await fetch(
    `/api/clock/duty?outletId=${encodeURIComponent(outletId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("duty_load_failed");
  return (await response.json()) as DutyBoardData;
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function minutesOfDay(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function StateGlyph({ state }: { state: DutyState }) {
  switch (state) {
    case "upcoming":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="duty-glyph">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 1.5" />
        </svg>
      );
    case "late":
      return <AlertIcon aria-hidden="true" className="duty-glyph" />;
    case "on_duty":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="duty-glyph">
          <circle cx="8" cy="8" r="2.5" />
          <path d="M4.2 4.2a5.5 5.5 0 0 0 0 7.6M11.8 4.2a5.5 5.5 0 0 1 0 7.6" />
        </svg>
      );
    case "on_break":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="duty-glyph">
          <path d="M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
          <path d="M11 7h1a1.5 1.5 0 0 1 0 3h-1M5 2.5v1.5M8 2.5v1.5" />
        </svg>
      );
    case "completed":
      return <CheckIcon aria-hidden="true" className="duty-glyph" />;
    case "absent":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="duty-glyph">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      );
  }
}

function isActive(state: DutyState) {
  return state === "on_duty" || state === "on_break";
}

export function DutyBoard({
  outlet,
  refreshKey,
}: {
  outlet: DutyOutlet;
  refreshKey: string | null;
}) {
  const { messages } = useLocale();
  const copy = messages.clock.duty;
  const [data, setData] = useState<DutyBoardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      fetchDuty(outlet.id)
        .then((next) => {
          if (!active) return;
          setData(next);
          setFailed(false);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [outlet.id, refreshKey, reloadToken]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  const board = useMemo(
    () => (data ? buildDutyBoard(data, now) : null),
    [data, now],
  );

  const focus: DutyShiftRow | null = useMemo(() => {
    if (!board) return null;
    if (selectedShiftId) {
      const picked = board.shifts.find(
        (row) => row.shift.id === selectedShiftId,
      );
      if (picked) return picked;
    }
    return (
      board.shifts.find((row) => row.person.isCurrentUser && isActive(row.state)) ??
      board.shifts.find((row) => row.person.isCurrentUser) ??
      board.shifts.find((row) => isActive(row.state)) ??
      board.shifts.find((row) => row.state === "late") ??
      board.shifts.find((row) => row.state === "upcoming") ??
      board.shifts[0] ??
      null
    );
  }, [board, selectedShiftId]);

  const timeline = useMemo(() => {
    if (!board || board.shifts.length === 0) return null;
    const starts = board.shifts.map((row) => minutesOfDay(row.shift.startTime));
    const ends = board.shifts.map((row) => {
      const end = minutesOfDay(row.shift.endTime);
      return row.shift.endsNextDay ? end + 1440 : end;
    });
    let low = Math.max(0, Math.min(...starts) - 60);
    let high = Math.min(1440, Math.max(...ends) + 60);
    if (high - low < 360) {
      high = Math.min(1440, low + 360);
      low = Math.max(0, high - 360);
    }
    return { low, span: high - low };
  }, [board]);

  if (failed && !data) {
    return (
      <section className="duty-board duty-board-error" aria-label={copy.label}>
        <p>{copy.error}</p>
        <button type="button" onClick={() => setReloadToken((n) => n + 1)}>
          {copy.retry}
        </button>
      </section>
    );
  }

  if (!board || !data) {
    return (
      <section className="duty-board duty-board-loading" aria-label={copy.label}>
        <p>{copy.loading}</p>
      </section>
    );
  }

  const nowTime = formatOutletDateTime(now, outlet.timezone).slice(11);
  const nowMinutes = minutesOfDay(nowTime);
  const scheduledCount = board.shifts.length;
  const formatDuration = (minutes: number) =>
    format(messages.clock.duration, {
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    });

  const hintFor = (row: DutyShiftRow) => {
    switch (row.state) {
      case "upcoming":
        return format(copy.hints.upcoming, {
          time: formatDuration(row.startsInMinutes ?? 0),
        });
      case "late":
        return format(copy.hints.late, {
          time: formatDuration(row.lateMinutes),
        });
      case "on_duty":
        return row.isPastEnd
          ? copy.hints.overdue
          : format(copy.hints.on_duty, {
              time: formatDuration(row.endsInMinutes ?? 0),
            });
      case "on_break":
        return copy.hints.on_break;
      case "completed":
        return copy.hints.completed;
      case "absent":
        return copy.hints.absent;
    }
  };

  const personName = (person: { name: string; isCurrentUser: boolean }) =>
    person.isCurrentUser ? copy.you : person.name;

  return (
    <section
      className="duty-board"
      aria-label={copy.label}
      data-live={focus ? focus.state : "none"}
    >
      <header className="duty-header">
        <h2>{copy.label}</h2>
        <p className="duty-summary">
          {format(copy.summary, {
            onDuty: board.onDuty.length,
            scheduled: scheduledCount,
          })}
        </p>
      </header>

      <div className="duty-people" role="list">
        {board.onDuty.length === 0 ? (
          <p className="duty-empty">{copy.nobodyOnDuty}</p>
        ) : (
          board.onDuty.map((item: DutyOnDuty) => (
            <div
              role="listitem"
              key={item.sessionId}
              className={`duty-person duty-person-${item.state}`}
              title={`${personName(item.person)} · ${copy.states[item.state]}${item.shiftId ? "" : ` · ${copy.unscheduled}`}`}
            >
              <span className="duty-avatar" aria-hidden="true">
                {item.person.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.person.photoUrl} alt="" />
                ) : (
                  initials(item.person.name)
                )}
              </span>
              <span className="duty-person-badge">
                <StateGlyph state={item.state} />
              </span>
              <span className="duty-person-name">{personName(item.person)}</span>
              <span className="visually-hidden">
                {copy.states[item.state]}
              </span>
            </div>
          ))
        )}
      </div>

      <h3 className="duty-subtitle">{copy.todayTitle}</h3>
      {scheduledCount === 0 || !timeline ? (
        <p className="duty-empty">{copy.nothingScheduled}</p>
      ) : (
        <>
          <div
            className="duty-rail"
            role="group"
            aria-label={copy.timeline}
          >
            {board.shifts.map((row) => {
              const start = minutesOfDay(row.shift.startTime);
              const endRaw = minutesOfDay(row.shift.endTime);
              const end = row.shift.endsNextDay ? endRaw + 1440 : endRaw;
              const left = ((start - timeline.low) / timeline.span) * 100;
              const width = ((end - start) / timeline.span) * 100;
              const selected = focus?.shift.id === row.shift.id;
              return (
                <button
                  key={row.shift.id}
                  type="button"
                  className={`duty-pill duty-pill-${row.state}${selected ? " is-selected" : ""}${row.person.isCurrentUser ? " is-me" : ""}`}
                  style={{
                    left: `${Math.max(0, left)}%`,
                    width: `${Math.min(100 - Math.max(0, left), width)}%`,
                  }}
                  aria-pressed={selected}
                  aria-label={`${personName(row.person)} ${row.shift.startTime}–${row.shift.endTime}, ${copy.states[row.state]}`}
                  onClick={() => setSelectedShiftId(row.shift.id)}
                >
                  <StateGlyph state={row.state} />
                  <span>{initials(row.person.name)}</span>
                </button>
              );
            })}
            {nowMinutes >= timeline.low &&
            nowMinutes <= timeline.low + timeline.span ? (
              <span
                className="duty-now"
                aria-label={copy.nowLabel}
                style={{
                  left: `${((nowMinutes - timeline.low) / timeline.span) * 100}%`,
                }}
              />
            ) : null}
          </div>

          {focus ? (
            <article
              className={`duty-focus duty-focus-${focus.state}`}
              aria-live="polite"
            >
              <span className="duty-focus-icon">
                <StateGlyph state={focus.state} />
              </span>
              <div>
                <strong>{personName(focus.person)}</strong>
                <span className="duty-focus-time">
                  {focus.shift.startTime}–{focus.shift.endTime}
                  {focus.shift.template ? ` · ${focus.shift.template.name}` : ""}
                </span>
                <span className="duty-focus-state">
                  {copy.states[focus.state]} · {hintFor(focus)}
                </span>
              </div>
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}
