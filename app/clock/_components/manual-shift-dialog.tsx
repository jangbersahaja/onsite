"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { CloseIcon, TrashIcon } from "@/app/_components/icons";
import { useLocale } from "@/app/_components/locale-provider";
import { ModalDialog } from "@/app/_components/modal-dialog";
import {
  CORRECTION_REASON_CODES,
  type CorrectionReasonCode,
} from "@/lib/correction-reasons";
import { errorMessage, type ErrorText } from "@/lib/i18n/errors";
import { outletDateTimeToISOString } from "@/lib/outlet-time";
import { useState, type FormEvent } from "react";

export type ManualShiftOutlet = {
  id: string;
  name: string;
  timezone: string;
};

type ManualShiftBreakDraft = { startedAt: string; endedAt: string };

type ManualShiftDialogProps = {
  outlets: ManualShiftOutlet[];
  defaultOutletId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (error: ErrorText | null) => Promise<void>;
};

export function ManualShiftDialog({
  outlets,
  defaultOutletId,
  onOpenChange,
  onSaved,
}: ManualShiftDialogProps) {
  const { messages } = useLocale();
  const t = messages.history.manualShift;
  const c = messages.dialogs.correction;
  const { confirm, confirmDialog } = useConfirmDialog();
  const [outletId, setOutletId] = useState(defaultOutletId);
  const [clockInAt, setClockInAt] = useState("");
  const [clockOutAt, setClockOutAt] = useState("");
  const [breaks, setBreaks] = useState<ManualShiftBreakDraft[]>([]);
  const [reasonCode, setReasonCode] = useState<CorrectionReasonCode | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ErrorText | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const outlet = outlets.find((item) => item.id === outletId) ?? outlets[0];

  function updateBreak(index: number, patch: Partial<ManualShiftBreakDraft>) {
    setBreaks((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || !outlet) return;
    if (!reasonCode) {
      setError({ code: null, text: c.reasonRequired });
      return;
    }

    let payload: {
      outletId: string;
      clockInAt: string;
      clockOutAt: string;
      breaks: { startedAt: string; endedAt: string }[];
      reasonCode: CorrectionReasonCode;
      reason: string;
    };
    try {
      // The server converts local clock times with the outlet timezone.
      // Breaks are sent as offset timestamps, so convert them here.
      payload = {
        outletId: outlet.id,
        clockInAt,
        clockOutAt,
        breaks: breaks.map((item) => ({
          startedAt: outletDateTimeToISOString(item.startedAt, outlet.timezone),
          endedAt: outletDateTimeToISOString(item.endedAt, outlet.timezone),
        })),
        reasonCode,
        reason: reason.trim(),
      };
    } catch {
      setError({ code: null, text: t.fallbackError });
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
    try {
      const response = await fetch("/api/manual-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setError({
          code: result.code ?? null,
          text: String(result.error ?? t.fallbackError),
        });
        return;
      }
      await onSaved(null);
      onOpenChange(false);
    } catch {
      setError({ code: null, text: t.fallbackError });
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
      labelledBy="manual-shift-title"
    >
      <div className="dialog-panel timesheet-edit-dialog-panel">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{t.pastShift}</p>
            <h2 id="manual-shift-title">{t.title}</h2>
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
            {t.outlet}
            <select
              required
              value={outlet?.id ?? ""}
              onChange={(event) => setOutletId(event.target.value)}
            >
              {outlets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.clockIn}
            <input
              type="datetime-local"
              required
              value={clockInAt}
              onChange={(event) => setClockInAt(event.target.value)}
            />
          </label>
          <label>
            {c.clockOut}
            <input
              type="datetime-local"
              required
              value={clockOutAt}
              onChange={(event) => setClockOutAt(event.target.value)}
            />
          </label>

          <div className="timesheet-break-editor">
            <div className="timesheet-break-heading">
              <strong>{c.breaksHeading}</strong>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() =>
                  setBreaks((current) => [
                    ...current,
                    { startedAt: "", endedAt: "" },
                  ])
                }
              >
                {c.eventBreakAdd}
              </button>
            </div>
            {breaks.map((item, index) => (
              <div className="timesheet-break-fields" key={`break-${index}`}>
                <label>
                  {c.breakStart}
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
                  {c.breakEnd}
                  <input
                    type="datetime-local"
                    required
                    value={item.endedAt}
                    onChange={(event) =>
                      updateBreak(index, { endedAt: event.target.value })
                    }
                  />
                </label>
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  type="button"
                  aria-label={c.eventBreakDelete}
                  title={c.eventBreakDelete}
                  onClick={() =>
                    setBreaks((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>

          <fieldset className="timesheet-reason manual-shift-reason-options">
            <legend>{c.reason}</legend>
            {CORRECTION_REASON_CODES.map((code) => (
              <label key={code} className="manual-shift-reason-option">
                <input
                  type="checkbox"
                  checked={reasonCode === code}
                  onChange={(event) =>
                    setReasonCode(event.target.checked ? code : "")
                  }
                />
                {c.reasonOptions[code]}
              </label>
            ))}
          </fieldset>
          <label className="timesheet-reason">
            {c.reasonDetails}
            <input
              required
              minLength={3}
              maxLength={500}
              value={reason}
              placeholder={c.reasonDetailsPlaceholder}
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
              {c.cancel}
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
