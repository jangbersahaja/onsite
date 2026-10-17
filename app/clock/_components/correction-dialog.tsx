"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { useLocale } from "@/app/_components/locale-provider";
import { ModalDialog } from "@/app/_components/modal-dialog";
import {
  isBreakCorrectionEvent,
  type CorrectionEvent,
} from "@/lib/break-corrections";
import { localeTags } from "@/lib/i18n/config";
import { errorMessage, type ErrorText } from "@/lib/i18n/errors";
import {
  formatOutletDateTime,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import { useState, type FormEvent } from "react";
import { CloseIcon } from "../../_components/icons";

type CorrectionOutlet = {
  id: string;
  name: string;
  timezone: string;
};

type CorrectionBreak = {
  id: string;
  startedAt: string;
  endedAt: string | null;
};

type CorrectionShift = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  breaks: CorrectionBreak[];
};

type CorrectionDialogProps = {
  open: boolean;
  outlets: CorrectionOutlet[];
  shifts: CorrectionShift[];
  initialOutletId?: string;
  initialShiftId?: string;
  initialEvent?: CorrectionEvent;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => Promise<void>;
};

function formatDate(value: string, timezone: string, tag: string) {
  return new Intl.DateTimeFormat(tag, {
    timeZone: timezone,
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function formatTime(value: string, timezone: string, tag: string) {
  return new Intl.DateTimeFormat(tag, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CorrectionDialog({
  open,
  outlets,
  shifts,
  initialOutletId,
  initialShiftId,
  initialEvent = "clock_in",
  onOpenChange,
  onSubmitted,
}: CorrectionDialogProps) {
  const [outletId, setOutletId] = useState(initialOutletId ?? "");
  const [event, setEvent] = useState<CorrectionEvent>(initialEvent);
  const [requestedTime, setRequestedTime] = useState(() => {
    const outlet = outlets.find((item) => item.id === initialOutletId);
    return outlet ? formatOutletDateTime(new Date(), outlet.timezone) : "";
  });
  const [shiftId, setShiftId] = useState(initialShiftId ?? "");
  const [breakId, setBreakId] = useState("");
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ErrorText | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { locale, messages } = useLocale();
  const t = messages.dialogs.correction;
  const { confirm, confirmDialog } = useConfirmDialog();
  const selectedOutlet = outlets.find((outlet) => outlet.id === outletId);
  const relevantShifts = shifts.filter((shift) => shift.outletId === outletId);
  const isBreakEvent = isBreakCorrectionEvent(event);
  const selectedShift = shifts.find((shift) => shift.id === shiftId);
  const shiftBreaks = selectedShift?.breaks ?? [];
  const selectedBreak = shiftBreaks.find((item) => item.id === breakId);
  const isOpenBreak =
    selectedBreak !== undefined && selectedBreak.endedAt === null;
  const showBreakTimes =
    isBreakEvent &&
    event !== "break_delete" &&
    (event === "break_add" || selectedBreak !== undefined);
  const showBreakEnd =
    event === "break_add" || (selectedBreak !== undefined && !isOpenBreak);
  const breakTimezone = selectedShift?.timezone ?? "UTC";

  function handleEventChange(nextEvent: CorrectionEvent) {
    setEvent(nextEvent);
    setBreakId("");
    setBreakStart("");
    setBreakEnd("");
  }

  function handleShiftChange(nextShiftId: string) {
    setShiftId(nextShiftId);
    setBreakId("");
    setBreakStart("");
    setBreakEnd("");
  }

  function handleBreakChange(nextBreakId: string) {
    setBreakId(nextBreakId);
    const nextBreak = shiftBreaks.find((item) => item.id === nextBreakId);
    setBreakStart(
      nextBreak
        ? formatOutletDateTime(new Date(nextBreak.startedAt), breakTimezone)
        : "",
    );
    setBreakEnd(
      nextBreak?.endedAt
        ? formatOutletDateTime(new Date(nextBreak.endedAt), breakTimezone)
        : "",
    );
  }

  async function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!selectedOutlet || isSubmitting) return;
    const timezone = selectedOutlet.timezone;
    const breakStartedAt = breakStart
      ? outletDateTimeToISOString(breakStart, timezone)
      : null;
    // Break corrections are dated by the break start, so the clock time is unused.
    const requestedAt = isBreakEvent
      ? breakStartedAt
      : outletDateTimeToISOString(requestedTime, timezone);
    if (!requestedAt) return;
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
      const sendsBreakTimes = isBreakEvent && event !== "break_delete";
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId,
          workSessionId: shiftId || null,
          event,
          requestedAt,
          workBreakId:
            isBreakEvent && event !== "break_add" ? breakId || null : null,
          breakStartedAt: sendsBreakTimes ? breakStartedAt : null,
          breakEndedAt:
            sendsBreakTimes && breakEnd && !isOpenBreak
              ? outletDateTimeToISOString(breakEnd, timezone)
              : null,
          reason,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError({
          code: result.code ?? null,
          text: String(result.error ?? t.fallbackError),
        });
        return;
      }
      await onSubmitted();
      onOpenChange(false);
    } catch {
      setError({ code: null, text: t.fallbackError });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      labelledBy="correction-dialog-title"
    >
      <div className="dialog-panel correction-dialog-panel">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h2 id="correction-dialog-title">{t.title}</h2>
            <p className="correction-dialog-description">{t.description}</p>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            aria-label={t.closeLabel}
            title={t.closeTitle}
            onClick={() => onOpenChange(false)}
          >
            <CloseIcon />
          </button>
        </header>
        <form className="correction-form" onSubmit={handleSubmit}>
          <label>
            {t.outlet}
            <select
              value={outletId}
              onChange={(inputEvent) => {
                const nextOutletId = inputEvent.target.value;
                setOutletId(nextOutletId);
                const nextOutlet = outlets.find(
                  (outlet) => outlet.id === nextOutletId,
                );
                if (nextOutlet) {
                  setRequestedTime(
                    formatOutletDateTime(new Date(), nextOutlet.timezone),
                  );
                }
              }}
              required
            >
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </select>
          </label>
          <div className="correction-form-row">
            <label>
              {t.event}
              <select
                value={event}
                onChange={(inputEvent) =>
                  handleEventChange(inputEvent.target.value as CorrectionEvent)
                }
              >
                <option value="clock_in">{t.clockIn}</option>
                <option value="clock_out">{t.clockOut}</option>
                <option value="break_update">{t.eventBreakUpdate}</option>
                <option value="break_add">{t.eventBreakAdd}</option>
                <option value="break_delete">{t.eventBreakDelete}</option>
              </select>
            </label>
            {!isBreakEvent && (
              <label>
                {t.requestedTime}
                <input
                  type="datetime-local"
                  value={requestedTime}
                  onChange={(inputEvent) =>
                    setRequestedTime(inputEvent.target.value)
                  }
                  required
                />
              </label>
            )}
          </div>
          <label>
            {t.relatedShift}
            <select
              value={shiftId}
              onChange={(inputEvent) =>
                handleShiftChange(inputEvent.target.value)
              }
              required={isBreakEvent}
            >
              <option value="" disabled={event === "clock_out" || isBreakEvent}>
                {t.missingClockIn}
              </option>
              {relevantShifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.outletName} ·{" "}
                  {formatDate(
                    shift.clockInAt,
                    shift.timezone,
                    localeTags[locale],
                  )}
                </option>
              ))}
            </select>
          </label>
          {isBreakEvent && event !== "break_add" && (
            <label>
              {t.breakSelect}
              <select
                value={breakId}
                onChange={(inputEvent) =>
                  handleBreakChange(inputEvent.target.value)
                }
                required
              >
                <option value="" disabled>
                  {t.chooseBreak}
                </option>
                {shiftBreaks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {formatTime(
                      item.startedAt,
                      breakTimezone,
                      localeTags[locale],
                    )}
                    {" – "}
                    {item.endedAt
                      ? formatTime(
                          item.endedAt,
                          breakTimezone,
                          localeTags[locale],
                        )
                      : t.breakStillOpen}
                  </option>
                ))}
              </select>
            </label>
          )}
          {event === "break_update" && isOpenBreak && (
            <p className="correction-dialog-description">{t.breakOpenHint}</p>
          )}
          {event === "break_delete" && selectedBreak && (
            <p className="correction-dialog-description">{t.breakDeleteHint}</p>
          )}
          {showBreakTimes && (
            <div className="correction-form-row">
              <label>
                {t.breakStart}
                <input
                  type="datetime-local"
                  value={breakStart}
                  onChange={(inputEvent) =>
                    setBreakStart(inputEvent.target.value)
                  }
                  required
                />
              </label>
              {showBreakEnd && (
                <label>
                  {t.breakEnd}
                  <input
                    type="datetime-local"
                    value={breakEnd}
                    onChange={(inputEvent) =>
                      setBreakEnd(inputEvent.target.value)
                    }
                    required
                  />
                </label>
              )}
            </div>
          )}
          <label>
            {t.reason}
            <textarea
              value={reason}
              onChange={(inputEvent) => setReason(inputEvent.target.value)}
              minLength={5}
              maxLength={1000}
              rows={3}
              placeholder={t.reasonPlaceholder}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {errorMessage(messages, error)}
            </p>
          )}
          <div className="correction-dialog-actions">
            <button
              className="btn btn-secondary btn-lg"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              {t.cancel}
            </button>
            <button
              className="btn btn-primary btn-lg"
              type="submit"
              disabled={isSubmitting || !selectedOutlet}
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
