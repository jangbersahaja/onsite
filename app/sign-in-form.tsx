"use client";

import {
  getRememberedPinUser,
  subscribeToRememberedPinUser,
} from "@/lib/pin-client";
import { SixDigitPinInput } from "@/app/six-digit-pin-input";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

export function SignInForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const rememberedUserId = useSyncExternalStore(
    subscribeToRememberedPinUser,
    getRememberedPinUser,
    () => null,
  );
  const [isPasswordMode, setIsPasswordMode] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const usePin = Boolean(rememberedUserId && !isPasswordMode);
    try {
      const response = await fetch(
        usePin ? "/api/auth/pin-sign-in" : "/api/auth/sign-in",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            usePin
              ? { userId: rememberedUserId, pin: formData.get("pin") }
              : {
                  identifier: formData.get("identifier"),
                  password: formData.get("password"),
                },
          ),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Sign-in failed.");
      const authUser = body.user as {
        id: string;
        canAccessClock: boolean;
        canAccessBackoffice: boolean;
      };
      if (!usePin && authUser.canAccessClock) {
        window.sessionStorage.setItem("onsite-pin-setup-prompt", authUser.id);
      }
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
          : usePin
            ? "PIN sign-in was not recognized for this browser."
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
          <Image
            className="brand-mark"
            src="/onsite%20logo.png"
            alt=""
            width={128}
            height={128}
          />
          <span>OnSITE</span>
        </Link>
        <p className="eyebrow">TEAM ACCESS</p>
        <h1 id="sign-in-title">Welcome back.</h1>
        <p className="auth-description">
          {rememberedUserId && !isPasswordMode
            ? "Enter your PIN to continue on this approved browser."
            : "Sign in to clock in and review your shifts."}
        </p>
        <form
          className={`auth-form${rememberedUserId && !isPasswordMode ? " is-pin-form" : ""}`}
          onSubmit={handleSubmit}
        >
          {rememberedUserId && !isPasswordMode ? (
            <>
              <SixDigitPinInput
                idPrefix="sign-in-pin"
                label="Enter your six-digit PIN"
                name="pin"
                value={pinValue}
                onChange={setPinValue}
                autoComplete="one-time-code"
              />
            </>
          ) : (
            <>
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
            </>
          )}
          {errorMessage && (
            <p className="form-error" role="alert">
              {errorMessage}
            </p>
          )}
          <button
            className="auth-submit"
            type="submit"
            disabled={
              isSubmitting ||
              (Boolean(rememberedUserId && !isPasswordMode) &&
                pinValue.length !== 6)
            }
          >
            {isSubmitting
              ? "Signing in…"
              : rememberedUserId && !isPasswordMode
                ? "Continue with PIN"
                : "Sign in"}
          </button>
        </form>
        {rememberedUserId && (
          <button
            className="auth-mode-toggle"
            type="button"
            onClick={() => {
              setErrorMessage("");
              setPinValue("");
              setIsPasswordMode((isPassword) => !isPassword);
            }}
          >
            {isPasswordMode
              ? "Use PIN on this browser"
              : "Use password instead"}
          </button>
        )}
        <p className="auth-footnote">
          Accounts are created through a staff invitation.
        </p>
      </section>
    </main>
  );
}
