"use client";

import {
  BreakEditor,
  type EditingBreak,
} from "@/app/(management)/timesheets/_components/break-editor";
import { CloseIcon } from "@/app/_components/icons";
import { ModalDialog } from "@/app/_components/modal-dialog";
import { useState, type FormEvent } from "react";

export type TimesheetCreateValues = {
  clockInAt: string;
  clockOutAt: string;
  breaks: EditingBreak[];
  reason: string;
};

type TimesheetCreateDialogProps = {
  employeeName: string;
  outletName: string;
  timezone: string;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: TimesheetCreateValues) => Promise<void>;
};

export function TimesheetCreateDialog({
  employeeName,
  outletName,
  timezone,
  isSaving,
  onOpenChange,
  onSave,
}: TimesheetCreateDialogProps) {
  const [clockInAt, setClockInAt] = useState("");
  const [clockOutAt, setClockOutAt] = useState("");
  const [breaks, setBreaks] = useState<EditingBreak[]>([]);
  const [reason, setReason] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave({ clockInAt, clockOutAt, breaks, reason });
  }

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      labelledBy="timesheet-create-title"
    >
      <div className="dialog-panel timesheet-edit-dialog-panel">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{outletName}</p>
            <h2 id="timesheet-create-title">Add shift · {employeeName}</h2>
          </div>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            type="button"
            aria-label="Close add shift"
            title="Close add shift"
            onClick={() => onOpenChange(false)}
          >
            <CloseIcon />
          </button>
        </header>
        <form
          className="timesheet-edit-fields timesheet-edit-modal-fields"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label>
            Clock in ({timezone})
            <input
              type="datetime-local"
              required
              value={clockInAt}
              onChange={(event) => setClockInAt(event.target.value)}
            />
          </label>
          <label>
            Clock out ({timezone})
            <input
              type="datetime-local"
              required
              value={clockOutAt}
              onChange={(event) => setClockOutAt(event.target.value)}
            />
          </label>
          <BreakEditor
            timezone={timezone}
            breaks={breaks}
            onChange={setBreaks}
            requireEnd
          />
          <label className="timesheet-reason">
            Reason for adding this shift
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
              className="btn btn-secondary"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? "Adding…" : "Add shift"}
            </button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
