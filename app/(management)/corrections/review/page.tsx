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
  formatReviewDateTime,
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
import { ReviewQueue } from "./_components/review-queue";

type ReviewKind = "correction" | "pastShift" | "device";
type Selection = { kind: ReviewKind; id: string } | null;
type CorrectionDecision = "confirm" | "adjust" | "reject" | "save_note";
type PendingDecision = { key: string; label: string };
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

function pendingKey(kind: ReviewKind, id: string) {
  return `${kind}:${id}`;
}

function formatClock(value: number) {
  return new Date(value).toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [pending, setPending] = useState<PendingDecision[]>([]);
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

  useEffect(() => {
    if (pending.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending.length]);

  useEffect(() => {
    if (notice?.tone !== "success") return;
    const id = window.setTimeout(
      () => setNotice((current) => (current === notice ? null : current)),
      SUCCESS_MS,
    );
    return () => window.clearTimeout(id);
  }, [notice]);

  const pendingKeys = new Set(pending.map((item) => item.key));
  const isVisible = (kind: ReviewKind, id: string) =>
    !pendingKeys.has(pendingKey(kind, id));

  const correctionQueue: ReviewList<CorrectionReviewRequest> = {
    items:
      lists.correction.items === null
        ? null
        : sortOldestFirst(
            lists.correction.items.filter(
              (request) =>
                request.status === "reconciliation" &&
                isVisible("correction", request.id),
            ),
          ),
    error: lists.correction.error,
  };
  const pastShiftQueue: ReviewList<PastShiftReviewRequest> = {
    items:
      lists.pastShift.items === null
        ? null
        : sortOldestFirst(
            lists.pastShift.items.filter((request) =>
              isVisible("pastShift", request.id),
            ),
          ),
    error: lists.pastShift.error,
  };
  const deviceQueue: ReviewList<DeviceReviewRequest> = {
    items:
      lists.device.items === null
        ? null
        : sortOldestFirst(
            lists.device.items.filter((request) =>
              isVisible("device", request.id),
            ),
          ),
    error: lists.device.error,
  };

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
  const allCaughtUp = allLoaded && openTotal === 0 && pending.length === 0;

  const dialogNotice = notice ? <ReviewNotice notice={notice} /> : null;

  function handleOutletChange(nextOutletId: string) {
    setOutletId(nextOutletId);
    setLists(EMPTY_LISTS);
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

  /**
   * Hides the request and sends the decision after UNDO_MS unless undone.
   * The request leaves the list only after the server accepts it.
   */
  function scheduleDecision(
    kind: ReviewKind,
    id: string,
    label: string,
    send: () => Promise<boolean>,
    successText: string,
  ) {
    const key = pendingKey(kind, id);
    if (commits.current.has(key)) return;

    const run = async () => {
      commits.current.delete(key);
      setPending((current) => current.filter((item) => item.key !== key));
      if (await send()) {
        removeRequest(kind, id);
        setNotice({ tone: "success", text: successText });
      }
    };
    const timer = window.setTimeout(() => void run(), UNDO_MS);
    commits.current.set(key, { timer, run });
    setPending((current) => [...current, { key, label }]);
    setSelection(null);
    setAdjusting(false);
    setNotice(null);
  }

  function undoDecision(key: string) {
    const entry = commits.current.get(key);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    commits.current.delete(key);
    setPending((current) => current.filter((item) => item.key !== key));
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
    scheduleDecision(
      "correction",
      request.id,
      label[decision],
      send,
      CORRECTION_SUCCESS[decision],
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

      {pending.map((item) => (
        <div key={item.key} className="correction-review-undo" role="status">
          <span>{item.label}</span>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => undoDecision(item.key)}
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
              queue={correctionQueue}
              now={now}
              loadingText="Loading clock corrections…"
              emptyText="No clock corrections need review."
              onSelect={(id) => openItem("correction", id)}
              describe={(request) => ({
                eyebrow: `${request.outletName} · ${CORRECTION_EVENT_LABELS[request.event]}`,
                title: request.requesterName,
                detail: formatReviewDateTime(
                  request.requestedAt,
                  request.timezone,
                ),
                createdAt: request.createdAt,
              })}
            />
          )}

          {tab === "pastShift" && (
            <ReviewQueue
              label="Past shifts"
              queue={pastShiftQueue}
              now={now}
              loadingText="Loading past shift requests…"
              emptyText="No past shift requests need review."
              onSelect={(id) => openItem("pastShift", id)}
              describe={(request) => ({
                eyebrow: `${request.outletName} · Past shift`,
                title: request.requesterName,
                detail: `${formatReviewDateTime(request.clockInAt, request.timezone)} – ${formatReviewDateTime(request.clockOutAt, request.timezone)}`,
                createdAt: request.createdAt,
              })}
            />
          )}

          {tab === "device" && (
            <ReviewQueue
              label="Device enrollments"
              queue={deviceQueue}
              now={now}
              loadingText="Loading device enrollments…"
              emptyText="No pending device enrollments."
              onSelect={(id) => openItem("device", id)}
              describe={(request) => ({
                eyebrow: `Trusted device · ${request.outletNames.join(", ") || "No outlet"}`,
                title: request.employeeName,
                detail: `Requested ${formatReviewDateTime(request.createdAt)}`,
                createdAt: request.createdAt,
              })}
            />
          )}
        </>
      )}

      <ReviewDialog
        titleId="correction-review-title"
        onClose={closeDialog}
        notice={dialogNotice}
        header={
          selectedCorrection
            ? {
                eyebrow: `${selectedCorrection.outletName} · ${CORRECTION_EVENT_LABELS[selectedCorrection.event]}`,
                title: selectedCorrection.requesterName,
                subtitle: selectedCorrection.requesterEmail,
              }
            : null
        }
        summary={
          selectedCorrection && (
            <>
              <strong className="correction-requested-time">
                {formatReviewDateTime(
                  selectedCorrection.requestedAt,
                  selectedCorrection.timezone,
                )}
              </strong>
              <p className="correction-request-reason">
                {selectedCorrection.reason}
              </p>
              <small>
                {selectedCorrection.appliedAt
                  ? `Took effect ${formatReviewDateTime(selectedCorrection.appliedAt, selectedCorrection.timezone)}`
                  : "Takes effect immediately"}
              </small>
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
            <p id="correction-note-hint" className="correction-field-hint">
              Required to reject or save a note.
            </p>
            {adjusting &&
              (isBreakCorrectionEvent(selectedCorrection.event) ? (
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
              ))}
            <div className="dialog-actions correction-decision-actions">
              {adjusting ? (
                <>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setAdjusting(false)}
                  >
                    Cancel adjust
                  </button>
                  <DecisionButton variant="approve" action="adjust" busy={busy}>
                    Save adjustment
                  </DecisionButton>
                </>
              ) : (
                <>
                  <DecisionButton
                    variant="reject"
                    action="reject"
                    busy={busy}
                    formNoValidate
                  >
                    Reject
                  </DecisionButton>
                  <DecisionButton
                    variant="note"
                    action="save_note"
                    busy={busy}
                    formNoValidate
                  >
                    Save note
                  </DecisionButton>
                  {selectedCorrection.event !== "break_delete" && (
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={busy !== ""}
                      onClick={() => setAdjusting(true)}
                    >
                      Adjust time
                    </button>
                  )}
                  <DecisionButton
                    variant="approve"
                    action="confirm"
                    busy={busy}
                  >
                    Confirm
                  </DecisionButton>
                </>
              )}
            </div>
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
                {formatReviewDateTime(
                  selectedPastShift.clockInAt,
                  selectedPastShift.timezone,
                )}{" "}
                –{" "}
                {formatReviewDateTime(
                  selectedPastShift.clockOutAt,
                  selectedPastShift.timezone,
                )}
              </strong>
              <p className="correction-request-reason">
                {selectedPastShift.reason}
              </p>
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
