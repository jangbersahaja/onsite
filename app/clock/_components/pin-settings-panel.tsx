"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { useLocale } from "@/app/_components/locale-provider";
import { ModalDialog } from "@/app/_components/modal-dialog";
import { SixDigitPinInput } from "@/app/clock/_components/six-digit-pin-input";
import { errorMessage, type ErrorText } from "@/lib/i18n/errors";
import { forgetPinUser, rememberPinUser } from "@/lib/pin-client";
import { useState, type FormEvent } from "react";
import { CloseIcon } from "../../_components/icons";

type PinSettingsPanelProps = {
  authUserId?: string;
  isSetupOpen: boolean;
  pinConfigured: boolean;
  pinEnabled: boolean;
  onPinEnabledChange: (enabled: boolean) => void;
  onSetupOpenChange: (open: boolean) => void;
  onStatusRefresh: () => Promise<void>;
};

export function PinSettingsPanel({
  authUserId,
  isSetupOpen,
  pinConfigured,
  pinEnabled,
  onPinEnabledChange,
  onSetupOpenChange,
  onStatusRefresh,
}: PinSettingsPanelProps) {
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [pinSetupValue, setPinSetupValue] = useState("");
  const [pinSetupConfirmation, setPinSetupConfirmation] = useState("");
  const [pinSetupError, setPinSetupError] = useState<ErrorText | null>(null);
  const [pinFormMode, setPinFormMode] = useState<"remove" | null>(null);
  const [pinNotice, setPinNotice] = useState<"removed" | "enabled" | null>(
    null,
  );
  const [pinError, setPinError] = useState<ErrorText | null>(null);
  const { messages } = useLocale();
  const t = messages.dialogs.pinSettings;
  const { confirm, confirmDialog } = useConfirmDialog();

  async function handlePinAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingPin) return;
    const form = event.currentTarget;
    if (
      !(await confirm({
        title: t.removeConfirmTitle,
        description: t.removeConfirmDescription,
        confirmLabel: t.removeConfirmLabel,
        tone: "danger",
      }))
    )
      return;
    setIsSavingPin(true);
    setPinNotice(null);
    setPinError(null);
    const formData = new FormData(form);
    try {
      const response = await fetch("/api/staff-devices/pin", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: formData.get("currentPassword"),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setPinError({
          code: body.code ?? null,
          text: String(body.error ?? t.removeFallbackError),
        });
        return;
      }

      forgetPinUser();
      form.reset();
      setPinFormMode(null);
      await onStatusRefresh();
      setPinNotice("removed");
    } catch {
      setPinError({ code: null, text: t.removeFallbackError });
    } finally {
      setIsSavingPin(false);
    }
  }

  async function handlePinSetupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingPin || !authUserId) return;
    setPinSetupError(null);
    if (!/^\d{6}$/.test(pinSetupValue)) {
      setPinSetupError({ code: null, text: t.incompletePin });
      return;
    }
    if (pinSetupValue !== pinSetupConfirmation) {
      setPinSetupError({ code: null, text: t.pinMismatch });
      return;
    }

    if (
      !(await confirm({
        title: t.setupConfirmTitle,
        description: t.setupConfirmDescription,
        confirmLabel: t.setupConfirmLabel,
      }))
    )
      return;
    setIsSavingPin(true);
    try {
      const response = await fetch("/api/staff-devices/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinSetupValue }),
      });
      const body = await response.json();
      if (!response.ok) {
        setPinSetupError({
          code: body.code ?? null,
          text: String(body.error ?? t.setupFallbackError),
        });
        return;
      }

      rememberPinUser(authUserId);
      onPinEnabledChange(true);
      setPinSetupValue("");
      setPinSetupConfirmation("");
      onSetupOpenChange(false);
      setPinError(null);
      setPinNotice("enabled");
    } catch {
      setPinSetupError({ code: null, text: t.setupFallbackError });
    } finally {
      setIsSavingPin(false);
    }
  }

  function openPinSetup() {
    setPinSetupValue("");
    setPinSetupConfirmation("");
    setPinSetupError(null);
    onSetupOpenChange(true);
  }

  function closePinSetup(open: boolean) {
    if (open) {
      onSetupOpenChange(true);
      return;
    }
    if (isSavingPin) return;
    onSetupOpenChange(false);
    setPinSetupValue("");
    setPinSetupConfirmation("");
    setPinSetupError(null);
  }

  return (
    <>
      <article className="clock-pin-card">
        <section className="clock-pin-controls" aria-label={t.sectionLabel}>
          <div className="clock-pin-summary">
            <div className="clock-pin-copy">
              <p className="clock-pin-eyebrow">{t.eyebrow}</p>
              <h3>{t.title}</h3>
              <p>{t.description}</p>
            </div>
            <span
              className={`clock-pin-status${pinEnabled ? " is-enabled" : ""}`}
            >
              {pinEnabled ? t.statusEnabled : t.statusNotSetUp}
            </span>
          </div>
          {!pinConfigured ? (
            <p className="clock-pin-note" role="status">
              {t.unavailable}
            </p>
          ) : pinFormMode === "remove" ? (
            <form
              className="clock-pin-form"
              onSubmit={(event) => void handlePinAction(event)}
            >
              <label className="clock-pin-password-label">
                {t.currentPassword}
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
              </label>
              <div className="clock-pin-actions">
                <button
                  className="btn btn-danger btn-sm"
                  type="submit"
                  disabled={isSavingPin}
                >
                  {isSavingPin ? t.removing : t.removePin}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => setPinFormMode(null)}
                  disabled={isSavingPin}
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          ) : (
            <div className="clock-pin-actions">
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={openPinSetup}
              >
                {pinEnabled ? t.changePin : t.setUpPin}
              </button>
              {pinEnabled && (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => {
                    setPinNotice(null);
                    setPinError(null);
                    setPinFormMode("remove");
                  }}
                >
                  {t.removePin}
                </button>
              )}
            </div>
          )}
          {pinError ? (
            <p className="form-error" role="alert">
              {errorMessage(messages, pinError)}
            </p>
          ) : pinNotice ? (
            <p className="clock-pin-feedback" role="status">
              {pinNotice === "removed" ? t.removedNotice : t.enabledNotice}
            </p>
          ) : null}
        </section>
      </article>
      <ModalDialog
        open={isSetupOpen}
        onOpenChange={closePinSetup}
        labelledBy="pin-setup-title"
      >
        <div className="dialog-panel pin-setup-panel">
          <header className="dialog-header pin-setup-header">
            <div>
              <p className="pin-setup-kicker">
                <span aria-hidden="true" /> {t.setupKicker}
              </p>
              <h2 id="pin-setup-title">{t.setupTitle}</h2>
              <p className="pin-setup-description">{t.setupDescription}</p>
            </div>
            <button
              className="btn btn-ghost btn-icon"
              type="button"
              aria-label={t.closeSetupLabel}
              title={t.closeTitle}
              onClick={() => closePinSetup(false)}
            >
              <CloseIcon />
            </button>
          </header>
          <form className="pin-setup-form" onSubmit={handlePinSetupSubmit}>
            <div className="pin-setup-fields">
              <div className="pin-setup-field">
                <SixDigitPinInput
                  idPrefix="pin-setup-new"
                  label={t.newPinLabel}
                  name="pin"
                  value={pinSetupValue}
                  onChange={setPinSetupValue}
                />
              </div>
              <div className="pin-setup-field">
                <SixDigitPinInput
                  idPrefix="pin-setup-confirm"
                  label={t.confirmPinLabel}
                  name="confirmPin"
                  value={pinSetupConfirmation}
                  onChange={setPinSetupConfirmation}
                />
              </div>
            </div>
            {pinSetupError && (
              <p className="form-error" role="alert">
                {errorMessage(messages, pinSetupError)}
              </p>
            )}
            <div className="pin-setup-actions">
              <button
                className="btn btn-secondary btn-lg"
                type="button"
                onClick={() => closePinSetup(false)}
                disabled={isSavingPin}
              >
                {t.maybeLater}
              </button>
              <button
                className="btn btn-primary btn-lg"
                type="submit"
                disabled={
                  isSavingPin ||
                  pinSetupValue.length !== 6 ||
                  pinSetupConfirmation.length !== 6
                }
              >
                {isSavingPin ? t.savingPin : t.setUpPin}
              </button>
            </div>
          </form>
        </div>
      </ModalDialog>
      {confirmDialog}
    </>
  );
}
