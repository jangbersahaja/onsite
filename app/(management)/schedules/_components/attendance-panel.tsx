"use client";

import {
  attendanceBadges,
  formatHours,
  formatMinutes,
  formatShortDate,
  initials,
} from "@/app/(management)/schedules/_components/schedule-format";
import { punctualityRate } from "@/lib/schedule-rules";
import type { ScheduleData, ScheduledShift } from "@/lib/schedule-types";
import { useMemo } from "react";

function timeIn(iso: string | null, timezone: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(iso));
}

function rateTone(rate: number | null) {
  if (rate === null) return "";
  if (rate >= 0.9) return "tone-success";
  if (rate >= 0.75) return "tone-warning";
  return "tone-danger";
}

export function AttendancePanel({
  data,
  onOpenShift,
}: {
  data: ScheduleData;
  onOpenShift: (shift: ScheduledShift) => void;
}) {
  const timezone = data.outlet.timezone;
  const names = useMemo(
    () => new Map(data.staff.map((person) => [person.userId, person])),
    [data.staff],
  );

  const totals = useMemo(() => {
    const sum = data.summary.reduce(
      (acc, row) => ({
        scored: acc.scored + row.scoredShifts,
        onTime: acc.onTime + row.onTime,
        late: acc.late + row.late,
        lateMinutes: acc.lateMinutes + row.lateMinutes,
        absent: acc.absent + row.absent,
        leftEarly: acc.leftEarly + row.leftEarly,
        overtimeMinutes: acc.overtimeMinutes + row.overtimeMinutes,
        scheduledMinutes: acc.scheduledMinutes + row.scheduledMinutes,
        workedMinutes: acc.workedMinutes + row.workedMinutes,
      }),
      {
        scored: 0,
        onTime: 0,
        late: 0,
        lateMinutes: 0,
        absent: 0,
        leftEarly: 0,
        overtimeMinutes: 0,
        scheduledMinutes: 0,
        workedMinutes: 0,
      },
    );
    return { ...sum, rate: punctualityRate({ onTime: sum.onTime, scoredShifts: sum.scored }) };
  }, [data.summary]);

  const exceptions = useMemo(
    () =>
      data.shifts
        .filter(
          (shift) =>
            shift.attendance &&
            (shift.attendance.flags.length > 0 ||
              shift.attendance.status === "not_clocked_in"),
        )
        .sort((a, b) => b.startAt.localeCompare(a.startAt)),
    [data.shifts],
  );

  const rows = useMemo(
    () =>
      [...data.summary]
        .filter((row) => row.scheduledShifts || row.unscheduled)
        .sort(
          (a, b) =>
            (punctualityRate(a) ?? 2) - (punctualityRate(b) ?? 2) ||
            b.absent - a.absent ||
            (names.get(a.userId)?.name ?? "").localeCompare(names.get(b.userId)?.name ?? ""),
        ),
    [data.summary, names],
  );

  const unscheduledMinutes = data.unscheduled.reduce(
    (total, session) => total + (session.workedMinutes ?? 0),
    0,
  );

  return (
    <div className="schedule-insights">
      <section className="schedule-kpis" aria-label="Attendance overview">
        <article className={`schedule-kpi ${rateTone(totals.rate)}`}>
          <span>Punctuality</span>
          <strong>{totals.rate === null ? "—" : `${Math.round(totals.rate * 100)}%`}</strong>
          <small>
            {totals.onTime} of {totals.scored} completed shifts on time
          </small>
        </article>
        <article className={`schedule-kpi ${totals.late ? "tone-warning" : ""}`}>
          <span>Late arrivals</span>
          <strong>{totals.late}</strong>
          <small>{totals.lateMinutes ? `${formatMinutes(totals.lateMinutes)} lost` : "No lateness"}</small>
        </article>
        <article className={`schedule-kpi ${totals.absent ? "tone-danger" : ""}`}>
          <span>Absences</span>
          <strong>{totals.absent}</strong>
          <small>No clock-in for a published shift</small>
        </article>
        <article className={`schedule-kpi ${totals.overtimeMinutes ? "tone-overtime" : ""}`}>
          <span>Overtime</span>
          <strong>{formatHours(totals.overtimeMinutes)}</strong>
          <small>
            {totals.leftEarly ? `${totals.leftEarly} left early` : "Beyond scheduled end"}
          </small>
        </article>
        <article className={`schedule-kpi ${data.unscheduled.length ? "tone-info" : ""}`}>
          <span>Unscheduled work</span>
          <strong>{data.unscheduled.length}</strong>
          <small>
            {unscheduledMinutes ? `${formatHours(unscheduledMinutes)} worked off-roster` : "Everyone stuck to the roster"}
          </small>
        </article>
      </section>

      <section className="schedule-card">
        <header>
          <h2>By staff</h2>
          <p>Scheduled vs. worked for published shifts in this range.</p>
        </header>
        {rows.length ? (
          <div className="schedule-table-wrap">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th scope="col">Staff</th>
                  <th scope="col">Shifts</th>
                  <th scope="col">Scheduled</th>
                  <th scope="col">Worked</th>
                  <th scope="col">Punctuality</th>
                  <th scope="col">Late</th>
                  <th scope="col">Absent</th>
                  <th scope="col">Left early</th>
                  <th scope="col">Overtime</th>
                  <th scope="col">Off-roster</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const person = names.get(row.userId);
                  const rate = punctualityRate(row);
                  return (
                    <tr key={row.userId}>
                      <th scope="row">
                        <span className="schedule-person">
                          <span className="schedule-avatar" aria-hidden="true">
                            {initials(person?.name ?? "?")}
                          </span>
                          {person?.name ?? "Former staff"}
                        </span>
                      </th>
                      <td>{row.scheduledShifts}</td>
                      <td>{formatHours(row.scheduledMinutes)}</td>
                      <td>{formatHours(row.workedMinutes)}</td>
                      <td>
                        {rate === null ? (
                          <span className="schedule-muted">—</span>
                        ) : (
                          <span className={`schedule-rate ${rateTone(rate)}`}>
                            <span style={{ ["--rate" as string]: rate }} />
                            {Math.round(rate * 100)}%
                          </span>
                        )}
                      </td>
                      <td>
                        {row.late ? `${row.late} · ${formatMinutes(row.lateMinutes)}` : "—"}
                      </td>
                      <td className={row.absent ? "is-danger" : ""}>{row.absent || "—"}</td>
                      <td>{row.leftEarly || "—"}</td>
                      <td>{row.overtimeMinutes ? formatMinutes(row.overtimeMinutes) : "—"}</td>
                      <td>
                        {row.unscheduled
                          ? `${row.unscheduled} · ${formatMinutes(row.unscheduledMinutes)}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="schedule-empty-inline">
            Publish shifts to start tracking attendance against the roster.
          </p>
        )}
      </section>

      <div className="schedule-insight-columns">
        <section className="schedule-card">
          <header>
            <h2>Exceptions</h2>
            <p>Late, absent, early leave and overtime — newest first.</p>
          </header>
          {exceptions.length ? (
            <ul className="schedule-exception-list">
              {exceptions.map((shift) => {
                const attendance = shift.attendance!;
                return (
                  <li key={shift.id}>
                    <button type="button" onClick={() => onOpenShift(shift)}>
                      <span className="schedule-exception-who">
                        <strong>{names.get(shift.userId)?.name ?? "Former staff"}</strong>
                        <small>{formatShortDate(shift.date)}</small>
                      </span>
                      <span className="schedule-exception-times">
                        <span>
                          Planned {shift.startTime}–{shift.endTime}
                        </span>
                        <span>
                          Actual {timeIn(attendance.clockInAt, timezone)}–
                          {attendance.clockInAt ? timeIn(attendance.clockOutAt, timezone) : ""}
                        </span>
                      </span>
                      <span className="schedule-chip-badges">
                        {attendanceBadges(shift).map((badge) => (
                          <span key={badge.label} className={`schedule-badge tone-${badge.tone}`}>
                            {badge.label}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="schedule-empty-inline">No exceptions in this range. 🎉</p>
          )}
        </section>

        <section className="schedule-card">
          <header>
            <h2>Worked without a shift</h2>
            <p>Clock-ins that didn&apos;t match any published shift.</p>
          </header>
          {data.unscheduled.length ? (
            <ul className="schedule-exception-list">
              {data.unscheduled.map((session) => (
                <li key={session.id}>
                  <div>
                    <span className="schedule-exception-who">
                      <strong>{session.name}</strong>
                      <small>{formatShortDate(session.date)}</small>
                    </span>
                    <span className="schedule-exception-times">
                      <span>
                        {session.clockInTime}–{session.clockOutTime ?? "now"}
                      </span>
                      <span>
                        {session.workedMinutes !== null
                          ? formatMinutes(session.workedMinutes)
                          : "In progress"}
                      </span>
                    </span>
                    <span className="schedule-badge tone-info">Unscheduled</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="schedule-empty-inline">Every clock-in matched a shift.</p>
          )}
        </section>
      </div>
    </div>
  );
}
