"use client";

import { authClient } from "@/lib/auth-client";
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
    const result = await authClient.signIn.email({
      email: String(formData.get("email")),
      password: String(formData.get("password")),
      callbackURL: "/",
    });

    setIsSubmitting(false);
    if (result.error) {
      setErrorMessage("Email or password was not recognized.");
      return;
    }

    router.replace("/");
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
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            name="email"
            type="email"
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
