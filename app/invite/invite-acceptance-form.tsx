"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type InvitationInfo = {
  email: string;
  accountType: "admin" | "staff";
  canAccessClock: boolean;
  canAccessBackoffice: boolean;
  role: "manager" | "supervisor" | "staff";
  outletNames: string[];
  expiresAt: string;
};

export function InviteAcceptanceForm({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "This invitation is unavailable.");
        if (active) setInvitation(body as InvitationInfo);
      })
      .catch((error: unknown) => {
        if (active) {
          setMessage(
            error instanceof Error
              ? error.message
              : "This invitation is unavailable.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirmPassword"))) {
      setMessage("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: form.get("name"),
          username: form.get("username"),
          password,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not accept this invitation.");
      setAccepted(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not accept this invitation.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="invite-title">
        <Link className="brand-lockup auth-brand" href="/">
          <span className="brand-mark">S</span>
          <span>shiftline</span>
        </Link>
        <p className="eyebrow">TEAM INVITATION</p>
        <h1 id="invite-title">Join your team.</h1>
        {accepted ? (
          <div className="invite-result">
            <p>Your account is ready. Sign in to continue.</p>
            <Link className="auth-submit invite-link-button" href="/">
              Go to sign in
            </Link>
          </div>
        ) : isLoading ? (
          <p className="auth-description" aria-live="polite">
            Checking invitation…
          </p>
        ) : invitation ? (
          <>
            <p className="auth-description">
              {invitation.email} · {invitation.accountType} ·{" "}
              {[
                invitation.canAccessClock && "Clock",
                invitation.canAccessBackoffice && "Backoffice",
              ]
                .filter(Boolean)
                .join(" + ")}{" "}
              · {invitation.outletNames.join(", ") || "No outlets yet"}
            </p>
            <form className="auth-form" onSubmit={handleSubmit}>
              <label htmlFor="invite-name">Your name</label>
              <input
                id="invite-name"
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={120}
                required
              />
              <label htmlFor="invite-username">Username</label>
              <input
                id="invite-username"
                name="username"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9._-]+"
                required
              />
              <label htmlFor="invite-password">Create password</label>
              <input
                id="invite-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <label htmlFor="invite-confirm-password">Confirm password</label>
              <input
                id="invite-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              {message && (
                <p className="form-error" role="alert">
                  {message}
                </p>
              )}
              <button
                className="auth-submit"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating account…" : "Accept invitation"}
              </button>
            </form>
          </>
        ) : (
          <p className="form-error" role="alert">
            {message || "This invitation link is invalid."}
          </p>
        )}
      </section>
    </main>
  );
}
