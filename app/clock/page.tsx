"use client";

import {
  WorkspaceShell,
  type WorkspaceNavigationGroup,
} from "@/app/_components/workspace-shell";
import { CorrectionDialog } from "@/app/clock/_components/correction-dialog";
import { PinSettingsPanel } from "@/app/clock/_components/pin-settings-panel";
import { SetupScreen } from "@/app/clock/_components/setup-screen";
import { SignInForm } from "@/app/clock/_components/sign-in-form";
import { authClient } from "@/lib/auth-client";
import { requestCurrentLocation } from "@/lib/browser-location";
import { verifyGeofence } from "@/lib/geofence";
import { forgetPinUser, rememberPinUser } from "@/lib/pin-client";
import { getCompletedBreakMinutes } from "@/lib/work-breaks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ClockOutlet = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  timezone: string;
  role: "manager" | "supervisor" | "staff";
};

type ClockRecord = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string | null;
  breaks: { startedAt: string; endedAt: string | null }[];
};

type CorrectionRequest = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  event: "clock_in" | "clock_out";
  requestedAt: string;
  reason: string;
  status: "reconciliation" | "approved" | "rejected";
  reviewReason: string | null;
  createdAt: string;
};

type StaffDeviceStatus = {
  required: boolean;
  status:
    | "not_required"
    | "not_enrolled"
    | "pending"
    | "active"
    | "replacement_pending";
  hasActiveDevice: boolean;
  currentBrowserApproved: boolean;
  currentBrowserHasPendingRequest: boolean;
  pinConfigured: boolean;
  currentBrowserPinEnabled: boolean;
};

type ClockPageData = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  outlets: ClockOutlet[];
  activeSession: { id: string; outletId: string; clockInAt: string } | null;
  activeBreak: { id: string; startedAt: string } | null;
  recentSessions: ClockRecord[];
  correctionRequests: CorrectionRequest[];
  correctionLoadError: string | null;
};

async function loadClockData(history?: { from: string; to: string }) {
  const params = new URLSearchParams();
  if (history?.from) params.set("from", history.from);
  if (history?.to) params.set("to", history.to);
  const query = params.toString();
  const [clockResult, correctionResult] = await Promise.allSettled([
    fetch(`/api/clock${query ? `?${query}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
    fetch("/api/corrections", {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
  ]);
  if (clockResult.status === "rejected") throw clockResult.reason;
  const clockResponse = clockResult.value;
  const clockBody = await clockResponse.json();
  if (!clockResponse.ok) {
    throw new Error(clockBody.error ?? "Could not load timekeeping data.");
  }

  let correctionRequests: CorrectionRequest[] = [];
  let correctionLoadError: string | null = null;
  if (correctionResult.status === "rejected") {
    correctionLoadError =
      "Correction history could not be loaded. Verified GPS clocking remains available; manual corrections may be unavailable.";
  } else {
    try {
      const correctionResponse = correctionResult.value;
      const correctionBody = await correctionResponse.json();
      if (!correctionResponse.ok) {
        throw new Error(
          correctionBody.error ?? "Could not load correction requests.",
        );
      }
      correctionRequests = correctionBody.requests as CorrectionRequest[];
    } catch {
      correctionLoadError =
        "Correction history could not be loaded. Verified GPS clocking remains available; manual corrections may be unavailable.";
    }
  }
  return {
    ...clockBody,
    correctionRequests,
    correctionLoadError,
  } as ClockPageData;
}

async function loadStaffDeviceStatus() {
  const response = await fetch("/api/staff-devices", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Could not load device status.");
  return body as StaffDeviceStatus;
}

function formatMinutes(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function getElapsedMinutes(start: string, end: Date | string) {
  return Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
}

function formatDuration(
  start: string,
  end: Date | string,
  breaks: { startedAt: string; endedAt: string | null }[],
) {
  const endAt = new Date(end);
  const adjustedBreaks = breaks.map((breakInterval) => ({
    ...breakInterval,
    endedAt: breakInterval.endedAt ?? endAt.toISOString(),
  }));
  const minutes = Math.max(
    0,
    Math.floor((endAt.getTime() - new Date(start).getTime()) / 60_000) -
      getCompletedBreakMinutes(adjustedBreaks),
  );
  return formatMinutes(minutes);
}

function formatDate(
  value: Date | string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-SG", {
    ...options,
    timeZone: timezone,
  }).format(new Date(value));
}

export default function Home() {
  const authSession = authClient.useSession();
  const router = useRouter();
  const authUserId = authSession.data?.user.id;
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [clockData, setClockData] = useState<ClockPageData | null>(null);
  const [staffDeviceStatus, setStaffDeviceStatus] =
    useState<StaffDeviceStatus | null>(null);
  const [isRequestingStaffDevice, setIsRequestingStaffDevice] = useState(false);
  const [isPinSetupOpen, setIsPinSetupOpen] = useState(false);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isCheckingLocation, setIsCheckingLocation] = useState(false);
  const [locationFix, setLocationFix] = useState<{
    outletId: string;
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);
  const [locationError, setLocationError] = useState<{
    outletId: string;
    reason: "permission_denied" | "unavailable";
  } | null>(null);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [isCorrectionDialogOpen, setIsCorrectionDialogOpen] = useState(false);
  const [clockBlockInfo, setClockBlockInfo] = useState<{
    reason: "poor_accuracy" | "outside_radius";
    distanceMeters: number;
    accuracyMeters: number;
    radiusMeters: number;
  } | null>(null);
  const activeSession = clockData?.activeSession ?? null;
  const isClockedIn = Boolean(activeSession);
  const activeBreak = clockData?.activeBreak ?? null;
  const isOnBreak = Boolean(activeBreak);
  const activeSessionBreaks =
    clockData?.recentSessions.find((record) => record.id === activeSession?.id)
      ?.breaks ?? [];
  const clockedInAt = activeSession ? new Date(activeSession.clockInAt) : null;
  const selectedOutlet =
    clockData?.outlets.find((outlet) => outlet.id === selectedOutletId) ??
    clockData?.outlets[0] ??
    null;
  const reconciliationCount =
    clockData?.correctionRequests.filter(
      (request) => request.status === "reconciliation",
    ).length ?? 0;
  const liveGeofence =
    selectedOutlet && locationFix?.outletId === selectedOutlet.id
      ? verifyGeofence(locationFix, selectedOutlet, selectedOutlet.radiusMeters)
      : null;
  const activeLocationError =
    locationError && locationError.outletId === selectedOutlet?.id
      ? locationError.reason
      : null;
  const isDeviceRequired = selectedOutlet?.role === "staff";
  const isDeviceBlocked = Boolean(
    isDeviceRequired &&
    (!staffDeviceStatus || !staffDeviceStatus.currentBrowserApproved),
  );
  const isLocationBlocked = Boolean(
    activeLocationError ||
    clockBlockInfo ||
    (liveGeofence && !liveGeofence.allowed),
  );
  const shouldRequestManual = Boolean(
    !isOnBreak && isLocationBlocked && !isDeviceBlocked,
  );

  useEffect(() => {
    const outletId = selectedOutlet?.id;
    if (!outletId) return;
    if (!navigator.geolocation) {
      const timer = window.setTimeout(
        () => setLocationError({ outletId, reason: "unavailable" }),
        0,
      );
      return () => window.clearTimeout(timer);
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLocationFix({
          outletId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setLocationError((current) =>
          current?.outletId === outletId ? null : current,
        );
        setClockBlockInfo(null);
      },
      (error) => {
        setLocationError({
          outletId,
          reason:
            error.code === error.PERMISSION_DENIED
              ? "permission_denied"
              : "unavailable",
        });
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [selectedOutlet?.id]);

  useEffect(() => {
    let active = true;
    fetch("/api/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((status: { configured: boolean }) => {
        if (active) setIsConfigured(status.configured);
      })
      .catch(() => {
        if (active) setIsConfigured(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authUserId || isConfigured !== true) return;
    let active = true;
    loadClockData()
      .then((data) => {
        if (!active) return;
        setClockData(data);
        setActionMessage(data.correctionLoadError ?? "");
        setSelectedOutletId(
          data.activeSession?.outletId ?? data.outlets[0]?.id ?? "",
        );
      })
      .catch((error: unknown) => {
        if (active)
          setActionMessage(
            error instanceof Error
              ? error.message
              : "Could not load timekeeping data.",
          );
      })
      .finally(() => {
        if (active) setIsLoadingData(false);
      });
    return () => {
      active = false;
    };
  }, [authUserId, isConfigured]);

  useEffect(() => {
    const currentUser = authSession.data?.user;
    if (
      currentUser &&
      !currentUser.canAccessClock &&
      currentUser.canAccessBackoffice
    ) {
      router.replace("/manage");
    }
  }, [authSession.data?.user, router]);

  useEffect(() => {
    if (!authUserId || isConfigured !== true) return;
    let active = true;
    loadStaffDeviceStatus()
      .then((status) => {
        if (active) {
          setStaffDeviceStatus(status);
          const promptUserId = window.sessionStorage.getItem(
            "onsite-pin-setup-prompt",
          );
          if (promptUserId) {
            window.sessionStorage.removeItem("onsite-pin-setup-prompt");
            if (
              promptUserId === authUserId &&
              status.required &&
              status.pinConfigured &&
              status.currentBrowserApproved &&
              !status.currentBrowserPinEnabled
            ) {
              setIsPinSetupOpen(true);
            }
          }
          if (status.currentBrowserPinEnabled) {
            rememberPinUser(authUserId);
          } else {
            forgetPinUser();
          }
        }
      })
      .catch(() => {
        if (active) {
          setStaffDeviceStatus(null);
          setActionMessage(
            "Could not verify this browser’s approval. Reload the page or contact your manager; clocking is disabled until verified.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [authUserId, isConfigured]);

  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date());
    updateTime();
    const timer = window.setInterval(updateTime, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (isConfigured === false) return <SetupScreen />;
  if (isConfigured === null || authSession.isPending) {
    return (
      <main className="loading-screen" aria-live="polite">
        Loading OnSITE…
      </main>
    );
  }
  if (!authSession.data) return <SignInForm />;
  if (!authSession.data.user.canAccessClock) {
    return (
      <main className="loading-screen" aria-live="polite">
        Opening Backoffice…
      </main>
    );
  }
  if (isLoadingData && !clockData) {
    return (
      <main className="loading-screen" aria-live="polite">
        Loading your timekeeping data…
      </main>
    );
  }

  async function handleRequestStaffDevice() {
    if (isRequestingStaffDevice) return;
    setIsRequestingStaffDevice(true);
    setActionMessage("");
    try {
      const response = await fetch("/api/staff-devices", { method: "POST" });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not request this device.");
      setStaffDeviceStatus(await loadStaffDeviceStatus());
      setActionMessage(
        body.status === "active"
          ? "This browser is already approved for your account."
          : body.replacement
            ? "Replacement request is awaiting manager approval."
            : "Device enrollment request is awaiting manager approval.",
      );
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Could not request this device.",
      );
    } finally {
      setIsRequestingStaffDevice(false);
    }
  }

  async function handleClockAction() {
    if (!selectedOutlet || isCheckingLocation) return;
    if (isDeviceBlocked) {
      setActionMessage(
        "This browser is not approved for clock actions. Enroll this browser and ask your manager to approve it.",
      );
      return;
    }
    if (!navigator.geolocation) {
      setLocationError({ outletId: selectedOutlet.id, reason: "unavailable" });
      setActionMessage(
        "Location is unavailable. Ask your outlet lead to review your time.",
      );
      return;
    }

    setIsCheckingLocation(true);
    setClockBlockInfo(null);
    setActionMessage("Checking your location…");
    let stage: "location" | "recording" | "refreshing" = "location";
    try {
      const fix = await requestCurrentLocation(navigator.geolocation);
      setLocationFix({ ...fix, outletId: selectedOutlet.id });
      setLocationError(null);
      stage = "recording";
      setActionMessage("Recording your clock action…");
      const response = await fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          action: isClockedIn ? "clock_out" : "clock_in",
          outletId: selectedOutlet.id,
          ...fix,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (
          response.status === 422 &&
          (result.reason === "poor_accuracy" ||
            result.reason === "outside_radius")
        ) {
          setClockBlockInfo({
            reason: result.reason,
            distanceMeters: result.distanceMeters,
            accuracyMeters: result.accuracyMeters,
            radiusMeters: result.radiusMeters,
          });
        }
        setActionMessage(result.error ?? "Clock action could not be recorded.");
        return;
      }

      stage = "refreshing";
      setActionMessage("Clock action recorded. Refreshing your shift…");
      setClockData(await loadClockData());
      setActionMessage(
        "Clock action recorded with server time and location evidence.",
      );
    } catch (error) {
      if (stage === "location") {
        setLocationError({
          outletId: selectedOutlet.id,
          reason:
            error instanceof Error && error.message.includes("permission")
              ? "permission_denied"
              : "unavailable",
        });
      }
      setActionMessage(
        stage === "location"
          ? error instanceof Error
            ? error.message
            : "Could not check your location. Try again."
          : stage === "refreshing"
            ? "Clock action recorded, but your shift could not be refreshed. Reload the page to see your current status."
            : "Could not confirm the clock action with the timekeeping service. Reload the page to check your shift before trying again.",
      );
    } finally {
      setIsCheckingLocation(false);
    }
  }

  async function handleBreakAction() {
    if (!selectedOutlet || !activeSession || isCheckingLocation) return;
    const action = isOnBreak ? "end_break" : "start_break";
    setIsCheckingLocation(true);
    setActionMessage(isOnBreak ? "Ending your break…" : "Starting your break…");
    try {
      const response = await fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ action, outletId: selectedOutlet.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Break action failed.");
      setClockData(await loadClockData());
      setActionMessage(
        isOnBreak
          ? "Break ended and recorded. Your shift has resumed."
          : "Break started and recorded.",
      );
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Break action failed.",
      );
    } finally {
      setIsCheckingLocation(false);
    }
  }

  const canManage = authSession.data.user.canAccessBackoffice;
  const navigation: WorkspaceNavigationGroup[] = [
    {
      label: "MY TIME",
      items: [
        {
          href: "/clock",
          label: "Clock",
          glyph: "◷",
          requiredAccess: "clock",
        },
        {
          href: "/clock/history",
          label: "History",
          glyph: "▤",
          requiredAccess: "clock",
          count: reconciliationCount,
        },
      ],
    },
    ...(canManage
      ? [
          {
            label: "WORKSPACE",
            items: [
              {
                href: "/manage",
                label: "Backoffice",
                glyph: "▤",
                requiredAccess: "backoffice" as const,
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <WorkspaceShell
      activeHref="/clock"
      pageTitle="Clock"
      workspaceName={selectedOutlet?.name ?? "Timekeeping"}
      outlets={clockData?.outlets}
      selectedOutletId={selectedOutlet?.id}
      onOutletChange={setSelectedOutletId}
      isOutletLocked={isClockedIn}
      dateLabel={
        currentTime && selectedOutlet
          ? formatDate(currentTime, selectedOutlet.timezone, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })
          : undefined
      }
      navigation={navigation}
    >
      <main className="page-content" id="clock">
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR SHIFT</p>
            <h1>
              Welcome, {authSession.data.user.name.split(" ")[0]}
              <span>.</span>
            </h1>
            <p className="subheading">
              Your time, place, and shift at a glance.
            </p>
          </div>
        </div>

        <section className="clock-layout" aria-label="Clock and shift details">
          <div className="clock-column">
            <article
              className={`clock-panel${isDeviceBlocked ? " is-device-blocked" : ""}`}
            >
              <div className="clock-panel-top">
                <span className="live-indicator">
                  <i />
                  {isOnBreak
                    ? "ON BREAK"
                    : isClockedIn
                      ? "SHIFT IN PROGRESS"
                      : "READY TO START"}
                </span>
                <span className="clock-date">
                  {currentTime && selectedOutlet
                    ? formatDate(currentTime, selectedOutlet.timezone, {
                        weekday: "long",
                        day: "2-digit",
                        month: "short",
                      }).toLocaleUpperCase()
                    : ""}
                </span>
              </div>
              <div className="clock-face">
                <span className="clock-time">
                  {currentTime && selectedOutlet
                    ? formatDate(currentTime, selectedOutlet.timezone, {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true,
                      })
                    : "--:--"}
                </span>
              </div>
              <div className="geofence-row">
                <span className="location-glyph" aria-hidden="true">
                  ⌖
                </span>
                <div>
                  <strong>
                    {selectedOutlet?.name ?? "Choose an assigned outlet"}
                  </strong>
                  <small>
                    {selectedOutlet?.address ??
                      "Your account has no active outlet assignment."}
                  </small>
                </div>
              </div>
              <div className="clock-actions">
                <button
                  className={`clock-action${isClockedIn && !isOnBreak ? " is-clocked-in" : ""}${shouldRequestManual ? " is-manual" : ""}`}
                  type="button"
                  onClick={() =>
                    shouldRequestManual
                      ? setIsCorrectionDialogOpen(true)
                      : void (isOnBreak
                          ? handleBreakAction()
                          : handleClockAction())
                  }
                  aria-busy={isCheckingLocation}
                  disabled={
                    !selectedOutlet ||
                    isDeviceBlocked ||
                    isCheckingLocation ||
                    isLoadingData
                  }
                >
                  <span className="clock-action-icon" aria-hidden="true">
                    {shouldRequestManual
                      ? "✎"
                      : isOnBreak
                        ? "▶"
                        : isClockedIn
                          ? "↗"
                          : "↘"}
                  </span>
                  {shouldRequestManual
                    ? "Request manual"
                    : isCheckingLocation
                      ? isOnBreak
                        ? "Resuming shift…"
                        : "Checking location…"
                      : isOnBreak
                        ? "Resume shift"
                        : isClockedIn
                          ? "Clock out"
                          : "Clock in"}
                </button>
                {isClockedIn && !isOnBreak && (
                  <button
                    className="clock-break-action team-secondary-action"
                    type="button"
                    onClick={() => void handleBreakAction()}
                    disabled={
                      isDeviceBlocked || isCheckingLocation || isLoadingData
                    }
                  >
                    {isCheckingLocation ? "Saving break…" : "Start break"}
                  </button>
                )}
              </div>
              {selectedOutlet?.role === "staff" &&
                staffDeviceStatus?.required && (
                  <div>
                    {staffDeviceStatus.status === "pending" && (
                      <p className="clock-hint" role="status">
                        {staffDeviceStatus.currentBrowserHasPendingRequest
                          ? "This browser is awaiting manager approval."
                          : "A device request is already awaiting approval. Ask your manager if you need to replace it."}
                      </p>
                    )}
                    {staffDeviceStatus.status === "replacement_pending" && (
                      <p className="clock-hint" role="status">
                        {staffDeviceStatus.currentBrowserApproved
                          ? "This browser remains approved while the replacement request is reviewed."
                          : staffDeviceStatus.currentBrowserHasPendingRequest
                            ? "This replacement browser is awaiting manager approval."
                            : "A replacement request is pending from another browser; the currently approved browser can still clock."}
                      </p>
                    )}
                    {staffDeviceStatus.status === "active" &&
                      staffDeviceStatus.currentBrowserApproved && (
                        <p className="clock-hint" role="status">
                          This browser is approved for staff clock actions.
                        </p>
                      )}
                  </div>
                )}
              <div
                className={`clock-location-status${!selectedOutlet || isDeviceBlocked || activeLocationError || clockBlockInfo || (liveGeofence && !liveGeofence.allowed) ? " is-blocked" : liveGeofence?.allowed ? " is-ready" : ""}`}
                role="status"
                aria-live="polite"
              >
                <span className="clock-location-status-icon" aria-hidden="true">
                  {!selectedOutlet ||
                  isDeviceBlocked ||
                  activeLocationError ||
                  clockBlockInfo ||
                  (liveGeofence && !liveGeofence.allowed)
                    ? "!"
                    : liveGeofence?.allowed
                      ? "✓"
                      : "⌖"}
                </span>
                <div>
                  <strong>
                    {!selectedOutlet
                      ? clockData
                        ? "No outlet is assigned to your account"
                        : "Timekeeping is unavailable"
                      : isDeviceRequired && !staffDeviceStatus
                        ? "Checking trusted-device status"
                        : isDeviceBlocked
                          ? "This browser isn’t approved for clock actions"
                          : clockBlockInfo?.reason === "poor_accuracy"
                            ? "GPS accuracy is too low to clock in"
                            : clockBlockInfo
                              ? "You’re outside the clocking area"
                              : activeLocationError === "permission_denied"
                                ? "Location access is turned off"
                                : activeLocationError === "unavailable"
                                  ? "We can’t get a reliable location"
                                  : liveGeofence && !liveGeofence.allowed
                                    ? liveGeofence.reason === "poor_accuracy"
                                      ? "GPS accuracy is too low to clock in"
                                      : "You’re outside the clocking area"
                                    : liveGeofence?.allowed
                                      ? "You’re within the clocking area"
                                      : "Checking your location"}
                  </strong>
                  <span>
                    {!selectedOutlet
                      ? clockData
                        ? "Ask your manager to add you to an active outlet before clocking."
                        : actionMessage ||
                          "Your clock data could not be loaded. Reload the page or contact your manager."
                      : isDeviceRequired && !staffDeviceStatus
                        ? "Clock actions are locked until this browser’s approval can be verified."
                        : isDeviceBlocked
                          ? "Enroll this browser or ask your manager to approve it before clocking."
                          : clockBlockInfo?.reason === "poor_accuracy"
                            ? `Server measured accuracy at ±${clockBlockInfo.accuracyMeters} m; it must be 50 m or better.`
                            : clockBlockInfo
                              ? `${clockBlockInfo.distanceMeters} m from the outlet; the limit is ${clockBlockInfo.radiusMeters} m. GPS accuracy ±${clockBlockInfo.accuracyMeters} m.`
                              : activeLocationError === "permission_denied"
                                ? "Enable location access in your browser settings, then try again."
                                : activeLocationError === "unavailable"
                                  ? "Move near a window or retry when your phone has a clear GPS signal."
                                  : liveGeofence && !liveGeofence.allowed
                                    ? liveGeofence.reason === "poor_accuracy"
                                      ? `Accuracy is ±${Math.round(locationFix?.accuracy ?? 0)} m; it must be 50 m or better.`
                                      : `About ${Math.max(0, Math.round(liveGeofence.distanceMeters - selectedOutlet!.radiusMeters))} m beyond the ${selectedOutlet?.radiusMeters} m outlet radius. GPS accuracy ±${Math.round(locationFix?.accuracy ?? 0)} m.`
                                    : liveGeofence?.allowed
                                      ? `GPS accuracy ±${Math.round(locationFix?.accuracy ?? 0)} m · ${Math.round(liveGeofence.distanceMeters)} m from outlet`
                                      : actionMessage ||
                                        "Location is checked for clock in and out; break times use server time."}
                  </span>
                </div>
                {selectedOutlet?.role === "staff" &&
                !staffDeviceStatus?.currentBrowserApproved ? (
                  <button
                    className="clock-correction-link"
                    type="button"
                    disabled={isRequestingStaffDevice}
                    onClick={() => void handleRequestStaffDevice()}
                  >
                    {isRequestingStaffDevice
                      ? "Requesting…"
                      : staffDeviceStatus?.status === "active"
                        ? "Request this browser"
                        : staffDeviceStatus?.currentBrowserHasPendingRequest
                          ? "Check enrollment request"
                          : staffDeviceStatus?.status === "pending" ||
                              staffDeviceStatus?.status ===
                                "replacement_pending"
                            ? "Check pending request"
                            : "Request device enrollment"}
                  </button>
                ) : null}
              </div>
              {actionMessage && (
                <p
                  className={`clock-action-feedback${isCheckingLocation || actionMessage.includes("recorded") || actionMessage.startsWith("Device request sent") || actionMessage.startsWith("This browser is already approved") ? "" : " is-blocked"}`}
                  role={
                    isCheckingLocation ||
                    actionMessage.includes("recorded") ||
                    actionMessage.startsWith("Device request sent") ||
                    actionMessage.startsWith("This browser is already approved")
                      ? "status"
                      : "alert"
                  }
                >
                  {actionMessage}
                </p>
              )}
            </article>
          </div>

          <aside className="day-column">
            <article className="shift-state-summary">
              <p className="eyebrow">
                {isClockedIn ? "ACTIVE SHIFT" : "SHIFT STATUS"}
              </p>
              <h2>
                {isOnBreak
                  ? "You’re on break"
                  : isClockedIn
                    ? "You’re on the clock"
                    : "Not clocked in"}
              </h2>
              <strong className="shift-state-duration">
                {isClockedIn && clockedInAt && currentTime
                  ? formatDuration(
                      clockedInAt.toISOString(),
                      currentTime,
                      activeSessionBreaks,
                    )
                  : "Ready when you are"}
              </strong>
              {activeBreak && currentTime && (
                <small className="shift-state-break-duration">
                  Current break ·{" "}
                  {formatMinutes(
                    getElapsedMinutes(activeBreak.startedAt, currentTime),
                  )}
                </small>
              )}
              <p>
                {isClockedIn && clockedInAt && selectedOutlet
                  ? `Started at ${formatDate(
                      clockedInAt,
                      selectedOutlet.timezone,
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )} · ${selectedOutlet.name}`
                  : selectedOutlet
                    ? `Clock in at ${selectedOutlet.name} when you’re within range.`
                    : "Ask your manager to assign an outlet before clocking."}
              </p>
            </article>

            {staffDeviceStatus?.required &&
              staffDeviceStatus.currentBrowserApproved && (
                <PinSettingsPanel
                  authUserId={authUserId}
                  isSetupOpen={isPinSetupOpen}
                  pinConfigured={staffDeviceStatus.pinConfigured}
                  pinEnabled={staffDeviceStatus.currentBrowserPinEnabled}
                  onPinEnabledChange={(enabled) =>
                    setStaffDeviceStatus((current) =>
                      current
                        ? { ...current, currentBrowserPinEnabled: enabled }
                        : current,
                    )
                  }
                  onSetupOpenChange={setIsPinSetupOpen}
                  onStatusRefresh={async () =>
                    setStaffDeviceStatus(await loadStaffDeviceStatus())
                  }
                />
              )}
          </aside>
        </section>

        <section className="recent-section" id="history">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SHIFT HISTORY</p>
              <h2>Recent shifts</h2>
            </div>
            <Link className="text-link" href="/clock/history">
              View all shifts <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="clock-recent-list">
            {clockData?.recentSessions.slice(0, 3).map((record) => (
              <article className="clock-recent-row" key={record.id}>
                <div className="clock-recent-outlet">
                  <strong>
                    {formatDate(record.clockInAt, record.timezone, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </strong>
                  <span>{record.outletName}</span>
                </div>
                <div className="clock-recent-times">
                  <span>
                    <small>In</small>
                    {formatDate(record.clockInAt, record.timezone, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>
                    <small>Out</small>
                    {record.clockOutAt
                      ? formatDate(record.clockOutAt, record.timezone, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "In progress"}
                  </span>
                </div>
                <strong className="clock-recent-duration">
                  {record.clockOutAt
                    ? formatDuration(
                        record.clockInAt,
                        record.clockOutAt,
                        record.breaks,
                      )
                    : isClockedIn && currentTime
                      ? formatDuration(
                          record.clockInAt,
                          currentTime,
                          record.breaks,
                        )
                      : "—"}
                  <small className="clock-recent-break-duration">
                    {formatMinutes(
                      getCompletedBreakMinutes(record.breaks) +
                        (record.id === activeSession?.id &&
                        activeBreak &&
                        currentTime
                          ? getElapsedMinutes(
                              activeBreak.startedAt,
                              currentTime,
                            )
                          : 0),
                    )}{" "}
                    break
                  </small>
                </strong>
              </article>
            ))}
            {!clockData?.recentSessions.length && (
              <p className="empty-table">No clock records yet.</p>
            )}
          </div>
        </section>
        <section className="correction-section" id="requests">
          {isCorrectionDialogOpen && (
            <CorrectionDialog
              open
              outlets={clockData?.outlets ?? []}
              shifts={clockData?.recentSessions ?? []}
              initialOutletId={selectedOutlet?.id}
              initialShiftId={activeSession?.id}
              initialEvent={isClockedIn ? "clock_out" : "clock_in"}
              onOpenChange={setIsCorrectionDialogOpen}
              onSubmitted={async () => {
                setClockData(await loadClockData());
                setActionMessage(
                  "Manual punch recorded. Your manager can reconcile it later.",
                );
              }}
            />
          )}
        </section>
        <p className="preview-note">
          <span>i</span> Clock records use server time and location evidence.
          Browser GPS can be spoofed.
        </p>
      </main>
    </WorkspaceShell>
  );
}
