"use client";

import {
  AlertIcon,
  CheckIcon,
  EyeIcon,
  LoaderIcon,
} from "@/app/_components/icons";
import type { ReviewList } from "@/lib/review-requests";
import { formatWaitingSince, isOverdue } from "@/lib/review-requests";

export type ReviewRowState = "open" | "queued" | "sending" | "failed" | "done";

const ACTION_LABEL: Record<ReviewRowState, string> = {
  open: "Review",
  queued: "Queued",
  sending: "Saving…",
  failed: "Failed, open to retry",
  done: "Done",
};

export type ReviewRowText = {
  eyebrow: string;
  title: string;
  detail: string;
  change: string;
  schedule: string;
  createdAt: string;
};

type ReviewQueueProps<T extends { id: string }> = {
  label: string;
  queue: ReviewList<T>;
  describe: (item: T) => ReviewRowText;
  /** Queued, sending and done rows stay on screen but cannot be reopened. */
  stateOf: (item: T) => ReviewRowState;
  onSelect: (id: string) => void;
  /** Null until the first load completes; the age line is hidden until then. */
  now: number | null;
  loadingText: string;
  emptyText: string;
};

export function ReviewQueue<T extends { id: string }>({
  label,
  queue,
  describe,
  stateOf,
  onSelect,
  now,
  loadingText,
  emptyText,
}: ReviewQueueProps<T>) {
  const { items, error } = queue;
  const rows = items ?? [];

  return (
    <section className="correction-review-list" aria-label={label}>
      {error && (
        <p className="team-message" role="alert">
          {error}
          {items !== null && " Showing previously loaded requests."}
        </p>
      )}
      {items === null && !error && (
        <p className="correction-review-empty">{loadingText}</p>
      )}
      {rows.length > 0 && (
        <ul className="correction-review-rows">
          {rows.map((item) => {
            const row = describe(item);
            const state = stateOf(item);
            const done = state === "done";
            const inFlight = state === "queued" || state === "sending";
            const overdue =
              !done && now !== null && isOverdue(row.createdAt, now);
            return (
              <li key={item.id}>
                <button
                  className={[
                    "correction-review-row",
                    overdue && "correction-review-row-overdue",
                    done && "correction-review-row-done",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  disabled={done || inFlight}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="correction-review-row-main">
                    <span className="eyebrow">{row.eyebrow}</span>
                    <strong>{row.title}</strong>
                    <small className="correction-review-row-change">
                      {row.change}
                    </small>
                    <small className="correction-review-row-schedule">
                      {row.schedule}
                    </small>
                  </span>
                  <span className="correction-review-row-meta">
                    <span>{row.detail}</span>
                    {now !== null && !done && (
                      <small>
                        {formatWaitingSince(row.createdAt, now)}
                        {overdue && " · Overdue"}
                      </small>
                    )}
                  </span>
                  <span
                    className={`correction-review-row-action correction-review-row-action-${state}`}
                    title={ACTION_LABEL[state]}
                  >
                    <ActionIcon state={state} />
                    <span className="sr-only">{ACTION_LABEL[state]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {items !== null && !error && rows.length === 0 && (
        <p className="correction-review-empty">{emptyText}</p>
      )}
    </section>
  );
}

function ActionIcon({ state }: { state: ReviewRowState }) {
  if (state === "done") return <CheckIcon />;
  if (state === "failed") return <AlertIcon />;
  if (state === "queued" || state === "sending") return <LoaderIcon />;
  return <EyeIcon />;
}
