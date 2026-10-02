"use client";

import { managementNavigation, WorkspaceShell } from "@/app/workspace-shell";
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

async function loadReviewRequests() {
  const response = await fetch("/api/corrections?view=review", {
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Could not load correction requests.");
  return body.requests as ReviewRequest[];
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

export default function CorrectionReviewPage() {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    setIsLoading(true);
    try {
      setRequests(await loadReviewRequests());
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
        if (active) setRequests(loaded);
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

    setBusyId(requestId);
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

  return (
    <WorkspaceShell
      activeHref="/corrections/review"
      pageTitle="Correction requests"
      workspaceName="Operations"
      navigation={managementNavigation}
    >
      <div className="team-page-content timesheet-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">MANAGER REVIEW</p>
            <h1>Correction requests</h1>
            <p className="subheading">
              Review pending requests for your managed outlets.
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
          aria-label="Pending requests"
        >
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
                    {busyId === request.id ? "Saving…" : "Reject"}
                  </button>
                  <button
                    className="auth-submit"
                    type="submit"
                    name="decision"
                    value="approve"
                    disabled={Boolean(busyId)}
                  >
                    {busyId === request.id ? "Saving…" : "Approve"}
                  </button>
                </div>
              </form>
            </article>
          ))}
          {!isLoading && requests.length === 0 && (
            <p className="correction-review-empty">
              No pending requests for your managed outlets.
            </p>
          )}
          {isLoading && (
            <p className="correction-review-empty">Loading requests…</p>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}
