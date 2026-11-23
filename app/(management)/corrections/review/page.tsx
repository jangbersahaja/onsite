"use client";

import { RefreshIcon } from "@/app/_components/icons";
import { REVIEW_REQUESTS_CHANGED_EVENT } from "@/app/_components/workspace-shell";
import { isBreakCorrectionEvent } from "@/lib/break-corrections";
import {
  formatOutletDateTime,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import {
  CORRECTION_EVENT_LABELS,
  formatReviewDate,
  formatReviewDateTime,
  formatReviewRange,
  formatReviewTime,
  loadReviewLists,
  mergeReviewList,
  sortOldestFirst,
  type CorrectionReviewRequest,
  type DeviceReviewRequest,
  type OutletOption,
  type PastShiftReviewRequest,
  type ReviewList,
  type ReviewLists,
} from "@/lib/review-requests";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  DecisionButton,
  DecisionForm,
  ReviewDialog,
  ReviewNotice,
  type ReviewNoticeState,
} from "./_components/review-dialog";
import { ReviewQueue, type ReviewRowState } from "./_components/review-queue";

type ReviewKind = "correction" | "pastShift" | "device";
type Selection = { kind: ReviewKind; id: string } | null;
type CorrectionDecision = "confirm" | "adjust" | "reject" | "save_note";
type RowProgress = { status: "queued" | "sending" | "failed"; label: string };
type ScheduledCommit = { timer: number; run: () => Promise<void> };

/** Window in which a decision can be undone before it is sent. */
const UNDO_MS = 5_000;
/** Success messages clear on their own; errors stay until the next action. */
const SUCCESS_MS = 4_000;

const TABS: readonly { kind: ReviewKind; label: string }[] = [
  { kind: "correction", label: "Clock corrections" },
  { kind: "pastShift", label: "Past shifts" },
  { kind: "device", label: "Device enrollments" },
];

const EMPTY_LISTS: ReviewLists = {
  correction: { items: null, error: "" },
  pastShift: { items: null, error: "" },
  device: { items: null, error: "" },
};

const CORRECTION_DECISIONS: readonly string[] = [
  "confirm",
  "adjust",
  "reject",
  "save_note",
];

const CORRECTION_SUCCESS: Record<CorrectionDecision, string> = {
  confirm: "Punch marked reconciled.",
  adjust: "Punch adjusted and marked reconciled.",
  reject: "Correction rejected and the previous time restored.",
  save_note: "Note saved. This correction stays in the list.",
};

function isCorrectionDecision(value: string): value is CorrectionDecision {
  return CORRECTION_DECISIONS.includes(value);
}

/** The decision is the submit button's value, which lets one form hold several actions. */
function submittedValue(event: FormEvent<HTMLFormElement>): string {
  const submitter = (event.nativeEvent as SubmitEvent).submitter;
  return submitter instanceof HTMLButtonElement ? submitter.value : "";
}

function noteFieldOf(form: HTMLFormElement) {
  return form.querySelector<HTMLTextAreaElement>('textarea[name="reason"]');
}

function rowKey(kind: ReviewKind, id: string) {
  return `${kind}:${id}`;
}

function formatClock(value: number) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatMinuteVariance(value: number) {
  if (value === 0) return "on schedule";
  const absolute = Math.abs(value);
  return `${absolute} min ${value > 0 ? "after" : "before"}`;
}

function correctionScheduleComparison(request: CorrectionReviewRequest) {
  const schedule = request.scheduleSnapshot;
  if (!schedule) return null;
  if (request.event === "clock_in") {
    return `Requested start is ${formatMinuteVariance(
      Math.round(
        (Date.parse(request.requestedAt) -
          Date.parse(schedule.scheduledStartAt)) /
          60_000,
      ),
    )}.`;
  }
  if (request.event === "clock_out") {
    return `Requested end is ${formatMinuteVariance(
      Math.round(
        (Date.parse(request.requestedAt) -
          Date.parse(schedule.scheduledEndAt)) /
          60_000,
      ),
    )}.`;
  }
  if (request.breakStartedAt && request.breakEndedAt) {
    const minutes = Math.round(
      (Date.parse(request.breakEndedAt) - Date.parse(request.breakStartedAt)) /
        60_000,
    );
    return `Requested break is ${minutes} min; scheduled break is ${schedule.breakMinutes} min.`;
  }
  return request.event === "break_delete"
    ? "This request removes a recorded break."
    : "Compare the requested break with the scheduled break duration.";
}

function withoutItem<T extends { id: string }>(
  list: ReviewList<T>,
  id: string,
): ReviewList<T> {
  return {
    ...list,
    items: list.items?.filter((item) => item.id !== id) ?? null,
  };
}

/** Open items plus items completed this session, oldest first, without duplicates. */
function withCompleted<T extends { id: string; createdAt: string }>(
  open: T[] | null,
  completed: T[],
): T[] | null {
  if (open === null) return null;
  const openIds = new Set(open.map((item) => item.id));
  return sortOldestFirst([
    ...open,
    ...completed.filter((item) => !openIds.has(item.id)),
  ]);
}

/** A selection is only dropped when its queue loaded successfully and no longer lists it. */
function isListed(loaded: ReviewLists, selection: NonNullable<Selection>) {
  const list =
    selection.kind === "correction"
      ? loaded.correction.items
      : selection.kind === "pastShift"
        ? loaded.pastShift.items
        : loaded.device.items;
  return list === null || list.some((item) => item.id === selection.id);
}

export default function CorrectionReviewPage() {
  const [outletId, setOutletId] = useState("");
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [lists, setLists] = useState<ReviewLists>(EMPTY_LISTS);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tab, setTab] = useState<ReviewKind>("correction");
  const [selection, setSelection] = useState<Selection>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<ReviewNoticeState | null>(null);
  const [progress, setProgress] = useState<Record<string, RowProgress>>({});
  const [completedCorrections, setCompletedCorrections] = useState<
    CorrectionReviewRequest[]
  >([]);
  const [completedPastShifts, setCompletedPastShifts] = useState<
    PastShiftReviewRequest[]
  >([]);
  const [completedDevices, setCompletedDevices] = useState<
    DeviceReviewRequest[]
  >([]);
  const loadSeq = useRef(0);
  const commits = useRef(new Map<string, ScheduledCommit>());

  const load = useCallback(async (nextOutletId: string) => {
    const seq = ++loadSeq.current;
    const loaded = await loadReviewLists(nextOutletId || undefined);
    if (seq !== loadSeq.current) return;
    setLists((current) => ({
      correction: mergeReviewList(current.correction, loaded.correction),
      pastShift: mergeReviewList(current.pastShift, loaded.pastShift),
      device: mergeReviewList(current.device, loaded.device),
    }));
    setSelection((current) =>
      current && !isListed(loaded, current) ? null : current,
    );
    const stamp = Date.now();
    setNow(stamp);
    setUpdatedAt(stamp);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load(outletId);
  }, [load, outletId]);

  useEffect(() => {
    let active = true;
    fetch("/api/team", { cache: "no-store" })
      .then(
        (response) => response.json() as Promise<{ outlets?: OutletOption[] }>,
      )
      .then((body) => {
        if (active) setOutlets(body.outlets ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Decisions in the undo window are still on the server queue. Send them on unmount.
  useEffect(() => {
    const scheduled = commits.current;
    return () => {
      for (const entry of Array.from(scheduled.values())) {
        window.clearTimeout(entry.timer);
        void entry.run();
      }
    };
  }, []);

  const unsettled = Object.values(progress).some(
    (row) => row.status !== "failed",
  );
  useEffect(() => {
    if (!unsettled) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsettled]);

  useEffect(() => {
    if (notice?.tone !== "success") return;
    const id = window.setTimeout(
      () => setNotice((current) => (current === notice ? null : current)),
      SUCCESS_MS,
    );
    return () => window.clearTimeout(id);
  }, [notice]);

  function rowStateOf(
    kind: ReviewKind,
    id: string,
    completed: { id: string }[],
  ): ReviewRowState {
    if (completed.some((item) => item.id === id)) return "done";
    return progress[rowKey(kind, id)]?.status ?? "open";
  }
  const queued = Object.entries(progress).filter(
    ([, row]) => row.status === "queued",
  );

  const correctionQueue: ReviewList<CorrectionReviewRequest> = {
    items:
      lists.correction.items === null
        ? null
        : sortOldestFirst(
            lists.correction.items.filter(
              (request) => request.status === "reconciliation",
            ),
          ),
    error: lists.correction.error,
  };
  const pastShiftQueue: ReviewList<PastShiftReviewRequest> = {
    items:
      lists.pastShift.items === null
        ? null
        : sortOldestFirst(lists.pastShift.items),
    error: lists.pastShift.error,
  };
  const deviceQueue: ReviewList<DeviceReviewRequest> = {
    items:
      lists.device.items === null ? null : sortOldestFirst(lists.device.items),
    error: lists.device.error,
  };

  const correctionRows: ReviewList<CorrectionReviewRequest> = {
    items: withCompleted(correctionQueue.items, completedCorrections),
    error: correctionQueue.error,
  };
  const pastShiftRows: ReviewList<PastShiftReviewRequest> = {
    items: withCompleted(pastShiftQueue.items, completedPastShifts),
    error: pastShiftQueue.error,
  };
  const deviceRows: ReviewList<DeviceReviewRequest> = {
    items: withCompleted(deviceQueue.items, completedDevices),
    error: deviceQueue.error,
  };
  const completedTotal =
    completedCorrections.length +
    completedPastShifts.length +
    completedDevices.length;

  const selectedCorrection =
    selection?.kind === "correction"
      ? (correctionQueue.items?.find((item) => item.id === selection.id) ??
        null)
      : null;
  const selectedPastShift =
    selection?.kind === "pastShift"
      ? (pastShiftQueue.items?.find((item) => item.id === selection.id) ?? null)
      : null;
  const selectedDevice =
    selection?.kind === "device"
      ? (deviceQueue.items?.find((item) => item.id === selection.id) ?? null)
      : null;
  const dialogOpen =
    selectedCorrection !== null ||
    selectedPastShift !== null ||
    selectedDevice !== null;

  const queueCounts: Record<ReviewKind, number | null> = {
    correction: correctionQueue.items?.length ?? null,
    pastShift: pastShiftQueue.items?.length ?? null,
    device: deviceQueue.items?.length ?? null,
  };
  const allLoaded = TABS.every(
    ({ kind }) => queueCounts[kind] !== null && !lists[kind].error,
  );
  const openTotal = TABS.reduce(
    (sum, { kind }) => sum + (queueCounts[kind] ?? 0),
    0,
  );
  const allCaughtUp = allLoaded && openTotal === 0 && completedTotal === 0;

  const dialogNotice = notice ? <ReviewNotice notice={notice} /> : null;

  function handleOutletChange(nextOutletId: string) {
    setOutletId(nextOutletId);
    setLists(EMPTY_LISTS);
    setCompletedCorrections([]);
    setCompletedPastShifts([]);
    setCompletedDevices([]);
    setSelection(null);
    setAdjusting(false);
    setNotice(null);
    setIsLoading(true);
  }

  function openItem(kind: ReviewKind, id: string) {
    setNotice(null);
    setAdjusting(false);
    setSelection({ kind, id });
  }

  function closeDialog() {
    setSelection(null);
    setAdjusting(false);
    setNotice(null);
  }

  function removeRequest(kind: ReviewKind, id: string) {
    setLists((current) => {
      switch (kind) {
        case "correction":
          return {
            ...current,
            correction: withoutItem(current.correction, id),
          };
        case "pastShift":
          return { ...current, pastShift: withoutItem(current.pastShift, id) };
        case "device":
          return { ...current, device: withoutItem(current.device, id) };
      }
    });
    setSelection(null);
    window.dispatchEvent(new Event(REVIEW_REQUESTS_CHANGED_EVENT));
  }

  async function sendPatch(
    action: string,
    url: string,
    payload: Record<string, unknown>,
    fallbackError: string,
  ): Promise<boolean> {
    setBusy(action);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? fallbackError);
      return true;
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : fallbackError,
      });
      return false;
    } finally {
      setBusy("");
    }
  }

  function setProgressFor(key: string, value: RowProgress | null) {
    setProgress((current) => {
      const next = { ...current };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  /** Queues the decision for UNDO_MS so it can be undone, then sends it. */
  function scheduleDecision(
    kind: ReviewKind,
    id: string,
    label: string,
    send: () => Promise<boolean>,
    successText: string,
    onDone: () => void,
  ) {
    const key = rowKey(kind, id);
    if (commits.current.has(key)) return;

    const run = async () => {
      commits.current.delete(key);
      setProgressFor(key, { status: "sending", label });
      if (await send()) {
        setProgressFor(key, null);
        removeRequest(kind, id);
        onDone();
        setNotice({ tone: "success", text: successText });
      } else {
        setProgressFor(key, { status: "failed", label });
      }
    };
    const timer = window.setTimeout(() => void run(), UNDO_MS);
    commits.current.set(key, { timer, run });
    setProgressFor(key, { status: "queued", label });
    setSelection(null);
    setAdjusting(false);
    setNotice(null);
  }

  function undoDecision(key: string) {
    const entry = commits.current.get(key);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    commits.current.delete(key);
    setProgressFor(key, null);
  }

  async function decideCorrection(
    event: FormEvent<HTMLFormElement>,
    request: CorrectionReviewRequest,
  ) {
    event.preventDefault();
    if (busy) return;
    const decision = submittedValue(event);
    if (!isCorrectionDecision(decision)) return;

    const form = event.currentTarget;
    const note = noteFieldOf(form);
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    if ((decision === "reject" || decision === "save_note") && !reason) {
      note?.setAttribute("aria-invalid", "true");
      note?.focus();
      setNotice({
        tone: "error",
        text: "Add a reviewer note to reject or save a note.",
      });
      return;
    }
    note?.removeAttribute("aria-invalid");

    const formData = new FormData(form);
    let requestedAt: string | undefined;
    let breakStartedAt: string | undefined;
    let breakEndedAt: string | null | undefined;
    if (decision === "adjust") {
      try {
        if (isBreakCorrectionEvent(request.event)) {
          const localEnd = String(formData.get("breakEndedAt") ?? "");
          breakStartedAt = outletDateTimeToISOString(
            String(formData.get("breakStartedAt") ?? ""),
            request.timezone,
          );
          breakEndedAt = localEnd
            ? outletDateTimeToISOString(localEnd, request.timezone)
            : null;
        } else {
          requestedAt = outletDateTimeToISOString(
            String(formData.get("requestedAt") ?? ""),
            request.timezone,
          );
        }
      } catch (error) {
        setNotice({
          tone: "error",
          text: error instanceof Error ? error.message : "Enter a valid time.",
        });
        return;
      }
    }

    const send = () =>
      sendPatch(
        decision,
        "/api/corrections",
        {
          requestId: request.id,
          outletId: request.outletId,
          decision,
          reason,
          requestedAt,
          breakStartedAt,
          breakEndedAt,
        },
        "Could not record this decision.",
      );

    if (decision === "save_note") {
      if (!(await send())) return;
      setSelection(null);
      setNotice({ tone: "success", text: CORRECTION_SUCCESS.save_note });
      return;
    }

    const label: Record<Exclude<CorrectionDecision, "save_note">, string> = {
      confirm: `Confirming ${request.requesterName}'s correction.`,
      adjust: `Saving the adjusted time for ${request.requesterName}.`,
      reject: `Rejecting ${request.requesterName}'s correction.`,
    };
    const reconciled: CorrectionReviewRequest =
      decision === "adjust"
        ? {
            ...request,
            requestedAt: requestedAt ?? request.requestedAt,
            breakStartedAt: breakStartedAt ?? request.breakStartedAt,
            breakEndedAt:
              breakEndedAt !== undefined ? breakEndedAt : request.breakEndedAt,
          }
        : request;
    scheduleDecision(
      "correction",
      request.id,
      label[decision],
      send,
      CORRECTION_SUCCESS[decision],
      () => setCompletedCorrections((current) => [...current, reconciled]),
    );
  }

  function decidePastShift(
    event: FormEvent<HTMLFormElement>,
    request: PastShiftReviewRequest,
  ) {
    event.preventDefault();
    if (busy) return;
    const decision = submittedValue(event);
    if (decision !== "approve" && decision !== "reject") return;

    const form = event.currentTarget;
    const note = noteFieldOf(form);
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    if (decision === "reject" && !reason) {
      note?.setAttribute("aria-invalid", "true");
      note?.focus();
      setNotice({
        tone: "error",
        text: "Add a reviewer note to reject a past shift.",
      });
      return;
    }
    note?.removeAttribute("aria-invalid");

    const approved = decision === "approve";
    scheduleDecision(
      "pastShift",
      request.id,
      approved
        ? `Approving ${request.requesterName}'s past shift.`
        : `Rejecting ${request.requesterName}'s past shift.`,
      () =>
        sendPatch(
          decision,
          "/api/manual-shifts",
          {
            requestId: request.id,
            outletId: request.outletId,
            decision,
            reason,
          },
          "Could not record this decision.",
        ),
      approved
        ? "Past shift approved and added to history."
        : "Past shift rejected.",
      () => setCompletedPastShifts((current) => [...current, request]),
    );
  }

  function decideDevice(
    request: DeviceReviewRequest,
    action: "approve" | "reject",
  ) {
    if (busy) return;
    const approved = action === "approve";
    scheduleDecision(
      "device",
      request.id,
      approved
        ? `Approving ${request.employeeName}'s device.`
        : `Rejecting ${request.employeeName}'s device.`,
      () =>
        sendPatch(
          action,
          `/api/staff-devices/${request.id}`,
          { action },
          "Could not update trusted device.",
        ),
      approved
        ? "Device approved. Any previous device for this staff member is now revoked."
        : "Device request rejected.",
      () => setCompletedDevices((current) => [...current, request]),
    );
  }

  return (
    <div className="team-page-content timesheet-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">BACKOFFICE REVIEW</p>
          <h1>Review requests</h1>
          <p className="subheading">
            Review clock corrections, past shift requests, and staff device
            enrollments.
          </p>
        </div>
      </div>

      <div className="review-toolbar">
        <label className="team-outlet-filter">
          <span>Outlet</span>
          <select
            value={outletId}
            onChange={(event) => handleOutletChange(event.target.value)}
          >
            <option value="">All managed outlets</option>
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
        </label>
        <div className="review-toolbar-actions">
          <span className="review-awaiting">
            {openTotal === 0 ? "All caught up" : `${openTotal} awaiting review`}
          </span>
          {updatedAt !== null && (
            <span className="review-updated">
              Updated {formatClock(updatedAt)}
            </span>
          )}
          <button
            className="btn btn-secondary btn-icon"
            type="button"
            aria-label="Refresh requests"
            title="Refresh requests"
            disabled={isLoading}
            onClick={() => {
              setIsLoading(true);
              void load(outletId);
            }}
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      {queued.map(([key, row]) => (
        <div key={key} className="correction-review-undo" role="status">
          <span>{row.label}</span>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => undoDecision(key)}
          >
            Undo
          </button>
        </div>
      ))}

      {!dialogOpen && notice && <ReviewNotice notice={notice} />}

      {allCaughtUp ? (
        <p className="correction-review-caught-up" role="status">
          <strong>All caught up</strong>
          No clock corrections, past shifts, or device enrollments need review.
        </p>
      ) : (
        <>
          <div className="correction-review-tabs">
            {TABS.map(({ kind, label }) => (
              <button
                key={kind}
                className="correction-review-tab"
                type="button"
                aria-pressed={tab === kind}
                onClick={() => setTab(kind)}
              >
                <span>{label}</span>
                <span className="correction-review-tab-count">
                  {queueCounts[kind] ?? "—"}
                </span>
              </button>
            ))}
          </div>

          {tab === "correction" && (
            <ReviewQueue
              label="Clock corrections"
              queue={correctionRows}
              stateOf={(item) =>
                rowStateOf("correction", item.id, completedCorrections)
              }
              now={now}
              loadingText="Loading clock corrections…"
              emptyText="No clock corrections need review."
              onSelect={(id) => openItem("correction", id)}
              describe={(request) => {
                const scheduled = request.scheduleSnapshot
                  ? formatReviewRange(
                      request.scheduleSnapshot.scheduledStartAt,
                      request.scheduleSnapshot.scheduledEndAt,
                      request.timezone,
                    )
                  : request.scheduleStatus === "no-match"
                    ? "Published schedule exists; no close match"
                    : "No schedule published for this date";
                const before =
                  request.event === "clock_in"
                    ? request.previousPunch?.clockInAt
                      ? formatReviewDateTime(
                          request.previousPunch.clockInAt,
                          request.timezone,
                        )
                      : "Not recorded"
                    : request.event === "clock_out"
                      ? request.previousPunch?.clockOutAt
                        ? formatReviewDateTime(
                            request.previousPunch.clockOutAt,
                            request.timezone,
                          )
                        : "Not recorded"
                      : request.previousBreak
                        ? `${formatReviewDateTime(request.previousBreak.startedAt, request.timezone)} – ${request.previousBreak.endedAt ? formatReviewDateTime(request.previousBreak.endedAt, request.timezone) : "Open"}`
                        : "Not recorded";
                const requested =
                  request.event === "clock_in" || request.event === "clock_out"
                    ? formatReviewDateTime(
                        request.requestedAt,
                        request.timezone,
                      )
                    : request.breakStartedAt
                      ? `${formatReviewDateTime(request.breakStartedAt, request.timezone)}${request.breakEndedAt ? ` – ${formatReviewDateTime(request.breakEndedAt, request.timezone)}` : " – Open"}`
                      : "Change requested";
                return {
                  eyebrow: `${request.outletName} · ${CORRECTION_EVENT_LABELS[request.event]}`,
                  title: request.requesterName,
                  detail: formatReviewDateTime(
                    request.requestedAt,
                    request.timezone,
                  ),
                  change:
                    request.event === "clock_in"
                      ? `Clock in ${before === "Not recorded" ? "was not recorded" : `was ${before}`} → ${formatReviewTime(request.requestedAt, request.timezone)}`
                      : request.event === "clock_out"
                        ? `Clock out ${before === "Not recorded" ? "was not recorded" : `was ${before}`} → ${formatReviewTime(request.requestedAt, request.timezone)}`
                        : `${before} → ${requested}`,
                  schedule: request.scheduleSnapshot
                    ? request.event === "clock_in"
                      ? `Scheduled clock in ${formatReviewDate(request.scheduleSnapshot.scheduledStartAt, request.timezone)}, ${formatReviewTime(request.scheduleSnapshot.scheduledStartAt, request.timezone)}`
                      : request.event === "clock_out"
                        ? `Scheduled clock out ${formatReviewDate(request.scheduleSnapshot.scheduledEndAt, request.timezone)}, ${formatReviewTime(request.scheduleSnapshot.scheduledEndAt, request.timezone)}`
                        : scheduled
                    : request.scheduleStatus === "no-match"
                      ? "Published schedule exists; no close match"
                      : "No schedule published for this date",
                  createdAt: request.createdAt,
                };
              }}
            />
          )}

          {tab === "pastShift" && (
            <ReviewQueue
              label="Past shifts"
              queue={pastShiftRows}
              stateOf={(item) =>
                rowStateOf("pastShift", item.id, completedPastShifts)
              }
              now={now}
              loadingText="Loading past shift requests…"
              emptyText="No past shift requests need review."
              onSelect={(id) => openItem("pastShift", id)}
              describe={(request) => ({
                eyebrow: `${request.outletName} · Past shift`,
                title: request.requesterName,
                detail: formatReviewRange(
                  request.clockInAt,
                  request.clockOutAt,
                  request.timezone,
                ),
                change: `Past shift: ${formatReviewRange(request.clockInAt, request.clockOutAt, request.timezone)}`,
                schedule: request.scheduleSnapshot
                  ? `Scheduled ${formatReviewRange(request.scheduleSnapshot.scheduledStartAt, request.scheduleSnapshot.scheduledEndAt, request.timezone)}`
                  : "No schedule published for this date",
                createdAt: request.createdAt,
              })}
            />
          )}

          {tab === "device" && (
            <ReviewQueue
              label="Device enrollments"
              queue={deviceRows}
              stateOf={(item) =>
                rowStateOf("device", item.id, completedDevices)
              }
              now={now}
              loadingText="Loading device enrollments…"
              emptyText="No pending device enrollments."
              onSelect={(id) => openItem("device", id)}
              describe={(request) => ({
                eyebrow: `Trusted device · ${request.outletNames.join(", ") || "No outlet"}`,
                title: request.employeeName,
                detail: `Requested ${formatReviewDateTime(request.createdAt)}`,
                change: `${request.employeeName} requested device enrollment`,
                schedule: request.outletNames.length
                  ? `Outlets: ${request.outletNames.join(", ")}`
                  : "No outlet assigned",
                createdAt: request.createdAt,
              })}
            />
          )}
        </>
      )}

      <ReviewDialog
        titleId="correction-review-title"
        onClose={closeDialog}
        header={
          selectedCorrection
            ? {
                eyebrow: `${selectedCorrection.outletName} · ${CORRECTION_EVENT_LABELS[selectedCorrection.event]}`,
                title: `${CORRECTION_EVENT_LABELS[selectedCorrection.event]} correction`,
                subtitle: `${selectedCorrection.requesterName} · ${selectedCorrection.requesterEmail}`,
              }
            : null
        }
        summary={
          selectedCorrection && (
            <>
              <div className="correction-review-summary-grid">
                <div>
                  <span>Before</span>
                  <strong>
                    {selectedCorrection.previousPunch
                      ? selectedCorrection.event === "clock_in"
                        ? `${formatReviewDate(selectedCorrection.previousPunch.clockInAt ?? selectedCorrection.requestedAt, selectedCorrection.timezone)}, ${formatReviewTime(selectedCorrection.previousPunch.clockInAt ?? selectedCorrection.requestedAt, selectedCorrection.timezone)}`
                        : formatReviewDateTime(
                            selectedCorrection.previousPunch.clockOutAt ??
                              selectedCorrection.requestedAt,
                            selectedCorrection.timezone,
                          )
                      : selectedCorrection.previousBreak
                        ? `${formatReviewDateTime(selectedCorrection.previousBreak.startedAt, selectedCorrection.timezone)}${selectedCorrection.previousBreak.endedAt ? ` – ${formatReviewDateTime(selectedCorrection.previousBreak.endedAt, selectedCorrection.timezone)}` : " – Open"}`
                        : "Not recorded"}
                  </strong>
                </div>
                <div>
                  <span>Requested</span>
                  <strong>
                    {selectedCorrection.event === "clock_in" ||
                    selectedCorrection.event === "clock_out"
                      ? formatReviewDateTime(
                          selectedCorrection.requestedAt,
                          selectedCorrection.timezone,
                        )
                      : selectedCorrection.breakStartedAt
                        ? `${formatReviewDateTime(selectedCorrection.breakStartedAt, selectedCorrection.timezone)}${selectedCorrection.breakEndedAt ? ` – ${formatReviewDateTime(selectedCorrection.breakEndedAt, selectedCorrection.timezone)}` : " – Open"}`
                        : "Change requested"}
                  </strong>
                  {!adjusting &&
                    selectedCorrection.event !== "break_delete" && (
                      <button
                        className="btn btn-secondary btn-sm correction-adjust-trigger"
                        type="button"
                        disabled={busy !== ""}
                        onClick={() => setAdjusting(true)}
                      >
                        Adjust time
                      </button>
                    )}
                </div>
                <div>
                  <span>Published schedule</span>
                  <strong>
                    {selectedCorrection.scheduleSnapshot
                      ? formatReviewRange(
                          selectedCorrection.scheduleSnapshot.scheduledStartAt,
                          selectedCorrection.scheduleSnapshot.scheduledEndAt,
                          selectedCorrection.timezone,
                        )
                      : selectedCorrection.scheduleStatus === "no-match"
                        ? "Published schedule exists; no close match"
                        : "No schedule published for this date"}
                  </strong>
                  {selectedCorrection.scheduleSnapshot && (
                    <p>{correctionScheduleComparison(selectedCorrection)}</p>
                  )}
                </div>
              </div>
            </>
          )
        }
      >
        {selectedCorrection && (
          <DecisionForm
            onSubmit={(event) =>
              void decideCorrection(event, selectedCorrection)
            }
          >
            {adjusting && (
              <div className="correction-adjust-panel">
                {isBreakCorrectionEvent(selectedCorrection.event) ? (
                  selectedCorrection.event !== "break_delete" && (
                    <>
                      <label>
                        Adjust break start
                        <input
                          name="breakStartedAt"
                          type="datetime-local"
                          required
                          defaultValue={formatOutletDateTime(
                            selectedCorrection.breakStartedAt ??
                              selectedCorrection.requestedAt,
                            selectedCorrection.timezone,
                          )}
                        />
                      </label>
                      {selectedCorrection.breakEndedAt && (
                        <label>
                          Adjust break end
                          <input
                            name="breakEndedAt"
                            type="datetime-local"
                            required
                            defaultValue={formatOutletDateTime(
                              selectedCorrection.breakEndedAt,
                              selectedCorrection.timezone,
                            )}
                          />
                        </label>
                      )}
                    </>
                  )
                ) : (
                  <label>
                    Adjust punch time
                    <input
                      name="requestedAt"
                      type="datetime-local"
                      required
                      defaultValue={formatOutletDateTime(
                        selectedCorrection.requestedAt,
                        selectedCorrection.timezone,
                      )}
                    />
                  </label>
                )}
                <div className="correction-adjust-actions">
                  {selectedCorrection.scheduleSnapshot &&
                    (selectedCorrection.event === "clock_in" ||
                      selectedCorrection.event === "clock_out") && (
                      <button
                        className="btn btn-ghost btn-sm correction-use-schedule"
                        type="button"
                        onClick={(event) => {
                          const input =
                            event.currentTarget.form?.elements.namedItem(
                              "requestedAt",
                            );
                          const schedule = selectedCorrection.scheduleSnapshot!;
                          if (input instanceof HTMLInputElement) {
                            input.value = formatOutletDateTime(
                              selectedCorrection.event === "clock_in"
                                ? schedule.scheduledStartAt
                                : schedule.scheduledEndAt,
                              selectedCorrection.timezone,
                            );
                          }
                        }}
                      >
                        Use scheduled{" "}
                        {selectedCorrection.event === "clock_in"
                          ? "start"
                          : "end"}
                      </button>
                    )}
                  <div className="correction-adjust-buttons">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => setAdjusting(false)}
                    >
                      Cancel adjust
                    </button>
                    <DecisionButton
                      variant="approve"
                      action="adjust"
                      busy={busy}
                    >
                      Save adjustment
                    </DecisionButton>
                  </div>
                </div>
              </div>
            )}
            <div className="correction-review-reason">
              <span>Staff reasoning</span>
              <p>{selectedCorrection.reason}</p>
            </div>
            <label>
              <span>Reviewer note</span>
              <textarea
                name="reason"
                maxLength={500}
                rows={2}
                aria-describedby="correction-note-hint"
                placeholder="Context for the record."
              />
            </label>
            {dialogNotice}
            <div className="correction-note-row">
              <p id="correction-note-hint" className="correction-field-hint">
                {adjusting
                  ? "Optional for adjustments."
                  : "Required to reject or save a note."}
              </p>
              {!adjusting && (
                <DecisionButton
                  variant="note"
                  action="save_note"
                  busy={busy}
                  formNoValidate
                >
                  Save note
                </DecisionButton>
              )}
            </div>
            {!adjusting && (
              <div className="dialog-actions correction-decision-actions">
                <DecisionButton
                  variant="reject"
                  action="reject"
                  busy={busy}
                  formNoValidate
                >
                  Reject
                </DecisionButton>
                <DecisionButton variant="approve" action="confirm" busy={busy}>
                  Confirm
                </DecisionButton>
              </div>
            )}
          </DecisionForm>
        )}
      </ReviewDialog>

      <ReviewDialog
        titleId="past-shift-review-title"
        onClose={closeDialog}
        notice={dialogNotice}
        header={
          selectedPastShift
            ? {
                eyebrow: `${selectedPastShift.outletName} · Past shift`,
                title: selectedPastShift.requesterName,
                subtitle: selectedPastShift.requesterUsername,
              }
            : null
        }
        summary={
          selectedPastShift && (
            <>
              <strong className="correction-requested-time">
                {formatReviewRange(
                  selectedPastShift.clockInAt,
                  selectedPastShift.clockOutAt,
                  selectedPastShift.timezone,
                )}
              </strong>
              <p className="correction-request-reason">
                {selectedPastShift.reason}
              </p>
              <div className="correction-schedule-context">
                {selectedPastShift.scheduleSnapshot ? (
                  <>
                    <span>Published schedule</span>
                    <strong>
                      {formatReviewRange(
                        selectedPastShift.scheduleSnapshot.scheduledStartAt,
                        selectedPastShift.scheduleSnapshot.scheduledEndAt,
                        selectedPastShift.timezone,
                      )}
                    </strong>
                    <small>
                      {selectedPastShift.scheduleSnapshot.templateName ??
                        "Custom shift"}
                      {` · ${selectedPastShift.scheduleSnapshot.breakMinutes}m break`}
                    </small>
                    <p>
                      Requested start is{" "}
                      {formatMinuteVariance(
                        Math.round(
                          (Date.parse(selectedPastShift.clockInAt) -
                            Date.parse(
                              selectedPastShift.scheduleSnapshot
                                .scheduledStartAt,
                            )) /
                            60_000,
                        ),
                      )}
                      ; requested end is{" "}
                      {formatMinuteVariance(
                        Math.round(
                          (Date.parse(selectedPastShift.clockOutAt) -
                            Date.parse(
                              selectedPastShift.scheduleSnapshot.scheduledEndAt,
                            )) /
                            60_000,
                        ),
                      )}
                      .
                    </p>
                  </>
                ) : (
                  <p>
                    No matching published schedule was found for this past
                    shift.
                  </p>
                )}
              </div>
            </>
          )
        }
      >
        {selectedPastShift && (
          <DecisionForm
            onSubmit={(event) => decidePastShift(event, selectedPastShift)}
          >
            <label>
              <span>Reviewer note</span>
              <textarea
                name="reason"
                maxLength={500}
                rows={2}
                aria-describedby="past-shift-note-hint"
                placeholder="Explain the decision."
              />
            </label>
            <p id="past-shift-note-hint" className="correction-field-hint">
              Required to reject. Optional when approving.
            </p>
            <div className="dialog-actions correction-decision-actions">
              <DecisionButton
                variant="reject"
                action="reject"
                busy={busy}
                formNoValidate
              >
                Reject
              </DecisionButton>
              <DecisionButton variant="approve" action="approve" busy={busy}>
                Approve
              </DecisionButton>
            </div>
          </DecisionForm>
        )}
      </ReviewDialog>

      <ReviewDialog
        titleId="device-review-title"
        onClose={closeDialog}
        notice={dialogNotice}
        header={
          selectedDevice
            ? {
                eyebrow: `Trusted device · ${selectedDevice.outletNames.join(", ") || "No outlet"}`,
                title: selectedDevice.employeeName,
                subtitle: selectedDevice.employeeEmail,
              }
            : null
        }
        summary={
          selectedDevice && (
            <>
              <strong className="correction-requested-time">
                Requested {formatReviewDateTime(selectedDevice.createdAt)}
              </strong>
              <p className="dialog-description">
                Approving this device revokes any device this staff member
                already uses.
              </p>
            </>
          )
        }
      >
        {selectedDevice && (
          <div className="dialog-actions correction-decision-actions">
            <button
              className="btn btn-danger"
              type="button"
              disabled={busy !== ""}
              onClick={() => decideDevice(selectedDevice, "reject")}
            >
              Reject
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy !== ""}
              onClick={() => decideDevice(selectedDevice, "approve")}
            >
              Approve
            </button>
          </div>
        )}
      </ReviewDialog>
    </div>
  );
}
