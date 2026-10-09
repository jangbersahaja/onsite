"use client";

import { REVIEW_REQUESTS_CHANGED_EVENT } from "@/app/_components/workspace-shell";
import {
  formatOutletDateTime,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import { usePathname, useRouter } from "next/navigation";
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
  event: "clock_in" | "clock_out";
  requestedAt: string;
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

async function loadReviewRequests(
  outletId?: string,
  devicesOnly = false,
): Promise<ReviewData> {
  const correctionQuery = new URLSearchParams({ view: "review" });
  if (outletId) correctionQuery.set("outletId", outletId);
  const [corrections, devices] = await Promise.all([
    devicesOnly
      ? Promise.resolve({ items: [], error: null })
      : loadReviewList<ReviewRequest>(
          `/api/corrections?${correctionQuery}`,
          "Could not load correction requests.",
        ),
    outletId && !devicesOnly
      ? Promise.resolve({ items: [], error: null })
      : loadReviewList<DeviceRequest>(
          "/api/staff-devices?view=review",
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

export default function CorrectionReviewPage({
  outletId,
  devicesOnly = false,
}: {
  outletId?: string;
  devicesOnly?: boolean;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [requests, setRequests] = useState<ReviewRequest[] | null>(null);
  const [deviceRequests, setDeviceRequests] = useState<DeviceRequest[] | null>(
    null,
  );
  const [correctionError, setCorrectionError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const requestList = requests ?? [];
  const deviceRequestList = deviceRequests ?? [];
  const reconciliationRequests = requestList.filter(
    (request) => request.status === "reconciliation",
  );

  async function refresh() {
    setIsLoading(true);
    try {
      const loaded = await loadReviewRequests(outletId, devicesOnly);
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
    if (pathname === "/corrections/review") router.replace("/outlets");
  }, [pathname, router]);

  useEffect(() => {
    let active = true;
    loadReviewRequests(outletId, devicesOnly)
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
  }, [devicesOnly, outletId]);

  async function decide(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    if (busyId) return;
    const formData = new FormData(event.currentTarget);
    const reason = String(formData.get("reason") ?? "");
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const decision =
      submitter instanceof HTMLButtonElement ? submitter.value : "";
    if (decision !== "confirm" && decision !== "adjust") return;

    let requestedAt: string | undefined;
    if (decision === "adjust") {
      const localTime = String(formData.get("requestedAt") ?? "");
      try {
        requestedAt = outletDateTimeToISOString(
          localTime,
          requestList.find((request) => request.id === requestId)?.timezone ??
            "UTC",
        );
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Enter a valid punch time.",
        );
        return;
      }
    }

    const busyKey = `correction:${requestId}`;
    setBusyId(busyKey);
    setMessage("");
    try {
      const response = await fetch("/api/corrections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          outletId:
            outletId ??
            requestList.find((request) => request.id === requestId)?.outletId,
          decision,
          reason,
          requestedAt,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not record this decision.");
      setMessage(
        decision === "adjust"
          ? "Punch adjusted and reconciled."
          : "Punch reconciled.",
      );
      window.dispatchEvent(new Event(REVIEW_REQUESTS_CHANGED_EVENT));
      setRequests(
        (current) =>
          current?.filter((request) => request.id !== requestId) ?? null,
      );
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
          <p className="eyebrow">MANAGER REVIEW</p>
          <h1>{devicesOnly ? "Device requests" : "Review requests"}</h1>
          <p className="subheading">
            {devicesOnly
              ? "Review trusted device enrollments across your outlets."
              : outletId
                ? "Review clock corrections for this outlet."
                : "Review clock corrections and staff device enrollments."}
          </p>
        </div>
        <button
          className="timesheet-cancel"
          type="button"
          disabled={isLoading}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

      {message && (
        <p className="team-message" role="status">
          {message}
        </p>
      )}
      {!devicesOnly && (
        <section
          className="correction-review-list"
          aria-label="Applied punches awaiting reconciliation"
        >
          <header className="correction-review-section-heading">
            <h2>Needs reconciliation</h2>
            <span>
              {requests === null ? "—" : reconciliationRequests.length}
            </span>
          </header>
          {correctionError && (
            <p className="team-message" role="alert">
              {correctionError}
              {requests !== null && " Showing previously loaded requests."}
            </p>
          )}
          {isLoading && requests === null && (
            <p className="correction-review-empty">
              Loading clock corrections…
            </p>
          )}
          {reconciliationRequests.map((request) => (
            <article className="correction-review-item" key={request.id}>
              <div className="correction-review-details">
                <p className="eyebrow">
                  {request.outletName} · {request.event.replace("_", " ")}
                </p>
                <h2>{request.requesterName}</h2>
                <p className="correction-review-email">
                  {request.requesterEmail}
                </p>
                <strong className="correction-requested-time">
                  {formatRequestedTime(request.requestedAt, request.timezone)}
                </strong>
                <p className="correction-request-reason">{request.reason}</p>
                <small>
                  Applied
                  {request.appliedAt
                    ? ` ${formatRequestedTime(request.appliedAt, request.timezone)}`
                    : " immediately"}
                </small>
              </div>
              <form
                className="correction-decision-form"
                onSubmit={(event) => void decide(event, request.id)}
              >
                <label>
                  Manager note
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={500}
                    rows={2}
                    required
                    placeholder="Add a reconciliation note."
                  />
                </label>
                <label>
                  Adjust punch time
                  <input
                    name="requestedAt"
                    type="datetime-local"
                    required
                    defaultValue={formatOutletDateTime(
                      request.requestedAt,
                      request.timezone,
                    )}
                  />
                </label>
                <div className="correction-decision-actions">
                  <button
                    className="team-secondary-action"
                    type="submit"
                    name="decision"
                    value="adjust"
                    disabled={Boolean(busyId)}
                  >
                    {busyId === `correction:${request.id}`
                      ? "Saving…"
                      : "Adjust"}
                  </button>
                  <button
                    className="auth-submit"
                    type="submit"
                    name="decision"
                    value="confirm"
                    disabled={Boolean(busyId)}
                  >
                    {busyId === `correction:${request.id}`
                      ? "Saving…"
                      : "Confirm"}
                  </button>
                </div>
              </form>
            </article>
          ))}
          {requests !== null &&
            !correctionError &&
            reconciliationRequests.length === 0 && (
              <p className="correction-review-empty">
                No clock corrections need review.
              </p>
            )}
        </section>
      )}
      {(!outletId || devicesOnly) && (
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
              {deviceRequests !== null &&
                " Showing previously loaded requests."}
            </p>
          )}
          {isLoading && deviceRequests === null && (
            <p className="correction-review-empty">
              Loading device enrollments…
            </p>
          )}
          {deviceRequestList.map((request) => (
            <article className="correction-review-item" key={request.id}>
              <div className="correction-review-details">
                <p className="eyebrow">
                  TRUSTED DEVICE · {request.outletNames.join(", ")}
                </p>
                <h2>{request.employeeName}</h2>
                <p className="correction-review-email">
                  {request.employeeEmail}
                </p>
                <strong className="correction-requested-time">
                  Requested {formatDeviceRequestTime(request.createdAt)}
                </strong>
              </div>
              <div className="correction-decision-actions">
                <button
                  className="correction-reject-button"
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => void decideDevice(request.id, "reject")}
                >
                  {busyId === `device:${request.id}` ? "Saving…" : "Reject"}
                </button>
                <button
                  className="auth-submit"
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => void decideDevice(request.id, "approve")}
                >
                  {busyId === `device:${request.id}` ? "Saving…" : "Approve"}
                </button>
              </div>
            </article>
          ))}
          {deviceRequests !== null &&
            !deviceError &&
            deviceRequestList.length === 0 && (
              <p className="correction-review-empty">
                No pending device enrollments.
              </p>
            )}
        </section>
      )}
    </div>
  );
}
