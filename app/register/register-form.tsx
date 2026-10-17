"use client";

import { useLocale } from "@/app/_components/locale-provider";
import { PasswordInput } from "@/app/_components/password-input";
import { localeNames, locales, type Locale } from "@/lib/i18n/config";
import { errorMessage, type ErrorText } from "@/lib/i18n/errors";
import { format } from "@/lib/i18n/format";
import { MAX_PROFILE_PHOTO_BYTES } from "@/lib/profile-photo";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type LinkStatus = "loading" | "ready" | "invalid";

export function RegisterForm({ token }: { token: string }) {
  const { locale, messages, setLocale } = useLocale();
  const t = messages.auth.register;
  const [linkStatus, setLinkStatus] = useState<LinkStatus>(
    token ? "loading" : "invalid",
  );
  const [outletName, setOutletName] = useState("");
  const [linkError, setLinkError] = useState<ErrorText | null>(
    token ? null : { code: "registration_link_missing", text: "" },
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<ErrorText | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const photoPreview = useMemo(
    () => (photoFile ? URL.createObjectURL(photoFile) : null),
    [photoFile],
  );
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    fetch(`/api/register?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          if (active) {
            setLinkError({
              code: body.code ?? "registration_link_invalid",
              text: String(body.error ?? ""),
            });
            setLinkStatus("invalid");
          }
          return;
        }
        if (active) {
          setOutletName(String(body.outletName ?? ""));
          setLinkStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setLinkError({ code: "registration_link_invalid", text: "" });
          setLinkStatus("invalid");
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    setMessage(null);
    const file = event.target.files?.[0] ?? null;
    if (file && file.size > MAX_PROFILE_PHOTO_BYTES) {
      setMessage({ code: "photo_too_large", text: "" });
      event.target.value = "";
      setPhotoFile(null);
      return;
    }
    setPhotoFile(file);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!photoFile) {
      setMessage({ code: "photo_required", text: "" });
      return;
    }
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirmPassword"))) {
      setMessage({ code: "password_mismatch", text: "" });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = new FormData();
      payload.set("token", token);
      for (const field of ["name", "username", "email", "password"] as const) {
        payload.set(field, String(form.get(field) ?? ""));
      }
      payload.set("locale", locale);
      payload.set("profilePhoto", photoFile);
      const response = await fetch("/api/register", {
        method: "POST",
        body: payload,
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage({
          code: body.code ?? "register_failed",
          text: String(body.error ?? ""),
        });
        return;
      }
      setSubmitted(true);
    } catch {
      setMessage({ code: null, text: messages.common.networkError });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="register-title">
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
        <h1 id="register-title">{t.title}</h1>

        {submitted ? (
          <div className="invite-result">
            <p>
              {outletName
                ? format(t.submittedFor, { outlet: outletName })
                : t.submitted}
            </p>
            <Link
              className="btn btn-primary btn-lg btn-block btn-spaced"
              href="/"
            >
              {messages.auth.signIn.backToSignIn}
            </Link>
          </div>
        ) : linkStatus === "loading" ? (
          <p className="auth-description" aria-live="polite">
            {t.checkingLink}
          </p>
        ) : linkStatus === "invalid" ? (
          <p className="form-error" role="alert">
            {linkError ? errorMessage(messages, linkError) : ""}
          </p>
        ) : (
          <>
            <p className="auth-description">
              {format(t.registeringFor, { outlet: outletName })}
            </p>
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="register-photo-field">
                <label
                  className="register-photo-picker"
                  htmlFor="register-profile-photo"
                >
                  {photoPreview ? (
                    <Image
                      src={photoPreview}
                      alt={t.photoPreviewAlt}
                      width={96}
                      height={96}
                      unoptimized
                    />
                  ) : (
                    <span aria-hidden="true">{t.addPhoto}</span>
                  )}
                </label>
                <input
                  className="register-photo-input"
                  id="register-profile-photo"
                  name="profilePhoto"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoChange}
                  aria-required="true"
                />
                <small className="auth-field-hint">{t.photoRequirements}</small>
              </div>

              <label htmlFor="register-name">{t.fullName}</label>
              <input
                id="register-name"
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={120}
                required
              />
              <label htmlFor="register-username">{t.username}</label>
              <input
                id="register-username"
                name="username"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9._-]+"
                required
              />
              <label htmlFor="register-email">{t.email}</label>
              <input
                id="register-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
              />
              <label htmlFor="register-password">{t.createPassword}</label>
              <PasswordInput
                id="register-password"
                name="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <label htmlFor="register-confirm-password">
                {t.confirmPassword}
              </label>
              <PasswordInput
                id="register-confirm-password"
                name="confirmPassword"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <label htmlFor="register-language">{t.language}</label>
              <select
                id="register-language"
                name="locale"
                value={locale}
                onChange={(event) => setLocale(event.target.value as Locale)}
              >
                {locales.map((option) => (
                  <option key={option} value={option}>
                    {localeNames[option]}
                  </option>
                ))}
              </select>
              <small className="auth-field-hint">{t.languageHint}</small>
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
                {isSubmitting ? t.submitting : t.submit}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
