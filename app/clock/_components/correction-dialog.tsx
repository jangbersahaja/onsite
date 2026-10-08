"use client";

import { ModalDialog } from "@/app/_components/modal-dialog";
import {
  formatOutletDateTime,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import { useState, type FormEvent } from "react";

type CorrectionOutlet = {
  id: string;
  name: string;
  timezone: string;
};

type CorrectionShift = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
};

type CorrectionDialogProps = {
  open: boolean;
  outlets: CorrectionOutlet[];
  shifts: CorrectionShift[];
  initialOutletId?: string;
  initialShiftId?: string;
  initialEvent?: "clock_in" | "clock_out";
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => Promise<void>;
};

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
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
  const [event, setEvent] = useState<"clock_in" | "clock_out">(initialEvent);
  const [requestedTime, setRequestedTime] = useState(() => {
    const outlet = outlets.find((item) => item.id === initialOutletId);
    return outlet ? formatOutletDateTime(new Date(), outlet.timezone) : "";
  });
  const [shiftId, setShiftId] = useState(initialShiftId ?? "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedOutlet = outlets.find((outlet) => outlet.id === outletId);
  const relevantShifts = shifts.filter((shift) => shift.outletId === outletId);

  async function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!selectedOutlet || isSubmitting) return;
    setIsSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId,
          workSessionId: shiftId || null,
          event,
          requestedAt: outletDateTimeToISOString(
            requestedTime,
            selectedOutlet.timezone,
          ),
          reason,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not submit the request.");
      await onSubmitted();
      onOpenChange(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not submit the request.",
      );
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
            <p className="eyebrow">TIME ADJUSTMENT</p>
            <h2 id="correction-dialog-title">Request a correction</h2>
            <p className="correction-dialog-description">
              This punch takes effect right away. A manager will reconcile it
              later.
            </p>
          </div>
          <button
            className="dialog-close"
            type="button"
            aria-label="Close correction request"
            onClick={() => onOpenChange(false)}
          >
            ×
          </button>
        </header>
        <form className="correction-form" onSubmit={handleSubmit}>
          <label>
            Outlet
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
              Event
              <select
                value={event}
                onChange={(inputEvent) =>
                  setEvent(inputEvent.target.value as "clock_in" | "clock_out")
                }
              >
                <option value="clock_in">Clock in</option>
                <option value="clock_out">Clock out</option>
              </select>
            </label>
            <label>
              Requested time
              <input
                type="datetime-local"
                value={requestedTime}
                onChange={(inputEvent) =>
                  setRequestedTime(inputEvent.target.value)
                }
                required
              />
            </label>
          </div>
          <label>
            Related shift
            <select
              value={shiftId}
              onChange={(inputEvent) => setShiftId(inputEvent.target.value)}
            >
              <option value="" disabled={event === "clock_out"}>
                Missing clock-in event
              </option>
              {relevantShifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.outletName} ·{" "}
                  {formatDate(shift.clockInAt, shift.timezone)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(inputEvent) => setReason(inputEvent.target.value)}
              minLength={5}
              maxLength={1000}
              rows={3}
              placeholder="Tell your outlet lead what happened."
              required
            />
          </label>
          {message && (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
          <div className="correction-dialog-actions">
            <button
              className="team-secondary-action"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              className="auth-submit"
              type="submit"
              disabled={isSubmitting || !selectedOutlet}
            >
              {isSubmitting ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
