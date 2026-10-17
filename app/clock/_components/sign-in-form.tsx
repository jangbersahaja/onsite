"use client";

import { LanguageSwitcher } from "@/app/_components/language-switcher";
import { useLocale } from "@/app/_components/locale-provider";
import { PasswordInput } from "@/app/_components/password-input";
import { SixDigitPinInput } from "@/app/clock/_components/six-digit-pin-input";
import {
  errorMessage as translateError,
  type ErrorText,
} from "@/lib/i18n/errors";
import {
  getRememberedPinUser,
  subscribeToRememberedPinUser,
} from "@/lib/pin-client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

export function SignInForm() {
  const router = useRouter();
  const { messages } = useLocale();
  const t = messages.auth.signIn;
  const [errorMessage, setErrorMessage] = useState<ErrorText | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const rememberedUserId = useSyncExternalStore(
    subscribeToRememberedPinUser,
    getRememberedPinUser,
    () => null,
  );
  const [isPasswordMode, setIsPasswordMode] = useState(false);
  const [isPendingApproval, setIsPendingApproval] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
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
      if (response.status === 403 && body.code === "pending_approval") {
        setIsPendingApproval(true);
        return;
      }
      if (!response.ok) {
        setErrorMessage({
          code:
            body.code ?? (usePin ? "invalid_pin_sign_in" : "invalid_sign_in"),
          text: String(body.error ?? ""),
        });
        return;
      }
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
    } catch {
      setErrorMessage({ code: null, text: messages.common.networkError });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isPendingApproval) {
    return (
      <main className="auth-screen">
        <section
          className="auth-panel"
          aria-labelledby="pending-approval-title"
        >
          <Link className="brand-lockup auth-brand" href="/">
            <Image
              className="brand-mark"
              src="/onsite%20logo.png"
              alt=""
              width={128}
              height={128}
              priority
            />
            <span>OnSITE</span>
          </Link>
          <LanguageSwitcher className="auth-language" />
          <p className="eyebrow">{t.pendingEyebrow}</p>
          <h1 id="pending-approval-title">{t.pendingTitle}</h1>
          <p className="auth-description">{t.pendingBody}</p>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => {
              setIsPendingApproval(false);
              setErrorMessage(null);
            }}
          >
            {t.backToSignIn}
          </button>
        </section>
      </main>
    );
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
            priority
          />
          <span>OnSITE</span>
        </Link>
        <LanguageSwitcher className="auth-language" />
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 id="sign-in-title">{t.title}</h1>
        <p className="auth-description">
          {rememberedUserId && !isPasswordMode
            ? t.pinDescription
            : t.passwordDescription}
        </p>
        <form
          className={`auth-form${rememberedUserId && !isPasswordMode ? " is-pin-form" : ""}`}
          onSubmit={handleSubmit}
        >
          {rememberedUserId && !isPasswordMode ? (
            <>
              <SixDigitPinInput
                idPrefix="sign-in-pin"
                label={t.pinLabel}
                name="pin"
                value={pinValue}
                onChange={setPinValue}
                autoComplete="one-time-code"
              />
            </>
          ) : (
            <>
              <label htmlFor="identifier">{t.identifierLabel}</label>
              <input
                id="identifier"
                name="identifier"
                type="text"
                autoComplete="username"
                required
              />
              <label htmlFor="password">{t.passwordLabel}</label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </>
          )}
          {errorMessage && (
            <p className="form-error" role="alert">
              {translateError(messages, errorMessage)}
            </p>
          )}
          <button
            className="btn btn-primary btn-lg btn-block btn-spaced"
            type="submit"
            disabled={
              isSubmitting ||
              (Boolean(rememberedUserId && !isPasswordMode) &&
                pinValue.length !== 6)
            }
          >
            {isSubmitting
              ? t.signingIn
              : rememberedUserId && !isPasswordMode
                ? t.continueWithPin
                : t.signIn}
          </button>
        </form>
        {rememberedUserId && (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => {
              setErrorMessage(null);
              setPinValue("");
              setIsPasswordMode((isPassword) => !isPassword);
            }}
          >
            {isPasswordMode ? t.usePinOnBrowser : t.usePasswordInstead}
          </button>
        )}
        <p className="auth-footnote">{t.newHere}</p>
      </section>
    </main>
  );
}
