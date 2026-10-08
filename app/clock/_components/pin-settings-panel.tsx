"use client";

import { ModalDialog } from "@/app/_components/modal-dialog";
import { SixDigitPinInput } from "@/app/clock/_components/six-digit-pin-input";
import { forgetPinUser, rememberPinUser } from "@/lib/pin-client";
import { useState, type FormEvent } from "react";

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
  const [pinSetupError, setPinSetupError] = useState("");
  const [pinFormMode, setPinFormMode] = useState<"remove" | null>(null);
  const [pinMessage, setPinMessage] = useState("");
  const [pinMessageIsError, setPinMessageIsError] = useState(false);

  async function handlePinAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingPin) return;
    setIsSavingPin(true);
    setPinMessage("");
    const form = event.currentTarget;
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
        throw new Error(body.error ?? "Could not update PIN sign-in.");
      }

      forgetPinUser();
      form.reset();
      setPinFormMode(null);
      await onStatusRefresh();
      setPinMessage("PIN sign-in has been removed from this browser.");
      setPinMessageIsError(false);
    } catch (error) {
      setPinMessage(
        error instanceof Error
          ? error.message
          : "Could not update PIN sign-in.",
      );
      setPinMessageIsError(true);
    } finally {
      setIsSavingPin(false);
    }
  }

  async function handlePinSetupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingPin || !authUserId) return;
    setPinSetupError("");
    if (!/^\d{6}$/.test(pinSetupValue)) {
      setPinSetupError("Enter all six digits for your PIN.");
      return;
    }
    if (pinSetupValue !== pinSetupConfirmation) {
      setPinSetupError("Those PINs don’t match.");
      return;
    }

    setIsSavingPin(true);
    try {
      const response = await fetch("/api/staff-devices/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinSetupValue }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Could not set up PIN sign-in.");
      }

      rememberPinUser(authUserId);
      onPinEnabledChange(true);
      setPinSetupValue("");
      setPinSetupConfirmation("");
      onSetupOpenChange(false);
      setPinMessage("PIN sign-in is enabled on this browser.");
      setPinMessageIsError(false);
    } catch (error) {
      setPinSetupError(
        error instanceof Error
          ? error.message
          : "Could not set up PIN sign-in.",
      );
    } finally {
      setIsSavingPin(false);
    }
  }

  function openPinSetup() {
    setPinSetupValue("");
    setPinSetupConfirmation("");
    setPinSetupError("");
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
    setPinSetupError("");
  }

  return (
    <>
      <article className="clock-pin-card">
        <section className="clock-pin-controls" aria-label="PIN sign-in">
          <div className="clock-pin-summary">
            <div className="clock-pin-copy">
              <p className="clock-pin-eyebrow">QUICK SIGN-IN</p>
              <h3>Sign in with a PIN</h3>
              <p>Skip your password next time on this browser.</p>
            </div>
            <span
              className={`clock-pin-status${pinEnabled ? " is-enabled" : ""}`}
            >
              {pinEnabled ? "Enabled" : "Not set up"}
            </span>
          </div>
          {!pinConfigured ? (
            <p className="clock-pin-note" role="status">
              PIN sign-in isn’t available right now.
            </p>
          ) : pinFormMode === "remove" ? (
            <form
              className="clock-pin-form"
              onSubmit={(event) => void handlePinAction(event)}
            >
              <label className="clock-pin-password-label">
                Current password
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
                  className="clock-pin-button is-danger"
                  type="submit"
                  disabled={isSavingPin}
                >
                  {isSavingPin ? "Removing…" : "Remove PIN"}
                </button>
                <button
                  className="clock-pin-button"
                  type="button"
                  onClick={() => setPinFormMode(null)}
                  disabled={isSavingPin}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="clock-pin-actions">
              <button
                className="clock-pin-button is-primary"
                type="button"
                onClick={openPinSetup}
              >
                {pinEnabled ? "Change PIN" : "Set up PIN"}
              </button>
              {pinEnabled && (
                <button
                  className="clock-pin-button is-danger-quiet"
                  type="button"
                  onClick={() => {
                    setPinMessage("");
                    setPinFormMode("remove");
                  }}
                >
                  Remove PIN
                </button>
              )}
            </div>
          )}
          {pinMessage && (
            <p
              className={
                pinMessageIsError ? "form-error" : "clock-pin-feedback"
              }
              role={pinMessageIsError ? "alert" : "status"}
            >
              {pinMessage}
            </p>
          )}
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
                <span aria-hidden="true" /> APPROVED BROWSER
              </p>
              <h2 id="pin-setup-title">Sign in faster with a PIN</h2>
              <p className="pin-setup-description">
                Create a six-digit PIN for this browser. Next time, sign in
                without typing your password. Your password still works whenever
                you need it.
              </p>
            </div>
            <button
              className="dialog-close"
              type="button"
              aria-label="Close PIN setup"
              onClick={() => closePinSetup(false)}
            >
              ×
            </button>
          </header>
          <form className="pin-setup-form" onSubmit={handlePinSetupSubmit}>
            <div className="pin-setup-fields">
              <div className="pin-setup-field">
                <SixDigitPinInput
                  idPrefix="pin-setup-new"
                  label="New six-digit PIN"
                  name="pin"
                  value={pinSetupValue}
                  onChange={setPinSetupValue}
                />
              </div>
              <div className="pin-setup-field">
                <SixDigitPinInput
                  idPrefix="pin-setup-confirm"
                  label="Confirm six-digit PIN"
                  name="confirmPin"
                  value={pinSetupConfirmation}
                  onChange={setPinSetupConfirmation}
                />
              </div>
            </div>
            {pinSetupError && (
              <p className="form-error" role="alert">
                {pinSetupError}
              </p>
            )}
            <div className="pin-setup-actions">
              <button
                className="pin-setup-later"
                type="button"
                onClick={() => closePinSetup(false)}
                disabled={isSavingPin}
              >
                Maybe later
              </button>
              <button
                className="auth-submit"
                type="submit"
                disabled={
                  isSavingPin ||
                  pinSetupValue.length !== 6 ||
                  pinSetupConfirmation.length !== 6
                }
              >
                {isSavingPin ? "Saving PIN…" : "Set up PIN"}
              </button>
            </div>
          </form>
        </div>
      </ModalDialog>
    </>
  );
}
