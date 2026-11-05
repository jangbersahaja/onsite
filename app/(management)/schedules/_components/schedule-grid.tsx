"use client";

import {
  attendanceBadges,
  cellKey,
  compactTime,
  dayParts,
  formatHours,
  initials,
  shiftDurationMinutes,
  type ScheduleView,
} from "@/app/(management)/schedules/_components/schedule-format";
import type {
  ScheduledShift,
  ScheduleStaff,
  ShiftTemplate,
} from "@/lib/schedule-types";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
} from "react";

export type ScheduleBrush =
  | { kind: "template"; template: ShiftTemplate }
  | {
      kind: "custom";
      startTime: string;
      endTime: string;
      breakMinutes: number;
    }
  | { kind: "erase" }
  | null;

export type ScheduleCell = { userId: string; date: string };

type ScheduleGridProps = {
  view: ScheduleView;
  days: string[];
  today: string;
  staff: ScheduleStaff[];
  shiftsByCell: Map<string, ScheduledShift[]>;
  shiftsById: Map<string, ScheduledShift>;
  templates: Map<string, ShiftTemplate>;
  brush: ScheduleBrush;
  onAddShift: (cell: ScheduleCell) => void;
  onOpenShift: (shift: ScheduledShift) => void;
  onPaint: (cells: ScheduleCell[]) => void;
  onMoveShift: (shift: ScheduledShift, cell: ScheduleCell, copy: boolean) => void;
};

function readCell(element: Element | null): ScheduleCell | null {
  const cell = element?.closest<HTMLElement>("[data-cell-user]");
  if (!cell || cell.dataset.editable !== "true") return null;
  return { userId: cell.dataset.cellUser!, date: cell.dataset.cellDate! };
}

export function ScheduleGrid({
  view,
  days,
  today,
  staff,
  shiftsByCell,
  shiftsById,
  templates,
  brush,
  onAddShift,
  onOpenShift,
  onPaint,
  onMoveShift,
}: ScheduleGridProps) {
  const [painted, setPainted] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const paintingRef = useRef<Map<string, ScheduleCell> | null>(null);
  const onPaintRef = useRef(onPaint);
  const compact = view === "month";

  useEffect(() => {
    onPaintRef.current = onPaint;
  }, [onPaint]);

  useEffect(() => {
    function finishPaint() {
      const cells = paintingRef.current;
      if (!cells) return;
      paintingRef.current = null;
      setPainted(new Set());
      if (cells.size) onPaintRef.current([...cells.values()]);
    }
    window.addEventListener("pointerup", finishPaint);
    window.addEventListener("pointercancel", finishPaint);
    return () => {
      window.removeEventListener("pointerup", finishPaint);
      window.removeEventListener("pointercancel", finishPaint);
    };
  }, []);

  function addPainted(cell: ScheduleCell) {
    const cells = paintingRef.current;
    if (!cells) return;
    const key = cellKey(cell.userId, cell.date);
    if (cells.has(key)) return;
    cells.set(key, cell);
    setPainted(new Set(cells.keys()));
  }

  function handlePointerDown(event: PointerEvent<HTMLTableElement>) {
    if (!brush || event.button !== 0) return;
    const cell = readCell(event.target as Element);
    if (!cell) return;
    event.preventDefault();
    paintingRef.current = new Map();
    addPainted(cell);
  }

  function handlePointerMove(event: PointerEvent<HTMLTableElement>) {
    if (!paintingRef.current) return;
    // elementFromPoint keeps touch drags working despite implicit pointer capture.
    const cell = readCell(
      document.elementFromPoint(event.clientX, event.clientY),
    );
    if (cell) addPainted(cell);
  }

  function handleDragOver(event: DragEvent<HTMLTableCellElement>, key: string) {
    if (!event.dataTransfer.types.includes("application/x-shift-id")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect =
      event.altKey || event.ctrlKey || event.metaKey ? "copy" : "move";
    if (dropTarget !== key) setDropTarget(key);
  }

  function handleDrop(event: DragEvent<HTMLTableCellElement>, cell: ScheduleCell) {
    event.preventDefault();
    setDropTarget(null);
    const shift = shiftsById.get(
      event.dataTransfer.getData("application/x-shift-id"),
    );
    if (!shift) return;
    const copy = event.altKey || event.ctrlKey || event.metaKey;
    if (!copy && shift.userId === cell.userId && shift.date === cell.date) return;
    onMoveShift(shift, cell, copy);
  }

  const dayTotals = days.map((date) => {
    let count = 0;
    let minutes = 0;
    for (const member of staff) {
      for (const shift of shiftsByCell.get(cellKey(member.userId, date)) ?? []) {
        count += 1;
        minutes += shiftDurationMinutes(shift);
      }
    }
    return { count, minutes };
  });

  return (
    <div
      className={`schedule-grid-wrap${compact ? " is-compact" : ""}${brush ? " is-painting" : ""}`}
    >
      <table
        className="schedule-grid"
        style={{ ["--day-count" as string]: days.length }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <thead>
          <tr>
            <th scope="col" className="schedule-staff-head">
              Staff
            </th>
            {days.map((date) => {
              const parts = dayParts(date);
              return (
                <th
                  scope="col"
                  key={date}
                  className={`schedule-day-head${date === today ? " is-today" : ""}${parts.isWeekend ? " is-weekend" : ""}`}
                >
                  <span className="schedule-day-weekday">
                    {compact ? parts.narrowWeekday : parts.weekday}
                  </span>
                  <span className="schedule-day-number">{parts.day}</span>
                  {!compact && (
                    <span className="schedule-day-month">{parts.month}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {staff.map((member) => {
            let rowMinutes = 0;
            let rowCount = 0;
            for (const date of days) {
              for (const shift of shiftsByCell.get(cellKey(member.userId, date)) ?? []) {
                rowMinutes += shiftDurationMinutes(shift);
                rowCount += 1;
              }
            }
            return (
              <tr key={member.userId}>
                <th scope="row" className="schedule-staff-cell">
                  <span className="schedule-avatar" aria-hidden="true">
                    {member.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={member.photoUrl} alt="" draggable={false} />
                    ) : (
                      initials(member.name)
                    )}
                  </span>
                  <span className="schedule-staff-text">
                    <strong title={member.name}>{member.name}</strong>
                    <small>
                      {!member.isMember
                        ? "No longer assigned"
                        : rowCount
                          ? `${formatHours(rowMinutes)} · ${rowCount} shift${rowCount === 1 ? "" : "s"}`
                          : "Not scheduled"}
                    </small>
                  </span>
                </th>
                {days.map((date) => {
                  const key = cellKey(member.userId, date);
                  const cellShifts = shiftsByCell.get(key) ?? [];
                  const parts = dayParts(date);
                  const cell = { userId: member.userId, date };
                  return (
                    <td
                      key={date}
                      data-cell-user={member.userId}
                      data-cell-date={date}
                      data-editable={member.canEdit}
                      className={[
                        "schedule-cell",
                        date === today ? "is-today" : "",
                        date < today ? "is-past" : "",
                        parts.isWeekend ? "is-weekend" : "",
                        painted.has(key) ? "is-painted" : "",
                        dropTarget === key ? "is-drop-target" : "",
                        member.canEdit ? "" : "is-locked",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onDragOver={
                        member.canEdit
                          ? (event) => handleDragOver(event, key)
                          : undefined
                      }
                      onDragLeave={() => {
                        if (dropTarget === key) setDropTarget(null);
                      }}
                      onDrop={
                        member.canEdit
                          ? (event) => handleDrop(event, cell)
                          : undefined
                      }
                    >
                      <div className="schedule-cell-inner">
                        {cellShifts.map((shift) => (
                          <ShiftChip
                            key={shift.id}
                            shift={shift}
                            template={
                              shift.templateId
                                ? templates.get(shift.templateId)
                                : undefined
                            }
                            compact={compact}
                            draggable={member.canEdit && !brush}
                            onOpen={() => {
                              if (!brush) onOpenShift(shift);
                            }}
                          />
                        ))}
                        {member.canEdit && !brush && (
                          <button
                            type="button"
                            className={`schedule-cell-add${cellShifts.length ? " has-shifts" : ""}`}
                            aria-label={`Add shift for ${member.name} on ${parts.weekday} ${parts.day} ${parts.month}`}
                            onClick={() => onAddShift(cell)}
                          >
                            <span aria-hidden="true">+</span>
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="schedule-staff-cell schedule-total-head">
              Coverage
            </th>
            {dayTotals.map((total, index) => (
              <td
                key={days[index]}
                className={`schedule-total-cell${days[index] === today ? " is-today" : ""}`}
              >
                <strong>{total.count}</strong>
                {!compact && <small>{formatHours(total.minutes)}</small>}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ShiftChip({
  shift,
  template,
  compact,
  draggable,
  onOpen,
}: {
  shift: ScheduledShift;
  template: ShiftTemplate | undefined;
  compact: boolean;
  draggable: boolean;
  onOpen: () => void;
}) {
  const badges = attendanceBadges(shift);
  const color = template?.color ?? "slate";
  const label = `${shift.startTime}–${shift.endTime}${shift.endsNextDay ? " (+1)" : ""}`;
  const description = [
    template?.name ?? "Custom shift",
    label,
    shift.status === "draft" ? "Draft" : null,
    ...badges.map((badge) => badge.label),
    shift.note,
  ]
    .filter(Boolean)
    .join(" · ");
  const primaryTone = badges[0]?.tone;

  return (
    <button
      type="button"
      className={`schedule-chip shift-color-${color}${shift.status === "draft" ? " is-draft" : ""}${primaryTone ? ` has-${primaryTone}` : ""}`}
      title={description}
      aria-label={description}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-shift-id", shift.id);
        event.dataTransfer.effectAllowed = "copyMove";
      }}
      onClick={onOpen}
    >
      {compact ? (
        <>
          <span className="schedule-chip-code">
            {template?.code ?? compactTime(shift.startTime)}
          </span>
          {primaryTone && primaryTone !== "success" && (
            <span className={`schedule-dot tone-${primaryTone}`} aria-hidden="true" />
          )}
        </>
      ) : (
        <>
          <span className="schedule-chip-time">
            {shift.startTime}–{shift.endTime}
            {shift.endsNextDay && <sup>+1</sup>}
          </span>
          <span className="schedule-chip-meta">
            <span className="schedule-chip-name">{template ? template.name : "Custom"}</span>
            {shift.status === "draft" && <em>Draft</em>}
            {shift.note && <span aria-hidden="true"> ✎</span>}
          </span>
          {badges.length > 0 && (
            <span className="schedule-chip-badges">
              {badges.map((badge) => (
                <span key={badge.label} className={`schedule-badge tone-${badge.tone}`}>
                  {badge.label}
                </span>
              ))}
            </span>
          )}
        </>
      )}
    </button>
  );
}
