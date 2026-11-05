"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { LanguageSwitcher } from "@/app/_components/language-switcher";
import { useLocale } from "@/app/_components/locale-provider";
import { errorMessage } from "@/lib/i18n/errors";
import { MAX_PROFILE_PHOTO_BYTES } from "@/lib/profile-photo";
import {
  isValidDisplayName,
  isValidEmail,
  isValidNewPassword,
  normalizeEmail,
} from "@/lib/profile-rules";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

type Feedback = { tone: "success" | "error"; message: string } | null;
type ApiBody = { code?: string; error?: string };

function FeedbackText({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return feedback.tone === "error" ? (
    <p className="form-error" role="alert">
      {feedback.message}
    </p>
  ) : (
    <p className="profile-success" role="status">
      {feedback.message}
    </p>
  );
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function ProfileIntro({
  mode,
  name,
}: {
  mode: "self" | "admin";
  name?: string;
}) {
  const { messages } = useLocale();
  const t = messages.profile;
  if (mode === "admin") {
    return (
      <>
        <Link href="/profile">{t.adminBack}</Link>
        <header className="profile-intro section-heading">
          <div>
            <p className="eyebrow">{t.adminEyebrow}</p>
            <h2>{name ? `${t.adminTitle}: ${name}` : t.adminTitle}</h2>
            <p className="team-section-description">{t.adminSubtitle}</p>
          </div>
        </header>
      </>
    );
  }
  return (
    <header className="profile-intro section-heading">
      <div>
        <p className="eyebrow">{t.eyebrow}</p>
        <h2>{t.title}</h2>
        <p className="team-section-description">{t.subtitle}</p>
      </div>
    </header>
  );
}

export function ProfilePhotoSection({
  name,
  photoUrl,
}: {
  name: string;
  photoUrl: string | null;
}) {
  const { messages } = useLocale();
  const t = messages.shell.profile;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  async function uploadPhoto(file: File) {
    setFeedback(null);
    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      setFeedback({ tone: "error", message: t.tooLarge });
      return;
    }
    if (
      !(await confirm({
        title: t.updateTitle,
        description: t.updateDescription,
        confirmLabel: t.updateConfirm,
      }))
    )
      return;

    setIsSaving(true);
    try {
      const form = new FormData();
      form.set("photo", file);
      const response = await fetch("/api/profile-photo", {
        method: "POST",
        body: form,
      });
      const body = (await response.json()) as ApiBody;
      if (!response.ok) {
        setFeedback({
          tone: "error",
          message: errorMessage(messages, {
            code: body.code ?? null,
            text: body.error ?? t.updateFailed,
          }),
        });
        return;
      }
      window.dispatchEvent(new Event("shiftline-session-changed"));
    } catch {
      setFeedback({ tone: "error", message: t.updateFailed });
    } finally {
      setIsSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removePhoto() {
    setFeedback(null);
    if (
      !(await confirm({
        title: t.removeTitle,
        description: t.removeDescription,
        confirmLabel: t.removeConfirm,
        tone: "danger",
      }))
    )
      return;

    setIsSaving(true);
    try {
      const response = await fetch("/api/profile-photo", { method: "DELETE" });
      const body = (await response.json()) as ApiBody;
      if (!response.ok) {
        setFeedback({
          tone: "error",
          message: errorMessage(messages, {
            code: body.code ?? null,
            text: body.error ?? t.removeFailed,
          }),
        });
        return;
      }
      window.dispatchEvent(new Event("shiftline-session-changed"));
    } catch {
      setFeedback({ tone: "error", message: t.removeFailed });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="profile-card">
      <h3>{messages.profile.photoTitle}</h3>
      <div className="profile-photo-row">
        {photoUrl ? (
          <Image
            className="profile-photo-preview"
            src={photoUrl}
            alt=""
            width={72}
            height={72}
            unoptimized
          />
        ) : (
          <span className="profile-photo-preview profile-photo-initials">
            {initialsOf(name)}
          </span>
        )}
        <div className="profile-photo-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadPhoto(file);
            }}
          />
          <button
            className="btn btn-secondary"
            type="button"
            disabled={isSaving}
            aria-label={t.choosePhoto}
            onClick={() => fileInputRef.current?.click()}
          >
            {t.changePhoto}
          </button>
          {photoUrl ? (
            <button
              className="btn btn-secondary"
              type="button"
              disabled={isSaving}
              onClick={() => void removePhoto()}
            >
              {t.removePhoto}
            </button>
          ) : null}
        </div>
      </div>
      <FeedbackText feedback={feedback} />
      {confirmDialog}
    </section>
  );
}

export function ProfileDetailsForm({
  initialName,
  initialEmail,
  endpoint,
  isSelf,
}: {
  initialName: string;
  initialEmail: string;
  endpoint: string;
  isSelf: boolean;
}) {
  const { messages } = useLocale();
  const t = messages.profile;
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [savedEmail, setSavedEmail] = useState(initialEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const emailChanged = normalizeEmail(email) !== normalizeEmail(savedEmail);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (!isValidDisplayName(name)) {
      setFeedback({ tone: "error", message: t.invalidName });
      return;
    }
    if (!isValidEmail(email)) {
      setFeedback({ tone: "error", message: t.invalidEmail });
      return;
    }

    setIsSaving(true);
    try {
      const body = isSelf
        ? { name, email, currentPassword: currentPassword || undefined }
        : { name, email };
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ApiBody & {
        name?: string;
        email?: string;
      };
      if (!response.ok) {
        setFeedback({
          tone: "error",
          message: errorMessage(messages, {
            code: result.code ?? null,
            text: result.error ?? t.saveFailed,
          }),
        });
        return;
      }
      setName(result.name ?? name);
      setEmail(result.email ?? email);
      setSavedEmail(result.email ?? email);
      setCurrentPassword("");
      setFeedback({ tone: "success", message: t.detailsSaved });
      if (isSelf) window.dispatchEvent(new Event("shiftline-session-changed"));
    } catch {
      setFeedback({ tone: "error", message: t.saveFailed });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="profile-card"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <h3>{t.detailsTitle}</h3>
      <label>
        {t.nameLabel}
        <input
          name="name"
          value={name}
          maxLength={100}
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label>
        {t.emailLabel}
        <input
          name="email"
          type="email"
          value={email}
          maxLength={254}
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      {isSelf && emailChanged ? (
        <label>
          {t.currentPasswordForEmail}
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
      ) : null}
      <FeedbackText feedback={feedback} />
      <div>
        <button className="btn btn-primary" type="submit" disabled={isSaving}>
          {isSaving ? t.saving : t.saveDetails}
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const { messages } = useLocale();
  const t = messages.profile;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (!isValidNewPassword(newPassword)) {
      setFeedback({ tone: "error", message: t.passwordMinimum });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ tone: "error", message: t.passwordMismatch });
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = (await response.json()) as ApiBody;
      if (!response.ok) {
        setFeedback({
          tone: "error",
          message: errorMessage(messages, {
            code: body.code ?? null,
            text: body.error ?? t.saveFailed,
          }),
        });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFeedback({ tone: "success", message: t.passwordUpdated });
    } catch {
      setFeedback({ tone: "error", message: t.saveFailed });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="profile-card"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <h3>{t.passwordTitle}</h3>
      <p className="profile-hint">{t.passwordHint}</p>
      <label>
        {t.currentPasswordLabel}
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
      </label>
      <label>
        {t.newPasswordLabel}
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
      </label>
      <label>
        {t.confirmPasswordLabel}
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
      </label>
      <FeedbackText feedback={feedback} />
      <div>
        <button className="btn btn-primary" type="submit" disabled={isSaving}>
          {t.updatePassword}
        </button>
      </div>
    </form>
  );
}

export function ProfileLanguageSection() {
  const { messages } = useLocale();
  const t = messages.profile;
  return (
    <section className="profile-card">
      <h3>{t.languageTitle}</h3>
      <p className="profile-hint">{t.languageHint}</p>
      <LanguageSwitcher className="profile-language" />
    </section>
  );
}
