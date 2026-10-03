"use client";

import { REVIEW_REQUESTS_CHANGED_EVENT } from "@/app/workspace-shell";
import { useEffect, useState, type FormEvent } from "react";

type ReviewRequest = {
  id: string;
  requestedBy: string;
  requesterName: string;
  requesterEmail: string;
  outletId: string;
  outletName: string;
  timezone: string;
  event: "clock_in" | "clock_out";
  requestedAt: string;
  reason: string;
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
  corrections: ReviewRequest[];
  devices: DeviceRequest[];
};

async function loadReviewRequests() {
  const [correctionResponse, deviceResponse] = await Promise.all([
    fetch("/api/corrections?view=review", { cache: "no-store" }),
    fetch("/api/staff-devices?view=review", { cache: "no-store" }),
  ]);
  const [correctionBody, deviceBody] = await Promise.all([
    correctionResponse.json(),
    deviceResponse.json(),
  ]);
  if (!correctionResponse.ok)
    throw new Error(
      correctionBody.error ?? "Could not load correction requests.",
    );
  if (!deviceResponse.ok)
    throw new Error(deviceBody.error ?? "Could not load device requests.");
  return {
    corrections: correctionBody.requests as ReviewRequest[],
    devices: deviceBody.requests as DeviceRequest[],
  } satisfies ReviewData;
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
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [deviceRequests, setDeviceRequests] = useState<DeviceRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    setIsLoading(true);
    try {
      const loaded = await loadReviewRequests();
      setRequests(loaded.corrections);
      setDeviceRequests(loaded.devices);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load correction requests.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    loadReviewRequests()
      .then((loaded) => {
        if (!active) return;
        setRequests(loaded.corrections);
        setDeviceRequests(loaded.devices);
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
  }, []);

  async function decide(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    if (busyId) return;
    const formData = new FormData(event.currentTarget);
    const reason = String(formData.get("reason") ?? "");
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const decision =
      submitter instanceof HTMLButtonElement ? submitter.value : "";
    if (decision !== "approve" && decision !== "reject") return;

    const busyKey = `correction:${requestId}`;
    setBusyId(busyKey);
    setMessage("");
    try {
      const response = await fetch("/api/corrections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, decision, reason }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not record this decision.");
      setMessage(
        `Request ${decision === "approve" ? "approved" : "rejected"}.`,
      );
      window.dispatchEvent(new Event(REVIEW_REQUESTS_CHANGED_EVENT));
      setRequests((current) =>
        current.filter((request) => request.id !== requestId),
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
      setDeviceRequests((current) =>
        current.filter((request) => request.id !== requestId),
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
          <h1>Review requests</h1>
          <p className="subheading">
            Review clock corrections and staff device enrollments.
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
      <section
        className="correction-review-list"
        aria-label="Clock corrections"
      >
        <header className="correction-review-section-heading">
          <h2>Clock corrections</h2>
          <span>{requests.length}</span>
        </header>
        {requests.map((request) => (
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
            </div>
            <form
              className="correction-decision-form"
              onSubmit={(event) => void decide(event, request.id)}
            >
              <label>
                Decision reason
                <textarea
                  name="reason"
                  minLength={3}
                  maxLength={500}
                  rows={2}
                  required
                  placeholder="Record why this request is approved or rejected."
                />
              </label>
              <div className="correction-decision-actions">
                <button
                  className="correction-reject-button"
                  type="submit"
                  name="decision"
                  value="reject"
                  disabled={Boolean(busyId)}
                >
                  {busyId === `correction:${request.id}` ? "Saving…" : "Reject"}
                </button>
                <button
                  className="auth-submit"
                  type="submit"
                  name="decision"
                  value="approve"
                  disabled={Boolean(busyId)}
                >
                  {busyId === `correction:${request.id}`
                    ? "Saving…"
                    : "Approve"}
                </button>
              </div>
            </form>
          </article>
        ))}
        {!isLoading && requests.length === 0 && (
          <p className="correction-review-empty">
            No pending clock correction requests.
          </p>
        )}
      </section>
      <section
        className="correction-review-list"
        aria-label="Device enrollments"
      >
        <header className="correction-review-section-heading">
          <h2>Device enrollments</h2>
          <span>{deviceRequests.length}</span>
        </header>
        {deviceRequests.map((request) => (
          <article className="correction-review-item" key={request.id}>
            <div className="correction-review-details">
              <p className="eyebrow">
                TRUSTED DEVICE · {request.outletNames.join(", ")}
              </p>
              <h2>{request.employeeName}</h2>
              <p className="correction-review-email">{request.employeeEmail}</p>
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
        {!isLoading && deviceRequests.length === 0 && (
          <p className="correction-review-empty">
            No pending device enrollments.
          </p>
        )}
        {isLoading && (
          <p className="correction-review-empty">Loading review requests…</p>
        )}
      </section>
    </div>
  );
}
