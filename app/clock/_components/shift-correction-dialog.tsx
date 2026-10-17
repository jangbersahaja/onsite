"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { CloseIcon, TrashIcon } from "@/app/_components/icons";
import { useLocale } from "@/app/_components/locale-provider";
import { ModalDialog } from "@/app/_components/modal-dialog";
import { errorMessage, type ErrorText } from "@/lib/i18n/errors";
import {
  formatOutletDateTime,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import {
  buildShiftCorrectionRequests,
  type ShiftCorrectionBreak,
  type ShiftCorrectionRequest,
  type ShiftCorrectionSnapshot,
} from "@/lib/shift-correction";
import { useState, type FormEvent } from "react";

export type ShiftCorrectionShift = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string | null;
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
};

type ShiftCorrectionDialogProps = {
  shift: ShiftCorrectionShift;
  onOpenChange: (open: boolean) => void;
  onSaved: (error: ErrorText | null) => Promise<void>;
};

function snapshotOf(shift: ShiftCorrectionShift): ShiftCorrectionSnapshot {
  const toLocal = (value: string) =>
    formatOutletDateTime(value, shift.timezone);
  return {
    clockInAt: toLocal(shift.clockInAt),
    clockOutAt: shift.clockOutAt ? toLocal(shift.clockOutAt) : "",
    breaks: shift.breaks.map((item) => ({
      id: item.id,
      startedAt: toLocal(item.startedAt),
      endedAt: item.endedAt ? toLocal(item.endedAt) : "",
    })),
  };
}

export function ShiftCorrectionDialog({
  shift,
  onOpenChange,
  onSaved,
}: ShiftCorrectionDialogProps) {
  const { messages } = useLocale();
  const t = messages.dialogs.correction;
  const { confirm, confirmDialog } = useConfirmDialog();
  const [original] = useState(() => snapshotOf(shift));
  const [clockInAt, setClockInAt] = useState(original.clockInAt);
  const [clockOutAt, setClockOutAt] = useState(original.clockOutAt);
  const [breaks, setBreaks] = useState<ShiftCorrectionBreak[]>(original.breaks);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ErrorText | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openBreakIds = new Set(
    original.breaks
      .filter((item) => item.endedAt === "")
      .map((item) => item.id),
  );
  const toISO = (local: string) =>
    outletDateTimeToISOString(local, shift.timezone);

  function updateBreak(index: number, patch: Partial<ShiftCorrectionBreak>) {
    setBreaks((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    let requests: ShiftCorrectionRequest[];
    try {
      requests = buildShiftCorrectionRequests(
        original,
        { clockInAt, clockOutAt, breaks },
        toISO,
      );
    } catch {
      setError({ code: null, text: t.fallbackError });
      return;
    }
    if (requests.length === 0) {
      setError({ code: null, text: t.noChanges });
      return;
    }
    if (
      !(await confirm({
        title: t.confirmTitle,
        description: t.confirmDescription,
        confirmLabel: t.confirmLabel,
      }))
    )
      return;

    setIsSubmitting(true);
    setError(null);
    let applied = 0;
    // Once a request has been applied, the shift has changed, so the dialog closes and reports the failure.
    const fail = async (failure: ErrorText) => {
      if (applied === 0) {
        setError(failure);
        return;
      }
      await onSaved(failure);
      onOpenChange(false);
    };
    try {
      for (const request of requests) {
        const response = await fetch("/api/corrections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outletId: shift.outletId,
            workSessionId: shift.id,
            reason,
            ...request,
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          await fail({
            code: result.code ?? null,
            text: String(result.error ?? t.fallbackError),
          });
          return;
        }
        applied += 1;
      }
      await onSaved(null);
      onOpenChange(false);
    } catch {
      await fail({ code: null, text: t.fallbackError });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onOpenChange(false);
      }}
      labelledBy="shift-correction-title"
    >
      <div className="dialog-panel timesheet-edit-dialog-panel">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{shift.outletName}</p>
            <h2 id="shift-correction-title">{t.shiftTitle}</h2>
            <p className="correction-dialog-description">{t.description}</p>
          </div>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            type="button"
            aria-label={t.closeLabel}
            title={t.closeTitle}
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
            {t.clockIn}
            <input
              type="datetime-local"
              required
              value={clockInAt}
              onChange={(event) => setClockInAt(event.target.value)}
            />
          </label>
          <label>
            {t.clockOut}
            <input
              type="datetime-local"
              required={original.clockOutAt !== ""}
              value={clockOutAt}
              onChange={(event) => setClockOutAt(event.target.value)}
            />
          </label>

          <div className="timesheet-break-editor">
            <div className="timesheet-break-heading">
              <strong>{t.breaksHeading}</strong>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() =>
                  setBreaks((current) => [
                    ...current,
                    { id: null, startedAt: "", endedAt: "" },
                  ])
                }
              >
                {t.eventBreakAdd}
              </button>
            </div>
            {breaks.map((item, index) => {
              const isOpen = item.id !== null && openBreakIds.has(item.id);
              return (
                <div
                  className="timesheet-break-fields"
                  key={item.id ?? `new-${index}`}
                >
                  <label>
                    {t.breakStart}
                    <input
                      type="datetime-local"
                      required
                      value={item.startedAt}
                      onChange={(event) =>
                        updateBreak(index, { startedAt: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t.breakEnd}
                    <input
                      type="datetime-local"
                      required={!isOpen}
                      disabled={isOpen}
                      value={item.endedAt}
                      onChange={(event) =>
                        updateBreak(index, { endedAt: event.target.value })
                      }
                    />
                    {isOpen && (
                      <small className="correction-dialog-description">
                        {t.breakOpenHint}
                      </small>
                    )}
                  </label>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    type="button"
                    aria-label={t.eventBreakDelete}
                    title={t.eventBreakDelete}
                    onClick={() =>
                      setBreaks((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
          </div>

          <label className="timesheet-reason">
            {t.reason}
            <input
              required
              minLength={5}
              maxLength={1000}
              value={reason}
              placeholder={t.reasonPlaceholder}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {errorMessage(messages, error)}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              {t.cancel}
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t.submitting : t.submit}
            </button>
          </div>
        </form>
      </div>
      {confirmDialog}
    </ModalDialog>
  );
}
