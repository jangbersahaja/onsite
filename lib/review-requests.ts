import type { CorrectionEvent } from "@/lib/break-corrections";

export type ReviewList<T> = {
  items: T[] | null;
  error: string;
};

export type CorrectionReviewRequest = {
  id: string;
  requestedBy: string;
  requesterName: string;
  requesterEmail: string;
  outletId: string;
  outletName: string;
  timezone: string;
  workSessionId: string | null;
  workBreakId: string | null;
  event: CorrectionEvent;
  requestedAt: string;
  breakStartedAt: string | null;
  breakEndedAt: string | null;
  reason: string;
  status: "reconciliation";
  appliedAt: string | null;
  createdAt: string;
};

export type PastShiftReviewRequest = {
  id: string;
  outletId: string;
  outletName: string;
  requestedBy: string;
  requesterName: string;
  requesterUsername: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string;
  reason: string;
  status: "pending";
  createdAt: string;
};

export type DeviceReviewRequest = {
  id: string;
  userId: string;
  employeeName: string;
  employeeEmail: string;
  createdAt: string;
  outletNames: string[];
};

export type OutletOption = {
  id: string;
  name: string;
};

export const CORRECTION_EVENT_LABELS: Record<CorrectionEvent, string> = {
  clock_in: "Clock in",
  clock_out: "Clock out",
  break_update: "Break update",
  break_add: "Break added",
  break_delete: "Break deleted",
};

/** Fetches one review queue. Failures are returned as data, never thrown. */
export async function loadReviewList<T>(
  url: string,
  fallbackError: string,
): Promise<ReviewList<T>> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const body = (await response.json()) as {
      requests?: T[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(body.error ?? fallbackError);
    }
    return { items: body.requests ?? [], error: "" };
  } catch (error) {
    return {
      items: null,
      error: error instanceof Error ? error.message : fallbackError,
    };
  }
}

export type ReviewLists = {
  correction: ReviewList<CorrectionReviewRequest>;
  pastShift: ReviewList<PastShiftReviewRequest>;
  device: ReviewList<DeviceReviewRequest>;
};

/** Loads all three queues in parallel, scoped to one outlet when given. */
export async function loadReviewLists(outletId?: string): Promise<ReviewLists> {
  const query = new URLSearchParams({ view: "review" });
  if (outletId) query.set("outletId", outletId);
  const [correction, pastShift, device] = await Promise.all([
    loadReviewList<CorrectionReviewRequest>(
      `/api/corrections?${query}`,
      "Could not load clock corrections.",
    ),
    loadReviewList<PastShiftReviewRequest>(
      `/api/manual-shifts?${query}`,
      "Could not load past shift requests.",
    ),
    loadReviewList<DeviceReviewRequest>(
      `/api/staff-devices?${query}`,
      "Could not load device enrollments.",
    ),
  ]);
  return { correction, pastShift, device };
}

/**
 * Keeps the last good items when a refresh fails, so the queue does not
 * blank out while the error is shown.
 */
export function mergeReviewList<T>(
  previous: ReviewList<T>,
  next: ReviewList<T>,
): ReviewList<T> {
  if (next.error && previous.items) {
    return { items: previous.items, error: next.error };
  }
  return next;
}

export function sortOldestFirst<T extends { createdAt: string }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

const OVERDUE_AFTER_MS = 24 * 60 * 60_000;

/** True once a request has waited at least one day. */
export function isOverdue(createdAt: string, now: number): boolean {
  return now - Date.parse(createdAt) >= OVERDUE_AFTER_MS;
}

/** Human-readable age of a pending request, e.g. "Waiting 3 h". */
export function formatWaitingSince(createdAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(createdAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "Submitted just now";
  if (minutes < 60) return `Waiting ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Waiting ${hours} h`;
  return `Waiting ${Math.floor(hours / 24)} d`;
}

export function formatReviewDateTime(value: string, timezone?: string) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
