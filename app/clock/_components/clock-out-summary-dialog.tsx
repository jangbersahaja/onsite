"use client";

import { useLocale } from "@/app/_components/locale-provider";
import { ModalDialog } from "@/app/_components/modal-dialog";

export type ClockOutSummaryData = {
  outletName: string;
  clockedInLabel: string;
  clockedOutLabel: string;
  workedLabel: string;
  breaks: { timeLabel: string; durationLabel: string }[];
  breakTotalLabel: string;
};

/**
 * Persistent confirmation shown after a successful clock-out. It stays open
 * until the user dismisses it, so the saved shift is never missed.
 */
export function ClockOutSummaryDialog({
  summary,
  onClose,
}: {
  summary: ClockOutSummaryData | null;
  onClose: () => void;
}) {
  const { messages } = useLocale();
  const copy = messages.clock.clockOutSummary;

  return (
    <ModalDialog
      open={summary !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      labelledBy="clock-out-summary-title"
    >
      {summary && (
        <div className="dialog-panel clock-out-summary">
          <div className="clock-out-check-wrap" aria-hidden="true">
            <span className="clock-out-check-halo" />
            <svg className="clock-out-check" viewBox="0 0 96 96">
              <circle
                className="clock-out-check-ring"
                cx="48"
                cy="48"
                r="44"
                pathLength="1"
              />
              <path
                className="clock-out-check-mark"
                d="M30 50 L43 63 L67 36"
                pathLength="1"
              />
            </svg>
          </div>
          <h2 id="clock-out-summary-title">{copy.title}</h2>
          <p className="clock-out-summary-subtitle">{copy.subtitle}</p>
          <dl className="clock-out-summary-grid">
            <div>
              <dt>{copy.outlet}</dt>
              <dd>{summary.outletName}</dd>
            </div>
            <div>
              <dt>{copy.clockedIn}</dt>
              <dd>{summary.clockedInLabel}</dd>
            </div>
            <div>
              <dt>{copy.clockedOut}</dt>
              <dd>{summary.clockedOutLabel}</dd>
            </div>
            <div>
              <dt>{copy.worked}</dt>
              <dd>{summary.workedLabel}</dd>
            </div>
          </dl>
          <div className="clock-out-breaks">
            <h3>{copy.breaksHeading}</h3>
            {summary.breaks.length === 0 ? (
              <p className="clock-out-breaks-empty">{copy.noBreaks}</p>
            ) : (
              <>
                <ul>
                  {summary.breaks.map((item, index) => (
                    <li key={`${item.timeLabel}-${index}`}>
                      <span>{item.timeLabel}</span>
                      <strong>{item.durationLabel}</strong>
                    </li>
                  ))}
                </ul>
                <p className="clock-out-breaks-total">
                  <span>{copy.breakTotal}</span>
                  <strong>{summary.breakTotalLabel}</strong>
                </p>
              </>
            )}
          </div>
          <button
            className="btn btn-primary btn-lg clock-out-summary-done"
            type="button"
            onClick={onClose}
          >
            {copy.done}
          </button>
        </div>
      )}
    </ModalDialog>
  );
}
