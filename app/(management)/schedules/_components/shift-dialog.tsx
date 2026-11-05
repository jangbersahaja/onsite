"use client";

import {
  attendanceBadges,
  formatLongDate,
  formatMinutes,
  templateMatches,
  type ShiftDraft,
} from "@/app/(management)/schedules/_components/schedule-format";
import { CloseIcon, TrashIcon } from "@/app/_components/icons";
import { ModalDialog } from "@/app/_components/modal-dialog";
import { formatOutletDateTime } from "@/lib/outlet-time";
import {
  endsNextDay,
  isTimeOfDay,
  shiftSpanMinutes,
  validateShiftTimes,
} from "@/lib/schedule-rules";
import type {
  ScheduledShift,
  ScheduleStaff,
  ShiftTemplate,
} from "@/lib/schedule-types";
import { useState, type FormEvent } from "react";

type ShiftDialogProps = {
  mode: "create" | "edit";
  initial: ShiftDraft;
  shift?: ScheduledShift;
  staff: ScheduleStaff[];
  templates: ShiftTemplate[];
  timezone: string;
  outletName: string;
  isSaving: boolean;
  readOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: ShiftDraft, options: { publish: boolean }) => Promise<void>;
  onDelete?: () => Promise<void>;
};

export function ShiftDialog({
  mode,
  initial,
  shift,
  staff,
  templates,
  timezone,
  outletName,
  isSaving,
  readOnly = false,
  onOpenChange,
  onSave,
  onDelete,
}: ShiftDialogProps) {
  const [values, setValues] = useState<ShiftDraft>(initial);
  const [publish, setPublish] = useState(false);
  const [error, setError] = useState("");
  const editableStaff = staff.filter(
    (member) => member.canEdit || member.userId === initial.userId,
  );
  const selectedTemplate = templates.find(
    (template) => template.id === values.templateId,
  );
  const validTimes =
    isTimeOfDay(values.startTime) && isTimeOfDay(values.endTime);
  const span = validTimes
    ? shiftSpanMinutes(values.startTime, values.endTime)
    : 0;
  const paidMinutes = Math.max(0, span - values.breakMinutes);
  const badges = shift ? attendanceBadges(shift) : [];
  const attendance = shift?.attendance;

  function update(patch: Partial<ShiftDraft>) {
    setError("");
    setValues((current) => ({ ...current, ...patch }));
  }

  function applyTemplate(template: ShiftTemplate) {
    update({
      templateId: template.id,
      startTime: template.startTime,
      endTime: template.endTime,
      breakMinutes: template.breakMinutes,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validateShiftTimes(values);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      await onSave(
        {
          ...values,
          templateId: templateMatches(selectedTemplate, values)
            ? values.templateId
            : null,
          note: values.note?.trim() || null,
        },
        { publish },
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the shift.",
      );
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    try {
      await onDelete();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete the shift.",
      );
    }
  }

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      labelledBy="schedule-shift-title"
    >
      <div className="dialog-panel schedule-dialog-panel">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{outletName}</p>
            <h2 id="schedule-shift-title">
              {mode === "create"
                ? "Schedule a shift"
                : readOnly
                  ? "Scheduled shift"
                  : "Edit scheduled shift"}
            </h2>
            {shift && (
              <p className="schedule-dialog-status">
                <span
                  className={`schedule-status-pill is-${shift.status}`}
                >
                  {shift.status === "draft" ? "Draft" : "Published"}
                </span>
                {badges.map((badge) => (
                  <span
                    key={badge.label}
                    className={`schedule-badge tone-${badge.tone}`}
                  >
                    {badge.label}
                  </span>
                ))}
              </p>
            )}
          </div>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            type="button"
            aria-label="Close"
            title="Close"
            onClick={() => onOpenChange(false)}
          >
            <CloseIcon />
          </button>
        </header>

        {attendance && attendance.status !== "upcoming" && (
          <section className="schedule-attendance-card" aria-label="Attendance">
            <div>
              <span>Scheduled</span>
              <strong>
                {shift!.startTime} – {shift!.endTime}
              </strong>
            </div>
            <div>
              <span>Clocked in</span>
              <strong>
                {attendance.clockInAt
                  ? formatOutletDateTime(attendance.clockInAt, timezone).slice(11)
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Clocked out</span>
              <strong>
                {attendance.clockOutAt
                  ? formatOutletDateTime(attendance.clockOutAt, timezone).slice(11)
                  : attendance.status === "in_progress"
                    ? "On shift"
                    : "—"}
              </strong>
            </div>
            <div>
              <span>Worked</span>
              <strong>
                {attendance.workedMinutes
                  ? formatMinutes(attendance.workedMinutes)
                  : "—"}
              </strong>
            </div>
          </section>
        )}

        <form
          className="schedule-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <fieldset className="schedule-form-fields" disabled={readOnly}>
          <label>
            Staff
            <select
              required
              value={values.userId}
              onChange={(event) => update({ userId: event.target.value })}
            >
              {!values.userId && <option value="">Choose staff</option>}
              {editableStaff.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              required
              value={values.date}
              onChange={(event) => update({ date: event.target.value })}
            />
          </label>

          {templates.length > 0 && (
            <fieldset className="schedule-template-picker">
              <legend>Quick pick</legend>
              <div>
                {templates.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    className={`schedule-template-option shift-color-${template.color}${templateMatches(template, values) && values.templateId === template.id ? " is-selected" : ""}`}
                    onClick={() => applyTemplate(template)}
                    aria-pressed={
                      templateMatches(template, values) &&
                      values.templateId === template.id
                    }
                  >
                    <strong>{template.name}</strong>
                    <small>
                      {template.startTime}–{template.endTime}
                    </small>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <label>
            Start
            <input
              type="time"
              required
              value={values.startTime}
              onChange={(event) => update({ startTime: event.target.value })}
            />
          </label>
          <label>
            End
            <input
              type="time"
              required
              value={values.endTime}
              onChange={(event) => update({ endTime: event.target.value })}
            />
          </label>
          <label>
            Unpaid break (minutes)
            <input
              type="number"
              min={0}
              max={240}
              step={5}
              inputMode="numeric"
              value={values.breakMinutes}
              onChange={(event) =>
                update({
                  breakMinutes: Math.max(0, Number(event.target.value) || 0),
                })
              }
            />
          </label>
          <div className="schedule-form-summary" aria-live="polite">
            <span>Paid time</span>
            <strong>{validTimes ? formatMinutes(paidMinutes) : "—"}</strong>
            {validTimes && endsNextDay(values.startTime, values.endTime) && (
              <small>Ends the next day</small>
            )}
          </div>
          <label className="schedule-form-wide">
            Note for this shift (optional)
            <input
              maxLength={300}
              placeholder="e.g. Opening duty, stock count"
              value={values.note ?? ""}
              onChange={(event) => update({ note: event.target.value })}
            />
          </label>
          {values.date && (
            <p className="schedule-form-wide schedule-form-hint">
              {formatLongDate(values.date)} · times in {timezone}
            </p>
          )}
          {mode === "create" && (
            <label className="schedule-form-wide schedule-checkbox">
              <input
                type="checkbox"
                checked={publish}
                onChange={(event) => setPublish(event.target.checked)}
              />
              Publish now (otherwise saved as a draft)
            </label>
          )}
          </fieldset>
          {readOnly && (
            <p className="schedule-form-wide schedule-form-hint">
              You can view this shift but not change it.
            </p>
          )}
          {error && (
            <p className="schedule-form-wide schedule-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions schedule-form-actions">
            {onDelete && !readOnly && (
              <button
                className="btn btn-danger"
                type="button"
                disabled={isSaving}
                onClick={() => void handleDelete()}
              >
                <TrashIcon /> Remove
              </button>
            )}
            <span className="schedule-form-spacer" />
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              hidden={readOnly}
              disabled={isSaving || readOnly || !values.userId}
            >
              {isSaving
                ? "Saving…"
                : mode === "create"
                  ? publish
                    ? "Save & publish"
                    : "Save draft"
                  : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
