"use client";

import { useEffect, useState } from "react";

function decodeVapidKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function NotificationSettings({ outletId }: { outletId: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch(
      `/api/notifications/preferences?outletId=${encodeURIComponent(outletId)}`,
      {
        cache: "no-store",
      },
    )
      .then(async (response) => {
        const body = await response.json();
        if (response.status === 403 || response.status === 404) return null;
        if (!response.ok) {
          throw new Error(
            body.error ?? "Could not load notification settings.",
          );
        }
        return body as { enabled: boolean; publicKey: string | null };
      })
      .then(async (settings) => {
        if (!active || !settings) return;
        setEnabled(settings.enabled);
        setPublicKey(settings.publicKey);
        setIsVisible(true);

        const supported =
          "serviceWorker" in navigator &&
          "PushManager" in window &&
          "Notification" in window;
        setIsSupported(supported);
        if (!supported) return;

        setPermission(Notification.permission);
        try {
          const registration = await navigator.serviceWorker.register("/sw.js");
          const subscription = await registration.pushManager.getSubscription();
          if (active) setHasSubscription(Boolean(subscription));
        } catch {
          if (active)
            setMessage("Could not access browser push notifications.");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setIsVisible(true);
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load notification settings.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [outletId]);

  async function updatePreference(nextEnabled: boolean) {
    const response = await fetch("/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outletId, enabled: nextEnabled }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "Could not update notification settings.");
    }
    setEnabled(body.enabled === true);
  }

  async function enableNotifications() {
    if (isSaving) return;
    setIsSaving(true);
    setMessage("");
    try {
      if (!isSupported)
        throw new Error("Browser push notifications are not supported.");
      if (!publicKey)
        throw new Error("Browser push notifications are not configured.");

      const currentPermission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      setPermission(currentPermission);
      if (currentPermission !== "granted") {
        throw new Error(
          "Allow notifications in your browser to enable alerts.",
        );
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey),
        }));
      setHasSubscription(true);

      const subscriptionResponse = await fetch(
        "/api/notifications/subscriptions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        },
      );
      const subscriptionBody = await subscriptionResponse.json();
      if (!subscriptionResponse.ok) {
        throw new Error(
          subscriptionBody.error ?? "Could not register this browser.",
        );
      }

      await updatePreference(true);
      setMessage("Browser notifications are on for this outlet.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not enable browser notifications.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function disableNotifications() {
    if (isSaving) return;
    setIsSaving(true);
    setMessage("");
    try {
      await updatePreference(false);
      setMessage("Browser notifications are off for this outlet.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update notification settings.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!isVisible) return null;

  const cannotEnable = !isSupported || !publicKey;
  return (
    <section
      className="outlet-notification-settings"
      aria-labelledby="notification-settings-title"
    >
      <div>
        <p className="eyebrow">OUTLET ALERTS</p>
        <h2 id="notification-settings-title">Browser notifications</h2>
        <p className="team-section-description">
          Get alerts for clocking, breaks, correction requests, and timesheet
          edits.
        </p>
        {message && (
          <p
            className="notification-settings-message"
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        )}
        {!isSupported && (
          <p className="notification-settings-message">
            This browser does not support push notifications.
          </p>
        )}
        {permission === "denied" && (
          <p className="notification-settings-message">
            Notifications are blocked in this browser&apos;s site settings.
          </p>
        )}
        {!publicKey && (
          <p className="notification-settings-message">
            Browser push has not been configured by the site administrator.
          </p>
        )}
        {enabled &&
          isSupported &&
          !hasSubscription &&
          permission !== "denied" && (
            <button
              className="team-secondary-action notification-device-action"
              type="button"
              disabled={isSaving || !publicKey}
              onClick={() => void enableNotifications()}
            >
              Enable on this browser
            </button>
          )}
      </div>
      <label className="notification-setting-toggle">
        <span>{enabled ? "On" : "Off"}</span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={isSaving || (!enabled && cannotEnable)}
          onChange={(event) =>
            void (event.currentTarget.checked
              ? enableNotifications()
              : disableNotifications())
          }
          aria-label="Enable browser notifications for this outlet"
        />
      </label>
    </section>
  );
}
