"use client";

import {
  formatMinutes,
  scheduleRequest,
} from "@/app/(management)/schedules/_components/schedule-format";
import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { CloseIcon, EditIcon, TrashIcon } from "@/app/_components/icons";
import { ModalDialog } from "@/app/_components/modal-dialog";
import {
  SHIFT_COLORS,
  shiftSpanMinutes,
  validateShiftTimes,
  type ShiftColor,
} from "@/lib/schedule-rules";
import type { ShiftTemplate } from "@/lib/schedule-types";
import { useState, type FormEvent } from "react";

type TemplateForm = {
  id: string | null;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  color: ShiftColor;
};

const emptyForm: TemplateForm = {
  id: null,
  name: "",
  code: "",
  startTime: "09:00",
  endTime: "17:00",
  breakMinutes: 60,
  color: "violet",
};

const starterTemplates: Omit<TemplateForm, "id">[] = [
  { name: "Morning", code: "AM", startTime: "08:00", endTime: "14:00", breakMinutes: 0, color: "sky" },
  { name: "Afternoon", code: "PM", startTime: "14:00", endTime: "20:00", breakMinutes: 0, color: "amber" },
  { name: "Closing", code: "CL", startTime: "17:00", endTime: "23:00", breakMinutes: 0, color: "violet" },
  { name: "Full day", code: "FD", startTime: "09:00", endTime: "18:00", breakMinutes: 60, color: "emerald" },
];

export function TemplateDialog({
  outletId,
  outletName,
  templates,
  onOpenChange,
  onChanged,
}: {
  outletId: string;
  outletName: string;
  templates: ShiftTemplate[];
  onOpenChange: (open: boolean) => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const { confirm, confirmDialog } = useConfirmDialog();

  function update(patch: Partial<TemplateForm>) {
    setError("");
    setForm((current) => ({ ...current, ...patch }));
  }

  async function save(values: TemplateForm) {
    const invalid = validateShiftTimes(values);
    if (invalid) {
      setError(invalid);
      return;
    }
    setIsSaving(true);
    try {
      const { id, ...fields } = values;
      await scheduleRequest("/api/schedules/templates", {
        method: id ? "PATCH" : "POST",
        body: { ...fields, outletId, ...(id ? { id } : {}) },
      });
      setForm(emptyForm);
      await onChanged(id ? "Template updated." : `Template “${values.name}” added.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the template.");
    } finally {
      setIsSaving(false);
    }
  }

  async function addStarterSet() {
    setIsSaving(true);
    setError("");
    try {
      for (const template of starterTemplates) {
        await scheduleRequest("/api/schedules/templates", {
          method: "POST",
          body: { ...template, outletId },
        });
      }
      await onChanged("Starter templates added. Adjust the times to suit this outlet.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add templates.");
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(template: ShiftTemplate) {
    if (
      !(await confirm({
        title: `Delete “${template.name}”?`,
        description:
          "Shifts already scheduled with this template keep their times and become custom shifts.",
        confirmLabel: "Delete template",
        tone: "danger",
      }))
    )
      return;
    setIsSaving(true);
    try {
      await scheduleRequest("/api/schedules/templates", {
        method: "DELETE",
        body: { outletId, id: template.id },
      });
      if (form.id === template.id) setForm(emptyForm);
      await onChanged("Template deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the template.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(form);
  }

  const span =
    /^\d{2}:\d{2}$/.test(form.startTime) && /^\d{2}:\d{2}$/.test(form.endTime)
      ? shiftSpanMinutes(form.startTime, form.endTime)
      : 0;

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      labelledBy="schedule-template-title"
    >
      <div className="dialog-panel schedule-dialog-panel">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{outletName}</p>
            <h2 id="schedule-template-title">Shift templates</h2>
            <p className="subheading">
              Reusable shift times for this outlet. Pick one as a brush to paint the roster.
            </p>
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

        {templates.length ? (
          <ul className="schedule-template-list">
            {templates.map((template) => (
              <li key={template.id} className={`shift-color-${template.color}`}>
                <span className="schedule-template-code">{template.code}</span>
                <span className="schedule-template-text">
                  <strong>{template.name}</strong>
                  <small>
                    {template.startTime}–{template.endTime}
                    {template.breakMinutes
                      ? ` · ${formatMinutes(template.breakMinutes)} break`
                      : ""}
                  </small>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label={`Edit ${template.name}`}
                  title="Edit"
                  onClick={() => setForm({ ...template })}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label={`Delete ${template.name}`}
                  title="Delete"
                  disabled={isSaving}
                  onClick={() => void remove(template)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="schedule-empty-inline">
            <p>No templates yet. Start with a common set and tweak the times.</p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isSaving}
              onClick={() => void addStarterSet()}
            >
              Add Morning, Afternoon, Closing &amp; Full day
            </button>
          </div>
        )}

        <form className="schedule-form schedule-template-form" onSubmit={handleSubmit}>
          <h3 className="schedule-form-wide">
            {form.id ? "Edit template" : "New template"}
          </h3>
          <label>
            Name
            <input
              required
              maxLength={40}
              placeholder="Morning"
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <label>
            Short code
            <input
              required
              maxLength={4}
              placeholder="AM"
              value={form.code}
              onChange={(event) => update({ code: event.target.value.toUpperCase() })}
            />
          </label>
          <label>
            Start
            <input
              type="time"
              required
              value={form.startTime}
              onChange={(event) => update({ startTime: event.target.value })}
            />
          </label>
          <label>
            End
            <input
              type="time"
              required
              value={form.endTime}
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
              value={form.breakMinutes}
              onChange={(event) =>
                update({ breakMinutes: Math.max(0, Number(event.target.value) || 0) })
              }
            />
          </label>
          <div className="schedule-form-summary">
            <span>Paid time</span>
            <strong>{span ? formatMinutes(Math.max(0, span - form.breakMinutes)) : "—"}</strong>
          </div>
          <fieldset className="schedule-form-wide schedule-color-picker">
            <legend>Colour</legend>
            <div>
              {SHIFT_COLORS.map((color) => (
                <label key={color} className={`shift-color-${color}`}>
                  <input
                    type="radio"
                    name="template-color"
                    value={color}
                    checked={form.color === color}
                    onChange={() => update({ color })}
                  />
                  <span className="sr-only">{color}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p className="schedule-form-wide schedule-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions schedule-form-actions">
            {form.id && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setForm(emptyForm)}
              >
                Cancel edit
              </button>
            )}
            <span className="schedule-form-spacer" />
            <button className="btn btn-primary" type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : form.id ? "Save template" : "Add template"}
            </button>
          </div>
        </form>
      </div>
      {confirmDialog}
    </ModalDialog>
  );
}
