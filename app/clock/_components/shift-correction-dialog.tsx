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
import {
  formatOutletDateTime,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import {
  buildShiftCorrectionRequests,
  correctionScheduleVariance,
  type CorrectionSchedule,
  type ShiftCorrectionBreak,
  type ShiftCorrectionRequest,
  type ShiftCorrectionSnapshot,
} from "@/lib/shift-correction";
import { useState, type FormEvent } from "react";

export type ShiftCorrectionShift = {
  id: string | null;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string | null;
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
  staffUserId?: string;
  schedule?: CorrectionSchedule | null;
};

type ShiftCorrectionDialogProps = {
  shift: ShiftCorrectionShift;
  onOpenChange: (open: boolean) => void;
  onSaved: (error: ErrorText | null) => Promise<void>;
};

function formatDuration(minutes: number) {
  const absolute = Math.abs(minutes);
  return `${Math.floor(absolute / 60)}h ${String(absolute % 60).padStart(2, "0")}m`;
}

function formatVariance(minutes: number) {
  return `${minutes > 0 ? "+" : minutes < 0 ? "-" : ""}${formatDuration(minutes)}`;
}

function snapshotOf(shift: ShiftCorrectionShift): ShiftCorrectionSnapshot {
  const toLocal = (value: string) =>
    formatOutletDateTime(value, shift.timezone);
  return shift.id === null
    ? { clockInAt: "", clockOutAt: "", breaks: [] }
    : {
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
  const [clockInAt, setClockInAt] = useState(() =>
    shift.id === null
      ? formatOutletDateTime(shift.clockInAt, shift.timezone)
      : original.clockInAt,
  );
  const [clockOutAt, setClockOutAt] = useState(() =>
    shift.id === null && shift.clockOutAt
      ? formatOutletDateTime(shift.clockOutAt, shift.timezone)
      : original.clockOutAt,
  );
  const [breaks, setBreaks] = useState<ShiftCorrectionBreak[]>(original.breaks);
  const [reasonCode, setReasonCode] = useState<CorrectionReasonCode | "">("");
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
  const scheduleStart = shift.schedule
    ? formatOutletDateTime(shift.schedule.startAt, shift.timezone)
    : null;
  const scheduleEnd = shift.schedule
    ? formatOutletDateTime(shift.schedule.endAt, shift.timezone)
    : null;
  let correctedBreakMinutes = 0;
  try {
    correctedBreakMinutes = breaks.reduce((total, item) => {
      if (!item.startedAt || !item.endedAt) return total;
      return (
        total +
        Math.max(
          0,
          Math.round(
            (Date.parse(toISO(item.endedAt)) -
              Date.parse(toISO(item.startedAt))) /
              60_000,
          ),
        )
      );
    }, 0);
  } catch {
    correctedBreakMinutes = 0;
  }
  let scheduleVariance: ReturnType<typeof correctionScheduleVariance> | null =
    null;
  if (shift.schedule && clockInAt && clockOutAt) {
    try {
      scheduleVariance = correctionScheduleVariance(shift.schedule, {
        clockInAt: toISO(clockInAt),
        clockOutAt: toISO(clockOutAt),
        breakMinutes: correctedBreakMinutes,
      });
    } catch {
      scheduleVariance = null;
    }
  }

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
    if (!reasonCode) {
      setError({ code: null, text: t.reasonRequired });
      return;
    }

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
    let workSessionId = shift.id;
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
            workSessionId,
            ...(shift.staffUserId ? { staffUserId: shift.staffUserId } : {}),
            reasonCode,
            reason:
              reasonCode === "other" ? reason : t.reasonOptions[reasonCode],
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
        workSessionId = result.session?.id ?? workSessionId;
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
          {shift.schedule && scheduleStart && scheduleEnd && (
            <section
              className="shift-correction-schedule"
              aria-label="Published schedule"
            >
              <div>
                <span>Published schedule</span>
                <strong>
                  {scheduleStart.slice(11)} - {scheduleEnd.slice(11)}
                </strong>
                <small>
                  {shift.schedule.templateName ?? "Custom shift"} ·{" "}
                  {shift.schedule.breakMinutes}m break
                </small>
              </div>
              {shift.schedule.note && <p>{shift.schedule.note}</p>}
              <div className="shift-correction-schedule-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => setClockInAt(scheduleStart)}
                >
                  Use scheduled start
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => setClockOutAt(scheduleEnd)}
                >
                  Use scheduled end
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => {
                    setClockInAt(scheduleStart);
                    setClockOutAt(scheduleEnd);
                  }}
                >
                  Use both
                </button>
              </div>
            </section>
          )}
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
              required={shift.id === null || original.clockOutAt !== ""}
              value={clockOutAt}
              onChange={(event) => setClockOutAt(event.target.value)}
            />
          </label>
          {scheduleVariance && (
            <div className="shift-correction-variance" aria-live="polite">
              <span>Schedule variance</span>
              <strong>
                Start {formatVariance(scheduleVariance.startMinutes ?? 0)} · End{" "}
                {formatVariance(scheduleVariance.endMinutes ?? 0)}
              </strong>
              <small>
                Paid {formatDuration(scheduleVariance.paidMinutes ?? 0)} vs{" "}
                {formatDuration(scheduleVariance.scheduledPaidMinutes)}{" "}
                scheduled
                {scheduleVariance.breakMinutes !== 0
                  ? ` · Break ${formatVariance(scheduleVariance.breakMinutes)}`
                  : ""}
              </small>
            </div>
          )}

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

          <fieldset className="timesheet-reason correction-reason-options">
            <legend>{t.reason}</legend>
            {CORRECTION_REASON_CODES.map((code) => (
              <label key={code} className="correction-reason-option">
                <input
                  type="radio"
                  name="shift-correction-reason"
                  checked={reasonCode === code}
                  onChange={() => setReasonCode(code)}
                />
                {t.reasonOptions[code]}
              </label>
            ))}
          </fieldset>
          {reasonCode === "other" && (
            <label className="timesheet-reason">
              {t.reasonDetails}
              <input
                required
                minLength={5}
                maxLength={1000}
                value={reason}
                placeholder={t.reasonDetailsPlaceholder}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
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
