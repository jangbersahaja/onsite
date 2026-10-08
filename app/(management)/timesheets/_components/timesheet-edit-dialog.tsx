"use client";

import { ModalDialog } from "@/app/_components/modal-dialog";
import { formatOutletDateTime } from "@/lib/outlet-time";
import { useState, type FormEvent } from "react";

type EditingBreak = {
  id: string | null;
  startedAt: string;
  endedAt: string;
};

type EditableTimesheetRow = {
  id: string;
  employeeName: string;
  outletName: string;
  timezone: string;
  clockInLocal: string;
  clockOutLocal: string | null;
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
};

export type TimesheetEditValues = {
  clockInAt: string;
  clockOutAt: string;
  breaks: EditingBreak[];
  reason: string;
};

type TimesheetEditDialogProps = {
  row: EditableTimesheetRow;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: TimesheetEditValues) => Promise<void>;
};

export function TimesheetEditDialog({
  row,
  isSaving,
  onOpenChange,
  onSave,
}: TimesheetEditDialogProps) {
  const [clockInAt, setClockInAt] = useState(
    row.clockInLocal.slice(0, 16).replace(" ", "T"),
  );
  const [clockOutAt, setClockOutAt] = useState(
    row.clockOutLocal?.slice(0, 16).replace(" ", "T") ?? "",
  );
  const [editingBreaks, setEditingBreaks] = useState<EditingBreak[]>(() =>
    row.breaks.map((breakInterval) => ({
      id: breakInterval.id,
      startedAt: formatOutletDateTime(breakInterval.startedAt, row.timezone),
      endedAt: breakInterval.endedAt
        ? formatOutletDateTime(breakInterval.endedAt, row.timezone)
        : "",
    })),
  );
  const [reason, setReason] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave({ clockInAt, clockOutAt, breaks: editingBreaks, reason });
  }

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      labelledBy="timesheet-edit-title"
    >
      <div className="dialog-panel timesheet-edit-dialog-panel">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{row.outletName}</p>
            <h2 id="timesheet-edit-title">Edit shift · {row.employeeName}</h2>
          </div>
          <button
            className="dialog-close"
            type="button"
            aria-label="Close shift editor"
            onClick={() => onOpenChange(false)}
          >
            ×
          </button>
        </header>
        <form
          className="timesheet-edit-fields timesheet-edit-modal-fields"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label>
            Clock in ({row.timezone})
            <input
              type="datetime-local"
              required
              value={clockInAt}
              onChange={(event) => setClockInAt(event.target.value)}
            />
          </label>
          <label>
            Clock out ({row.timezone})
            <input
              type="datetime-local"
              value={clockOutAt}
              onChange={(event) => setClockOutAt(event.target.value)}
            />
          </label>
          <div className="timesheet-break-editor">
            <div className="timesheet-break-heading">
              <strong>Breaks</strong>
              <button
                className="team-secondary-action"
                type="button"
                onClick={() =>
                  setEditingBreaks((current) => [
                    ...current,
                    { id: null, startedAt: "", endedAt: "" },
                  ])
                }
              >
                Add break
              </button>
            </div>
            {editingBreaks.map((breakInterval, index) => (
              <div
                className="timesheet-break-fields"
                key={breakInterval.id ?? `new-${index}`}
              >
                <label>
                  Break starts ({row.timezone})
                  <input
                    type="datetime-local"
                    required
                    value={breakInterval.startedAt}
                    onChange={(event) =>
                      setEditingBreaks((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, startedAt: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Break ends
                  <input
                    type="datetime-local"
                    value={breakInterval.endedAt}
                    onChange={(event) =>
                      setEditingBreaks((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, endedAt: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  className="timesheet-edit-button"
                  type="button"
                  onClick={() =>
                    setEditingBreaks((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <label className="timesheet-reason">
            Reason for change
            <input
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button
              className="team-secondary-action"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button className="auth-submit" type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save audited edit"}
            </button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
