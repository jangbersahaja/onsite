"use client";

import { ModalDialog } from "@/app/_components/modal-dialog";
import { useState, type FormEvent } from "react";

type TimesheetDeleteDialogProps = {
  employeeName: string;
  shiftLabel: string;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
};

export function TimesheetDeleteDialog({
  employeeName,
  shiftLabel,
  isSaving,
  onOpenChange,
  onConfirm,
}: TimesheetDeleteDialogProps) {
  const [reason, setReason] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onConfirm(reason.trim());
  }

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      labelledBy="timesheet-delete-title"
    >
      <div className="dialog-panel confirm-dialog-panel">
        <header className="dialog-header confirm-dialog-header">
          <div>
            <h2 id="timesheet-delete-title">Delete this shift?</h2>
            <p className="confirm-dialog-description">
              {employeeName}&apos;s shift on {shiftLabel} and its breaks will be
              permanently removed. The deletion is kept in the audit log.
            </p>
          </div>
        </header>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label className="timesheet-reason">
            Reason for deletion (required)
            <input
              autoFocus
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="confirm-dialog-actions">
            <button
              className="btn btn-secondary btn-lg"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-lg btn-danger-solid"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? "Deleting…" : "Delete shift"}
            </button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
