"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { CloseIcon, RefreshIcon } from "@/app/_components/icons";
import { ModalDialog } from "@/app/_components/modal-dialog";
import { REVIEW_REQUESTS_CHANGED_EVENT } from "@/app/_components/workspace-shell";
import {
  isBreakCorrectionEvent,
  type CorrectionEvent,
} from "@/lib/break-corrections";
import {
  formatOutletDateTime,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import { useEffect, useState, type FormEvent } from "react";

type ReviewRequest = {
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

type DeviceRequest = {
  id: string;
  userId: string;
  employeeName: string;
  employeeEmail: string;
  createdAt: string;
  outletNames: string[];
};

type ReviewData = {
  corrections: ReviewList<ReviewRequest>;
  devices: ReviewList<DeviceRequest>;
};

type ReviewList<T> = {
  items: T[] | null;
  error: string | null;
};

type OutletOption = {
  id: string;
  name: string;
};

type CorrectionDecision = "confirm" | "adjust" | "reject" | "save_note";

const CORRECTION_DECISIONS: readonly string[] = [
  "confirm",
  "adjust",
  "reject",
  "save_note",
];

const DECISION_CONFIRM = {
  confirm: {
    title: "Confirm this punch?",
    description: "The punch will be reconciled as recorded.",
    confirmLabel: "Confirm punch",
  },
  adjust: {
    title: "Save adjusted punch?",
    description: "The punch time will be changed and the request reconciled.",
    confirmLabel: "Save adjustment",
  },
  reject: {
    title: "Reject this correction?",
    description:
      "The punch or break will return to its previous time and the request will be marked rejected.",
    confirmLabel: "Reject correction",
  },
} as const;

const DECISION_SUCCESS: Record<CorrectionDecision, string> = {
  confirm: "Punch reconciled.",
  adjust: "Punch adjusted and reconciled.",
  reject: "Correction rejected and the previous time restored.",
  save_note: "Note saved. This correction stays in the list.",
};

function isCorrectionDecision(value: string): value is CorrectionDecision {
  return CORRECTION_DECISIONS.includes(value);
}

async function loadReviewList<T>(
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
    return { items: body.requests ?? [], error: null };
  } catch (error) {
    return {
      items: null,
      error: error instanceof Error ? error.message : fallbackError,
    };
  }
}

async function loadReviewRequests(outletId?: string): Promise<ReviewData> {
  const query = new URLSearchParams({ view: "review" });
  if (outletId) query.set("outletId", outletId);
  const [corrections, devices] = await Promise.all([
    loadReviewList<ReviewRequest>(
      `/api/corrections?${query}`,
      "Could not load correction requests.",
    ),
    loadReviewList<DeviceRequest>(
      `/api/staff-devices?${query}`,
      "Could not load device requests.",
    ),
  ]);
  return { corrections, devices };
}

function formatRequestedTime(value: string, timezone: string) {
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

function formatDeviceRequestTime(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function CorrectionReviewPage() {
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const outletId = selectedOutletId || undefined;
  const [requests, setRequests] = useState<ReviewRequest[] | null>(null);
  const [deviceRequests, setDeviceRequests] = useState<DeviceRequest[] | null>(
    null,
  );
  const [correctionError, setCorrectionError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [selectedCorrectionId, setSelectedCorrectionId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const requestList = requests ?? [];
  const deviceRequestList = deviceRequests ?? [];
  const reconciliationRequests = requestList.filter(
    (request) => request.status === "reconciliation",
  );
  const selectedCorrection =
    reconciliationRequests.find(
      (request) => request.id === selectedCorrectionId,
    ) ?? null;
  const selectedDevice =
    deviceRequestList.find((request) => request.id === selectedDeviceId) ??
    null;
  const messageNode = message ? (
    <p className="team-message" role="status">
      {message}
    </p>
  ) : null;

  async function refresh() {
    setIsLoading(true);
    try {
      const loaded = await loadReviewRequests(outletId);
      if (loaded.corrections.items) setRequests(loaded.corrections.items);
      if (loaded.devices.items) setDeviceRequests(loaded.devices.items);
      setCorrectionError(loaded.corrections.error ?? "");
      setDeviceError(loaded.devices.error ?? "");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setIsLoading(false);
    }
  }

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
    let active = true;
    loadReviewRequests(outletId)
      .then((loaded) => {
        if (!active) return;
        setRequests(loaded.corrections.items);
        setDeviceRequests(loaded.devices.items);
        setCorrectionError(loaded.corrections.error ?? "");
        setDeviceError(loaded.devices.error ?? "");
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load correction requests.",
          );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [outletId]);

  const { confirm, confirmDialog } = useConfirmDialog();

  async function decide(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    if (busyId) return;
    const formData = new FormData(event.currentTarget);
    const reason = String(formData.get("reason") ?? "");
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const decision =
      submitter instanceof HTMLButtonElement ? submitter.value : "";
    if (!isCorrectionDecision(decision)) return;
    if ((decision === "reject" || decision === "save_note") && !reason.trim()) {
      setMessage("Add a reviewer note to reject or save a note.");
      return;
    }

    const target = requestList.find((request) => request.id === requestId);
    const timezone = target?.timezone ?? "UTC";
    const isBreak = target ? isBreakCorrectionEvent(target.event) : false;
    let requestedAt: string | undefined;
    let breakStartedAt: string | undefined;
    let breakEndedAt: string | null | undefined;
    if (decision === "adjust") {
      try {
        if (isBreak) {
          const localStart = String(formData.get("breakStartedAt") ?? "");
          const localEnd = String(formData.get("breakEndedAt") ?? "");
          breakStartedAt = outletDateTimeToISOString(localStart, timezone);
          breakEndedAt = localEnd
            ? outletDateTimeToISOString(localEnd, timezone)
            : null;
        } else {
          const localTime = String(formData.get("requestedAt") ?? "");
          requestedAt = outletDateTimeToISOString(localTime, timezone);
        }
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Enter a valid punch time.",
        );
        return;
      }
    }

    if (
      decision !== "save_note" &&
      !(await confirm(DECISION_CONFIRM[decision]))
    )
      return;

    const busyKey = `correction:${requestId}`;
    setBusyId(busyKey);
    setMessage("");
    try {
      const response = await fetch("/api/corrections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          outletId: requestList.find((request) => request.id === requestId)
            ?.outletId,
          decision,
          reason,
          requestedAt,
          breakStartedAt,
          breakEndedAt,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not record this decision.");
      setMessage(DECISION_SUCCESS[decision]);
      setSelectedCorrectionId("");
      if (decision !== "save_note") {
        window.dispatchEvent(new Event(REVIEW_REQUESTS_CHANGED_EVENT));
        setRequests(
          (current) =>
            current?.filter((request) => request.id !== requestId) ?? null,
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not record this decision.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function decideDevice(requestId: string, action: "approve" | "reject") {
    if (busyId) return;
    if (
      !(await confirm({
        title:
          action === "approve" ? "Approve this device?" : "Reject this device?",
        description:
          action === "approve"
            ? "Any previous device for this staff member will be revoked."
            : "The staff member will need to request enrollment again.",
        confirmLabel: action === "approve" ? "Approve device" : "Reject device",
        tone: action === "reject" ? "danger" : "default",
      }))
    )
      return;
    const busyKey = `device:${requestId}`;
    setBusyId(busyKey);
    setMessage("");
    try {
      const response = await fetch(`/api/staff-devices/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not update trusted device.");
      setDeviceRequests(
        (current) =>
          current?.filter((request) => request.id !== requestId) ?? null,
      );
      setSelectedDeviceId("");
      window.dispatchEvent(new Event(REVIEW_REQUESTS_CHANGED_EVENT));
      setMessage(
        action === "approve"
          ? "Device approved. Any previous device for this staff member is now revoked."
          : "Device request rejected.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update trusted device.",
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="team-page-content timesheet-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">BACKOFFICE REVIEW</p>
          <h1>Review requests</h1>
          <p className="subheading">
            Review clock corrections and staff device enrollments.
          </p>
        </div>
        <label className="team-outlet-filter">
          <span>Outlet</span>
          <select
            value={selectedOutletId}
            onChange={(event) => setSelectedOutletId(event.target.value)}
          >
            <option value="">All managed outlets</option>
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-secondary btn-icon"
          type="button"
          aria-label="Refresh requests"
          title="Refresh requests"
          disabled={isLoading}
          onClick={() => void refresh()}
        >
          <RefreshIcon />
        </button>
      </div>

      {!selectedCorrection && !selectedDevice && messageNode}
      <section
        className="correction-review-list"
        aria-label="Applied punches awaiting reconciliation"
      >
        <header className="correction-review-section-heading">
          <h2>Needs reconciliation</h2>
          <span>{requests === null ? "—" : reconciliationRequests.length}</span>
        </header>
        {correctionError && (
          <p className="team-message" role="alert">
            {correctionError}
            {requests !== null && " Showing previously loaded requests."}
          </p>
        )}
        {isLoading && requests === null && (
          <p className="correction-review-empty">Loading clock corrections…</p>
        )}
        {reconciliationRequests.length > 0 && (
          <ul className="correction-review-rows">
            {reconciliationRequests.map((request) => (
              <li key={request.id}>
                <button
                  className="correction-review-row"
                  type="button"
                  onClick={() => {
                    setMessage("");
                    setSelectedCorrectionId(request.id);
                  }}
                >
                  <span className="correction-review-row-main">
                    <span className="eyebrow">
                      {request.outletName} · {request.event.replace("_", " ")}
                    </span>
                    <strong>{request.requesterName}</strong>
                    <small>
                      {formatRequestedTime(
                        request.requestedAt,
                        request.timezone,
                      )}
                    </small>
                  </span>
                  <span className="correction-review-row-action">Review</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {requests !== null &&
          !correctionError &&
          reconciliationRequests.length === 0 && (
            <p className="correction-review-empty">
              No clock corrections need review.
            </p>
          )}
      </section>
      <section
        className="correction-review-list"
        aria-label="Device enrollments"
      >
        <header className="correction-review-section-heading">
          <h2>Device enrollments</h2>
          <span>
            {deviceRequests === null ? "—" : deviceRequestList.length}
          </span>
        </header>
        {deviceError && (
          <p className="team-message" role="alert">
            {deviceError}
            {deviceRequests !== null && " Showing previously loaded requests."}
          </p>
        )}
        {isLoading && deviceRequests === null && (
          <p className="correction-review-empty">Loading device enrollments…</p>
        )}
        {deviceRequestList.length > 0 && (
          <ul className="correction-review-rows">
            {deviceRequestList.map((request) => (
              <li key={request.id}>
                <button
                  className="correction-review-row"
                  type="button"
                  onClick={() => {
                    setMessage("");
                    setSelectedDeviceId(request.id);
                  }}
                >
                  <span className="correction-review-row-main">
                    <span className="eyebrow">
                      TRUSTED DEVICE · {request.outletNames.join(", ")}
                    </span>
                    <strong>{request.employeeName}</strong>
                    <small>
                      Requested {formatDeviceRequestTime(request.createdAt)}
                    </small>
                  </span>
                  <span className="correction-review-row-action">Review</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {deviceRequests !== null &&
          !deviceError &&
          deviceRequestList.length === 0 && (
            <p className="correction-review-empty">
              No pending device enrollments.
            </p>
          )}
      </section>

      <ModalDialog
        open={Boolean(selectedCorrection)}
        onOpenChange={(open) => {
          if (!open) setSelectedCorrectionId("");
        }}
        labelledBy="correction-review-title"
      >
        {selectedCorrection && (
          <div className="dialog-panel">
            <header className="dialog-header">
              <div>
                <p className="eyebrow">
                  {selectedCorrection.outletName} ·{" "}
                  {selectedCorrection.event.replace("_", " ")}
                </p>
                <h2 id="correction-review-title">
                  {selectedCorrection.requesterName}
                </h2>
                <p className="correction-review-email">
                  {selectedCorrection.requesterEmail}
                </p>
              </div>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                type="button"
                aria-label="Close dialog"
                title="Close dialog"
                onClick={() => setSelectedCorrectionId("")}
              >
                <CloseIcon />
              </button>
            </header>
            <strong className="correction-requested-time">
              {formatRequestedTime(
                selectedCorrection.requestedAt,
                selectedCorrection.timezone,
              )}
            </strong>
            <p className="correction-request-reason">
              {selectedCorrection.reason}
            </p>
            <small>
              Applied
              {selectedCorrection.appliedAt
                ? ` ${formatRequestedTime(selectedCorrection.appliedAt, selectedCorrection.timezone)}`
                : " immediately"}
            </small>
            {messageNode}
            <form
              className="correction-decision-form"
              onSubmit={(event) => void decide(event, selectedCorrection.id)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  event.target instanceof HTMLInputElement
                )
                  event.preventDefault();
              }}
            >
              <label>
                Reviewer note
                <textarea
                  name="reason"
                  maxLength={500}
                  rows={2}
                  placeholder="Add a reconciliation note."
                />
              </label>
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
              <div className="dialog-actions correction-decision-actions">
                <button
                  className="btn btn-danger"
                  type="submit"
                  name="decision"
                  value="reject"
                  formNoValidate
                  disabled={Boolean(busyId)}
                >
                  Reject
                </button>
                <button
                  className="btn btn-ghost"
                  type="submit"
                  name="decision"
                  value="save_note"
                  formNoValidate
                  disabled={Boolean(busyId)}
                >
                  Save note
                </button>
                {selectedCorrection.event !== "break_delete" && (
                  <button
                    className="btn btn-secondary"
                    type="submit"
                    name="decision"
                    value="adjust"
                    disabled={Boolean(busyId)}
                  >
                    {busyId === `correction:${selectedCorrection.id}`
                      ? "Saving…"
                      : "Adjust"}
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  type="submit"
                  name="decision"
                  value="confirm"
                  disabled={Boolean(busyId)}
                >
                  {busyId === `correction:${selectedCorrection.id}`
                    ? "Saving…"
                    : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        )}
      </ModalDialog>

      <ModalDialog
        open={Boolean(selectedDevice)}
        onOpenChange={(open) => {
          if (!open) setSelectedDeviceId("");
        }}
        labelledBy="device-review-title"
      >
        {selectedDevice && (
          <div className="dialog-panel">
            <header className="dialog-header">
              <div>
                <p className="eyebrow">
                  TRUSTED DEVICE · {selectedDevice.outletNames.join(", ")}
                </p>
                <h2 id="device-review-title">{selectedDevice.employeeName}</h2>
                <p className="correction-review-email">
                  {selectedDevice.employeeEmail}
                </p>
              </div>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                type="button"
                aria-label="Close dialog"
                title="Close dialog"
                onClick={() => setSelectedDeviceId("")}
              >
                <CloseIcon />
              </button>
            </header>
            <strong className="correction-requested-time">
              Requested {formatDeviceRequestTime(selectedDevice.createdAt)}
            </strong>
            <p className="dialog-description">
              Approving replaces any previous device for this staff member.
              Rejecting requires them to request enrollment again.
            </p>
            {messageNode}
            <div className="dialog-actions correction-decision-actions">
              <button
                className="btn btn-danger"
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void decideDevice(selectedDevice.id, "reject")}
              >
                {busyId === `device:${selectedDevice.id}`
                  ? "Saving…"
                  : "Reject"}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void decideDevice(selectedDevice.id, "approve")}
              >
                {busyId === `device:${selectedDevice.id}`
                  ? "Saving…"
                  : "Approve"}
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
      {confirmDialog}
    </div>
  );
}
