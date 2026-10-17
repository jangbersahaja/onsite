"use client";

import { useLocale } from "@/app/_components/locale-provider";
import { isLocale } from "@/lib/i18n/config";
import { errorMessage, type ErrorText } from "@/lib/i18n/errors";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function ResetPasswordForm({
  token,
  lang,
}: {
  token: string;
  lang?: string;
}) {
  const { messages, setLocale } = useLocale();
  const t = messages.auth.reset;
  const appliedLang = useRef(false);
  useEffect(() => {
    // The reset link carries the recipient's language. Apply it once.
    if (appliedLang.current || !isLocale(lang)) return;
    appliedLang.current = true;
    void setLocale(lang);
  }, [lang, setLocale]);

  const [message, setMessage] = useState<ErrorText | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirmPassword"))) {
      setMessage({ code: "password_mismatch", text: "" });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword, token }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage({
          code: body.code ?? "reset_link_invalid",
          text: String(body.error ?? ""),
        });
        return;
      }
      setCompleted(true);
    } catch {
      setMessage({ code: null, text: messages.common.networkError });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="reset-title">
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
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 id="reset-title">{t.title}</h1>
        {completed ? (
          <div className="invite-result">
            <p>{t.updated}</p>
            <Link
              className="btn btn-primary btn-lg btn-block btn-spaced"
              href="/"
            >
              {t.returnToSignIn}
            </Link>
          </div>
        ) : !token ? (
          <p className="form-error" role="alert">
            {messages.errors.reset_link_incomplete}
          </p>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label htmlFor="reset-password">{t.newPassword}</label>
            <input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
            <label htmlFor="reset-confirm-password">{t.confirmPassword}</label>
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
                {errorMessage(messages, message)}
              </p>
            )}
            <button
              className="btn btn-primary btn-lg btn-block btn-spaced"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t.updating : t.update}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
