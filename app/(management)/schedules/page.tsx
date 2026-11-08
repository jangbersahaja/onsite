"use client";

import { AttendancePanel } from "@/app/(management)/schedules/_components/attendance-panel";
import {
  CopyDialog,
  type CopyValues,
} from "@/app/(management)/schedules/_components/copy-dialog";
import {
  cellKey,
  formatHours,
  formatRangeLabel,
  localDateKey,
  scheduleRequest,
  shiftDurationMinutes,
  type ScheduleView,
  type ShiftDraft,
} from "@/app/(management)/schedules/_components/schedule-format";
import {
  ScheduleGrid,
  type ScheduleBrush,
  type ScheduleCell,
} from "@/app/(management)/schedules/_components/schedule-grid";
import { ShiftDialog } from "@/app/(management)/schedules/_components/shift-dialog";
import { TemplateDialog } from "@/app/(management)/schedules/_components/template-dialog";
import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { RefreshIcon } from "@/app/_components/icons";
import {
  addMonths,
  dateRangeKeys,
  endOfMonth,
  startOfMonth,
  startOfWeek,
  validateShiftTimes,
} from "@/lib/schedule-rules";
import type { ScheduleData, ScheduledShift } from "@/lib/schedule-types";
import { addDaysToDateKey } from "@/lib/timesheet-off-days";
import { useEffect, useMemo, useRef, useState } from "react";

type Query = { outletId: string; view: ScheduleView; anchor: string };
type Tab = "roster" | "insights";
type DialogState =
  | {
      kind: "shift";
      mode: "create" | "edit";
      initial: ShiftDraft;
      shift?: ScheduledShift;
      readOnly: boolean;
    }
  | { kind: "templates" }
  | { kind: "copy" }
  | null;

const prefsKey = "onsite-schedule-prefs";

function readPrefs(): Query {
  const fallback: Query = {
    outletId: "",
    view: "week",
    anchor: localDateKey(),
  };
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(prefsKey) ?? "null",
    ) as Partial<Query> | null;
    if (!saved || typeof saved !== "object") return fallback;
    return {
      ...fallback,
      outletId: typeof saved.outletId === "string" ? saved.outletId : "",
      view: saved.view === "month" ? "month" : "week",
    };
  } catch {
    return fallback;
  }
}

function savePrefs(query: Query) {
  try {
    window.localStorage.setItem(
      prefsKey,
      JSON.stringify({ outletId: query.outletId, view: query.view }),
    );
  } catch {
    return;
  }
}

function rangeFor(view: ScheduleView, anchor: string) {
  if (view === "month") {
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  }
  const from = startOfWeek(anchor);
  return { from, to: addDaysToDateKey(from, 6) };
}

async function fetchSchedule(query: Query) {
  const { from, to } = rangeFor(query.view, query.anchor);
  const params = new URLSearchParams({ from, to });
  if (query.outletId) params.set("outletId", query.outletId);
  return scheduleRequest<ScheduleData>(`/api/schedules?${params}`, {
    method: "GET",
  });
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function shiftDraftFrom(shift: ScheduledShift): ShiftDraft {
  return {
    userId: shift.userId,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakMinutes: shift.breakMinutes,
    templateId: shift.templateId,
    note: shift.note,
  };
}

export default function SchedulesPage() {
  const [query, setQuery] = useState<Query>({
    outletId: "",
    view: "week",
    anchor: "",
  });
  const [data, setData] = useState<ScheduleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<Tab>("roster");
  const [brush, setBrush] = useState<ScheduleBrush>(null);
  const [customBrush, setCustomBrush] = useState({
    startTime: "09:00",
    endTime: "17:00",
    breakMinutes: 60,
  });
  const [search, setSearch] = useState("");
  const [onlyRostered, setOnlyRostered] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const lastDraft = useRef<Omit<ShiftDraft, "userId" | "date"> | null>(null);
  const requestId = useRef(0);
  const { confirm, confirmDialog } = useConfirmDialog();

  async function load(next: Query, options: { quiet?: boolean } = {}) {
    const id = ++requestId.current;
    if (!options.quiet) setIsLoading(true);
    setQuery(next);
    try {
      const loaded = await fetchSchedule(next);
      if (id !== requestId.current) return;
      const resolved = { ...next, outletId: loaded.outlet.id };
      setData(loaded);
      setQuery(resolved);
      savePrefs(resolved);
    } catch (error) {
      if (id === requestId.current) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load the schedule.",
        );
      }
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  }

  const reload = () => load(query, { quiet: true });

  useEffect(() => {
    let active = true;
    const saved = readPrefs();
    const id = ++requestId.current;
    fetchSchedule(saved)
      // A remembered outlet may no longer be accessible; fall back to the default.
      .catch((error: unknown) => {
        if (!saved.outletId) throw error;
        saved.outletId = "";
        return fetchSchedule(saved);
      })
      .then((loaded) => {
        if (!active || id !== requestId.current) return;
        const resolved = { ...saved, outletId: loaded.outlet.id };
        setData(loaded);
        setQuery(resolved);
        savePrefs(resolved);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load the schedule.",
          );
      })
      .finally(() => {
        if (active && id === requestId.current) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (dialog || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea, [contenteditable=true]"))
        return;
      if (event.key === "Escape") setBrush(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  const outlet = data?.outlet;
  const templates = useMemo(() => data?.templates ?? [], [data]);
  const templatesById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );
  const staffById = useMemo(
    () => new Map((data?.staff ?? []).map((person) => [person.userId, person])),
    [data],
  );
  const days = useMemo(
    () => (data ? dateRangeKeys(data.from, data.to) : []),
    [data],
  );
  const { shiftsByCell, shiftsById } = useMemo(() => {
    const byCell = new Map<string, ScheduledShift[]>();
    const byId = new Map<string, ScheduledShift>();
    for (const shift of data?.shifts ?? []) {
      byId.set(shift.id, shift);
      const key = cellKey(shift.userId, shift.date);
      byCell.set(key, [...(byCell.get(key) ?? []), shift]);
    }
    for (const list of byCell.values()) {
      list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }
    return { shiftsByCell: byCell, shiftsById: byId };
  }, [data]);

  const visibleStaff = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rostered = new Set((data?.shifts ?? []).map((shift) => shift.userId));
    return (data?.staff ?? []).filter(
      (person) =>
        (!needle ||
          person.name.toLowerCase().includes(needle) ||
          person.email.toLowerCase().includes(needle)) &&
        (!onlyRostered || rostered.has(person.userId)),
    );
  }, [data, search, onlyRostered]);

  const stats = useMemo(() => {
    const shifts = data?.shifts ?? [];
    const drafts = shifts.filter(
      (shift) =>
        shift.status === "draft" && staffById.get(shift.userId)?.canEdit,
    );
    const alerts = shifts.filter(
      (shift) =>
        shift.attendance &&
        (shift.attendance.flags.length > 0 ||
          shift.attendance.status === "not_clocked_in"),
    );
    return {
      count: shifts.length,
      minutes: shifts.reduce(
        (total, shift) => total + shiftDurationMinutes(shift),
        0,
      ),
      drafts: drafts.length,
      rostered: new Set(shifts.map((shift) => shift.userId)).size,
      alerts: alerts.length,
    };
  }, [data, staffById]);

  function navigate(patch: Partial<Query>) {
    setMessage("");
    if (patch.outletId && patch.outletId !== query.outletId) setBrush(null);
    void load({ ...query, ...patch });
  }

  function step(direction: -1 | 1) {
    const anchor =
      query.view === "month"
        ? addMonths(startOfMonth(query.anchor), direction)
        : addDaysToDateKey(query.anchor, direction * 7);
    navigate({ anchor });
  }

  async function mutate(action: () => Promise<string | null>) {
    if (isSaving) return;
    setIsSaving(true);
    setMessage("");
    try {
      const result = await action();
      if (result) setMessage(result);
      await reload();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function openCreate(cell: ScheduleCell) {
    const defaults =
      lastDraft.current ??
      (templates[0]
        ? {
            startTime: templates[0].startTime,
            endTime: templates[0].endTime,
            breakMinutes: templates[0].breakMinutes,
            templateId: templates[0].id,
          }
        : {
            startTime: "09:00",
            endTime: "17:00",
            breakMinutes: 60,
            templateId: null,
          });
    setDialog({
      kind: "shift",
      mode: "create",
      initial: {
        ...defaults,
        note: null,
        userId: cell.userId,
        date: cell.date,
      },
      readOnly: false,
    });
  }

  function openShift(shift: ScheduledShift) {
    setDialog({
      kind: "shift",
      mode: "edit",
      shift,
      initial: shiftDraftFrom(shift),
      readOnly: !staffById.get(shift.userId)?.canEdit,
    });
  }

  async function saveShift(values: ShiftDraft, options: { publish: boolean }) {
    if (!outlet || dialog?.kind !== "shift") return;
    setIsSaving(true);
    try {
      if (dialog.mode === "edit" && dialog.shift) {
        await scheduleRequest("/api/schedules", {
          method: "PATCH",
          body: { ...values, id: dialog.shift.id, outletId: outlet.id },
        });
        setMessage("Shift updated.");
      } else {
        await scheduleRequest("/api/schedules", {
          method: "POST",
          body: {
            outletId: outlet.id,
            shifts: [values],
            publish: options.publish,
          },
        });
        setMessage(options.publish ? "Shift published." : "Draft shift added.");
      }
      lastDraft.current = {
        startTime: values.startTime,
        endTime: values.endTime,
        breakMinutes: values.breakMinutes,
        templateId: values.templateId ?? null,
      };
      setDialog(null);
      await reload();
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteShift() {
    if (!outlet || dialog?.kind !== "shift" || !dialog.shift) return;
    const shift = dialog.shift;
    const name = staffById.get(shift.userId)?.name ?? "this person";
    if (
      !(await confirm({
        title: "Delete this shift?",
        description:
          shift.status === "published"
            ? `${name} has already been given this published shift.`
            : `The draft shift for ${name} will be removed.`,
        confirmLabel: "Delete shift",
        tone: "danger",
      }))
    )
      return;
    setIsSaving(true);
    try {
      await scheduleRequest("/api/schedules", {
        method: "DELETE",
        body: { outletId: outlet.id, ids: [shift.id] },
      });
      setDialog(null);
      setMessage("Shift deleted.");
      await reload();
    } finally {
      setIsSaving(false);
    }
  }

  async function paint(cells: ScheduleCell[]) {
    if (!outlet || !brush) return;
    if (brush.kind === "erase") {
      const targets = cells.flatMap(
        (cell) => shiftsByCell.get(cellKey(cell.userId, cell.date)) ?? [],
      );
      if (!targets.length) return;
      const published = targets.filter(
        (shift) => shift.status === "published",
      ).length;
      if (
        !(await confirm({
          title: `Erase ${targets.length} shift${targets.length === 1 ? "" : "s"}?`,
          description: published
            ? `${published} of them ${published === 1 ? "is" : "are"} already published to staff.`
            : "These drafts haven't been published yet.",
          confirmLabel: "Erase",
          tone: "danger",
        }))
      )
        return;
      await mutate(async () => {
        await scheduleRequest("/api/schedules", {
          method: "DELETE",
          body: { outletId: outlet.id, ids: targets.map((shift) => shift.id) },
        });
        return `Erased ${targets.length} shift${targets.length === 1 ? "" : "s"}.`;
      });
      return;
    }
    const times =
      brush.kind === "template"
        ? {
            startTime: brush.template.startTime,
            endTime: brush.template.endTime,
            breakMinutes: brush.template.breakMinutes,
            templateId: brush.template.id,
          }
        : { ...brush, templateId: null };
    const free = cells.filter(
      (cell) => !shiftsByCell.get(cellKey(cell.userId, cell.date))?.length,
    );
    const skipped = cells.length - free.length;
    if (!free.length) {
      setMessage(
        "Those days already have shifts. Use the eraser or open a shift to change it.",
      );
      return;
    }
    await mutate(async () => {
      await scheduleRequest("/api/schedules", {
        method: "POST",
        body: {
          outletId: outlet.id,
          shifts: free.map((cell) => ({
            userId: cell.userId,
            date: cell.date,
            startTime: times.startTime,
            endTime: times.endTime,
            breakMinutes: times.breakMinutes,
            templateId: times.templateId,
          })),
        },
      });
      return `Added ${free.length} draft shift${free.length === 1 ? "" : "s"}${
        skipped
          ? ` · ${skipped} day${skipped === 1 ? "" : "s"} already had a shift`
          : ""
      }.`;
    });
  }

  function moveShift(shift: ScheduledShift, cell: ScheduleCell, copy: boolean) {
    if (!outlet) return;
    if (!copy && shift.userId === cell.userId && shift.date === cell.date)
      return;
    const name = staffById.get(cell.userId)?.name ?? "staff";
    const values = {
      ...shiftDraftFrom(shift),
      userId: cell.userId,
      date: cell.date,
    };
    void mutate(async () => {
      if (copy) {
        await scheduleRequest("/api/schedules", {
          method: "POST",
          body: { outletId: outlet.id, shifts: [values] },
        });
        return `Copied shift to ${name} as a draft.`;
      }
      await scheduleRequest("/api/schedules", {
        method: "PATCH",
        body: { ...values, id: shift.id, outletId: outlet.id },
      });
      return `Moved shift to ${name}.`;
    });
  }

  async function publishRange() {
    if (!outlet || !data || !stats.drafts) return;
    if (
      !(await confirm({
        title: `Publish ${stats.drafts} draft shift${stats.drafts === 1 ? "" : "s"}?`,
        description: `Staff at ${outlet.name} will see these shifts and attendance tracking starts for them.`,
        confirmLabel: "Publish",
      }))
    )
      return;
    await mutate(async () => {
      const result = await scheduleRequest<{ published: number }>(
        "/api/schedules/publish",
        {
          method: "POST",
          body: { outletId: outlet.id, from: data.from, to: data.to },
        },
      );
      return `Published ${result.published} shift${result.published === 1 ? "" : "s"}.`;
    });
  }

  async function copyWeeks(values: CopyValues) {
    if (!outlet) return;
    await mutate(async () => {
      const result = await scheduleRequest<{
        created: number;
        skipped: number;
      }>("/api/schedules/copy", {
        method: "POST",
        body: { outletId: outlet.id, ...values },
      });
      setDialog(null);
      return `Copied ${result.created} shift${result.created === 1 ? "" : "s"} as drafts${
        result.skipped ? ` · ${result.skipped} skipped because of clashes` : ""
      }.`;
    });
  }

  function exportCsv() {
    if (!data || !outlet) return;
    const header = [
      "Date",
      "Staff",
      "Email",
      "Start",
      "End",
      "Break (min)",
      "Break taken (min)",
      "Paid hours",
      "Template",
      "Status",
      "Attendance",
      "Late (min)",
      "Early in (min)",
      "Overtime (min)",
      "Note",
    ];
    const rows = [...data.shifts]
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .map((shift) => {
        const person = staffById.get(shift.userId);
        const attendance = shift.attendance;
        return [
          shift.date,
          person?.name ?? "",
          person?.email ?? "",
          shift.startTime,
          shift.endTime,
          shift.breakMinutes,
          attendance?.sessionIds.length ? attendance.actualBreakMinutes : "",
          (shiftDurationMinutes(shift) / 60).toFixed(2),
          shift.templateId
            ? (templatesById.get(shift.templateId)?.name ?? "")
            : "Custom",
          shift.status,
          attendance
            ? [attendance.status, ...attendance.flags]
                .join(" ")
                .replaceAll("_", " ")
            : "",
          attendance?.lateMinutes || "",
          attendance?.earlyMinutes || "",
          attendance?.overtimeMinutes || "",
          shift.note ?? "",
        ];
      });
    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `schedule-${outlet.name.replace(/\W+/g, "-").toLowerCase()}-${data.from}-to-${data.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const today = data?.today ?? query.anchor;
  const range = data
    ? formatRangeLabel(data.from, data.to, query.view)
    : "Loading…";
  const isCurrent = data ? today >= data.from && today <= data.to : true;
  const canEditAnyone = data?.staff.some((person) => person.canEdit) ?? false;
  const customInvalid = validateShiftTimes(customBrush);
  const brushLabel =
    brush?.kind === "erase"
      ? "Eraser: click or drag across days to remove shifts."
      : brush?.kind === "template"
        ? `Painting “${brush.template.name}”: click or drag across empty days.`
        : brush?.kind === "custom"
          ? `Painting ${brush.startTime}–${brush.endTime}: click or drag across empty days.`
          : null;

  return (
    <div className="team-page-content schedule-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKFORCE PLANNING</p>
          <h1>Schedules</h1>
          <p className="subheading">
            Build flexible weekly or monthly rosters, then track lateness,
            absence and overtime against them.
          </p>
        </div>
        <div className="schedule-heading-actions">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!outlet}
            onClick={() => setDialog({ kind: "templates" })}
          >
            Templates
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!outlet || !canEditAnyone}
            onClick={() => setDialog({ kind: "copy" })}
          >
            Copy / repeat
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!data?.shifts.length}
            onClick={exportCsv}
          >
            <span aria-hidden="true">↓</span> Export CSV
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!stats.drafts || isSaving}
            onClick={() => void publishRange()}
          >
            Publish{stats.drafts ? ` ${stats.drafts}` : ""}
          </button>
        </div>
      </div>

      <div className="schedule-toolbar">
        <label className="schedule-outlet-select">
          <span className="sr-only">Outlet</span>
          <select
            value={query.outletId}
            disabled={!data}
            onChange={(event) => navigate({ outletId: event.target.value })}
          >
            {data?.outlets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div
          className="team-view-nav schedule-segmented"
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
              {view === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
        <div className="schedule-date-nav">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={`Previous ${query.view}`}
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isCurrent}
            onClick={() => navigate({ anchor: data?.today ?? localDateKey() })}
          >
            Today
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={`Next ${query.view}`}
            onClick={() => step(1)}
          >
            ›
          </button>
          <label className="schedule-range-label">
            <strong>{range}</strong>
            <input
              type="date"
              aria-label="Jump to date"
              value={query.anchor}
              onChange={(event) => {
                if (event.target.value)
                  navigate({ anchor: event.target.value });
              }}
            />
          </label>
        </div>
        <div
          className="team-view-nav schedule-segmented schedule-tabs"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "roster"}
            className={`team-view-tab${tab === "roster" ? " is-active" : ""}`}
            onClick={() => setTab("roster")}
          >
            Roster
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "insights"}
            className={`team-view-tab${tab === "insights" ? " is-active" : ""}`}
            onClick={() => setTab("insights")}
          >
            Attendance
            {stats.alerts ? (
              <span className="schedule-tab-count">{stats.alerts}</span>
            ) : null}
          </button>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label="Refresh"
          title="Refresh"
          disabled={isLoading}
          onClick={() => void load(query)}
        >
          <RefreshIcon />
        </button>
      </div>

      <div className="timesheet-summary schedule-summary" aria-live="polite">
        <div>
          <span>Shifts</span>
          <strong>{data ? stats.count : "—"}</strong>
        </div>
        <div>
          <span>Scheduled hours</span>
          <strong>{data ? formatHours(stats.minutes) : "—"}</strong>
        </div>
        <div>
          <span>Staff rostered</span>
          <strong>
            {data
              ? `${stats.rostered}/${data.staff.filter((person) => person.isMember).length}`
              : "—"}
          </strong>
        </div>
        <div className={stats.drafts ? "is-attention" : ""}>
          <span>Unpublished drafts</span>
          <strong>{data ? stats.drafts : "—"}</strong>
        </div>
      </div>

      {message && (
        <p className="team-message" role="status">
          {message}
        </p>
      )}

      {tab === "roster" ? (
        <section className="schedule-board" aria-busy={isLoading || isSaving}>
          <div className="schedule-palette" role="toolbar" aria-label="Brush">
            <span className="schedule-palette-label">Brush</span>
            <button
              type="button"
              className={`schedule-brush${brush === null ? " is-active" : ""}`}
              aria-pressed={brush === null}
              onClick={() => setBrush(null)}
            >
              <span aria-hidden="true">↖</span> Select
            </button>
            {templates.map((template) => {
              const active =
                brush?.kind === "template" && brush.template.id === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  className={`schedule-brush shift-color-${template.color}${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  title={`${template.name} · ${template.startTime}–${template.endTime}`}
                  disabled={!canEditAnyone}
                  onClick={() =>
                    setBrush(active ? null : { kind: "template", template })
                  }
                >
                  <span className="schedule-brush-code">{template.code}</span>
                  {template.startTime}–{template.endTime}
                </button>
              );
            })}
            <span
              className={`schedule-brush schedule-brush-custom${brush?.kind === "custom" ? " is-active" : ""}`}
            >
              <button
                type="button"
                aria-pressed={brush?.kind === "custom"}
                disabled={!canEditAnyone || Boolean(customInvalid)}
                title={customInvalid ?? "Paint a custom time"}
                onClick={() =>
                  setBrush(
                    brush?.kind === "custom"
                      ? null
                      : { kind: "custom", ...customBrush },
                  )
                }
              >
                Custom
              </button>
              <input
                type="time"
                aria-label="Custom start"
                value={customBrush.startTime}
                onChange={(event) => {
                  const next = {
                    ...customBrush,
                    startTime: event.target.value,
                  };
                  setCustomBrush(next);
                  if (brush?.kind === "custom" && !validateShiftTimes(next))
                    setBrush({ kind: "custom", ...next });
                }}
              />
              <span aria-hidden="true">–</span>
              <input
                type="time"
                aria-label="Custom end"
                value={customBrush.endTime}
                onChange={(event) => {
                  const next = { ...customBrush, endTime: event.target.value };
                  setCustomBrush(next);
                  if (brush?.kind === "custom" && !validateShiftTimes(next))
                    setBrush({ kind: "custom", ...next });
                }}
              />
            </span>
            <button
              type="button"
              className={`schedule-brush schedule-brush-erase${brush?.kind === "erase" ? " is-active" : ""}`}
              aria-pressed={brush?.kind === "erase"}
              disabled={!canEditAnyone}
              onClick={() =>
                setBrush(brush?.kind === "erase" ? null : { kind: "erase" })
              }
            >
              <span aria-hidden="true">⌫</span> Eraser
            </button>
            <span className="schedule-palette-spacer" />
            <label className="schedule-search">
              <span className="sr-only">Search staff</span>
              <input
                type="search"
                placeholder="Search staff"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="schedule-checkbox schedule-only-rostered">
              <input
                type="checkbox"
                checked={onlyRostered}
                onChange={(event) => setOnlyRostered(event.target.checked)}
              />
              Rostered only
            </label>
          </div>

          {brushLabel ? (
            <p className="schedule-hint is-brush">
              {brushLabel} <kbd>Esc</kbd> to stop.
            </p>
          ) : (
            <p className="schedule-hint">
              Click <strong>+</strong> to add a shift, drag a shift to move it
              (hold <kbd>Alt</kbd> to copy), or pick a brush to paint many days
              at once.
              {!templates.length &&
                " Tip: create templates for your usual shifts first."}
            </p>
          )}

          {data && !data.staff.length ? (
            <div className="schedule-empty">
              <h2>No staff assigned to {outlet?.name}</h2>
              <p>
                Assign people to this outlet from the Team page to start
                rostering.
              </p>
            </div>
          ) : data ? (
            <ScheduleGrid
              view={query.view}
              days={days}
              today={today}
              staff={visibleStaff}
              shiftsByCell={shiftsByCell}
              shiftsById={shiftsById}
              templates={templatesById}
              brush={isSaving ? null : brush}
              onAddShift={openCreate}
              onOpenShift={openShift}
              onPaint={(cells) => void paint(cells)}
              onMoveShift={moveShift}
            />
          ) : (
            <div className="schedule-skeleton" aria-hidden="true" />
          )}

          <ul className="schedule-legend" aria-label="Legend">
            <li>
              <span className="schedule-chip-swatch is-draft" /> Draft (not
              visible to staff)
            </li>
            <li>
              <span className="schedule-chip-swatch" /> Published
            </li>
            <li>
              <span className="schedule-dot tone-success" /> On time
            </li>
            <li>
              <span className="schedule-dot tone-warning" /> Late / left early
            </li>
            <li>
              <span className="schedule-dot tone-danger" /> Absent
            </li>
            <li>
              <span className="schedule-dot tone-overtime" /> Overtime
            </li>
          </ul>
        </section>
      ) : data ? (
        <AttendancePanel data={data} onOpenShift={openShift} />
      ) : (
        <div className="schedule-skeleton" aria-hidden="true" />
      )}

      {dialog?.kind === "shift" && outlet && data && (
        <ShiftDialog
          key={
            dialog.shift?.id ??
            `${dialog.initial.userId}-${dialog.initial.date}`
          }
          mode={dialog.mode}
          initial={dialog.initial}
          shift={dialog.shift}
          staff={data.staff}
          templates={templates}
          timezone={outlet.timezone}
          outletName={outlet.name}
          isSaving={isSaving}
          readOnly={dialog.readOnly}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onSave={saveShift}
          onDelete={dialog.mode === "edit" ? deleteShift : undefined}
        />
      )}
      {dialog?.kind === "templates" && outlet && (
        <TemplateDialog
          outletId={outlet.id}
          outletName={outlet.name}
          templates={templates}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onChanged={async (text) => {
            setMessage(text);
            await reload();
          }}
        />
      )}
      {dialog?.kind === "copy" && outlet && (
        <CopyDialog
          anchorWeek={startOfWeek(data?.today ?? query.anchor)}
          outletName={outlet.name}
          isSaving={isSaving}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onCopy={copyWeeks}
        />
      )}
      {confirmDialog}
    </div>
  );
}
