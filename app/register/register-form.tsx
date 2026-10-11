"use client";

import { PasswordInput } from "@/app/_components/password-input";
import { MAX_PROFILE_PHOTO_BYTES } from "@/lib/profile-photo";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type LinkStatus = "loading" | "ready" | "invalid";

export function RegisterForm({ token }: { token: string }) {
  const [linkStatus, setLinkStatus] = useState<LinkStatus>(
    token ? "loading" : "invalid",
  );
  const [outletName, setOutletName] = useState("");
  const [linkMessage, setLinkMessage] = useState(
    token ? "" : "This registration link is missing its token.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
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
        if (!response.ok)
          throw new Error(
            body.error ?? "This registration link is unavailable.",
          );
        if (active) {
          setOutletName(String(body.outletName ?? ""));
          setLinkStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLinkMessage(
            error instanceof Error
              ? error.message
              : "This registration link is unavailable.",
          );
          setLinkStatus("invalid");
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    setMessage("");
    const file = event.target.files?.[0] ?? null;
    if (file && file.size > MAX_PROFILE_PHOTO_BYTES) {
      setMessage("Profile photos must be 2 MB or smaller.");
      event.target.value = "";
      setPhotoFile(null);
      return;
    }
    setPhotoFile(file);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!photoFile) {
      setMessage("A profile photo is required.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirmPassword"))) {
      setMessage("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = new FormData();
      payload.set("token", token);
      for (const field of ["name", "username", "email", "password"] as const) {
        payload.set(field, String(form.get(field) ?? ""));
      }
      payload.set("profilePhoto", photoFile);
      const response = await fetch("/api/register", {
        method: "POST",
        body: payload,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not submit this registration.");
      setSubmitted(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not submit this registration.",
      );
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
        <p className="eyebrow">STAFF REGISTRATION</p>
        <h1 id="register-title">Create your account.</h1>

        {submitted ? (
          <div className="invite-result">
            <p>
              Registration submitted
              {outletName ? ` for ${outletName}` : ""}. Your account is waiting
              for admin approval. Please contact your manager/supervisor to
              approve for registration.
            </p>
            <Link className="auth-submit invite-link-button" href="/">
              Back to sign in
            </Link>
          </div>
        ) : linkStatus === "loading" ? (
          <p className="auth-description" aria-live="polite">
            Checking registration link…
          </p>
        ) : linkStatus === "invalid" ? (
          <p className="form-error" role="alert">
            {linkMessage}
          </p>
        ) : (
          <>
            <p className="auth-description">
              Registering for {outletName}. A manager at this outlet will
              approve your account.
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
                      alt="Your profile photo preview"
                      width={96}
                      height={96}
                      unoptimized
                    />
                  ) : (
                    <span aria-hidden="true">Add photo</span>
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
                <small className="auth-field-hint">
                  Required · JPEG, PNG, or WebP · up to 2 MB
                </small>
              </div>

              <label htmlFor="register-name">Full name</label>
              <input
                id="register-name"
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={120}
                required
              />
              <label htmlFor="register-username">Username (Nickname)</label>
              <input
                id="register-username"
                name="username"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9._-]+"
                required
              />
              <label htmlFor="register-email">Email</label>
              <input
                id="register-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
              />
              <label htmlFor="register-password">Create password</label>
              <PasswordInput
                id="register-password"
                name="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <label htmlFor="register-confirm-password">
                Confirm password
              </label>
              <PasswordInput
                id="register-confirm-password"
                name="confirmPassword"
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
                {isSubmitting ? "Submitting…" : "Submit registration"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
