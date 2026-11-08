"use client";

import type { ReviewList } from "@/lib/review-requests";
import { formatWaitingSince, isOverdue } from "@/lib/review-requests";

export type ReviewRowText = {
  eyebrow: string;
  title: string;
  detail: string;
  createdAt: string;
};

type ReviewQueueProps<T extends { id: string }> = {
  label: string;
  queue: ReviewList<T>;
  describe: (item: T) => ReviewRowText;
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
            const overdue = now !== null && isOverdue(row.createdAt, now);
            return (
              <li key={item.id}>
                <button
                  className={
                    overdue
                      ? "correction-review-row correction-review-row-overdue"
                      : "correction-review-row"
                  }
                  type="button"
                  onClick={() => onSelect(item.id)}
                >
                  <span className="correction-review-row-main">
                    <span className="eyebrow">{row.eyebrow}</span>
                    <strong>{row.title}</strong>
                    <small>{row.detail}</small>
                    {now !== null && (
                      <small>
                        {formatWaitingSince(row.createdAt, now)}
                        {overdue && " · Overdue"}
                      </small>
                    )}
                  </span>
                  <span className="correction-review-row-action">Review</span>
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
