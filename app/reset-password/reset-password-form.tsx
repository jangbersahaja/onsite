"use client";

import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useState } from "react";

export function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirmPassword"))) {
      setMessage("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    const result = await authClient.resetPassword({ newPassword, token });
    setIsSubmitting(false);
    if (result.error) {
      setMessage("This reset link is invalid, expired, or already used.");
      return;
    }
    setCompleted(true);
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="reset-title">
        <Link className="brand-lockup auth-brand" href="/">
          <span className="brand-mark">S</span>
          <span>shiftline</span>
        </Link>
        <p className="eyebrow">ACCOUNT ACCESS</p>
        <h1 id="reset-title">Set a new password.</h1>
        {completed ? (
          <div className="invite-result">
            <p>
              Password updated. Your previous sessions have been signed out.
            </p>
            <Link className="auth-submit invite-link-button" href="/">
              Return to sign in
            </Link>
          </div>
        ) : !token ? (
          <p className="form-error" role="alert">
            This reset link is invalid or incomplete.
          </p>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
            <label htmlFor="reset-confirm-password">Confirm password</label>
            <input
              id="reset-confirm-password"
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
              {isSubmitting ? "Updating password…" : "Update password"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
