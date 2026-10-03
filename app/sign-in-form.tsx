"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignInForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: formData.get("identifier"),
          password: formData.get("password"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Sign-in failed.");
      const authUser = body.user as {
        canAccessClock: boolean;
        canAccessBackoffice: boolean;
      };
      window.dispatchEvent(new Event("shiftline-session-changed"));
      router.replace(
        authUser.canAccessClock
          ? "/clock"
          : authUser.canAccessBackoffice
            ? "/manage"
            : "/",
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Username/email or password was not recognized.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="sign-in-title">
        <Link className="brand-lockup auth-brand" href="/">
          <span className="brand-mark">S</span>
          <span>shiftline</span>
        </Link>
        <p className="eyebrow">TEAM ACCESS</p>
        <h1 id="sign-in-title">Welcome back.</h1>
        <p className="auth-description">
          Sign in to clock in and review your shifts.
        </p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="identifier">Username or email</label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          {errorMessage && (
            <p className="form-error" role="alert">
              {errorMessage}
            </p>
          )}
          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="auth-footnote">
          Accounts are created through a staff invitation.
        </p>
      </section>
    </main>
  );
}
