"use client";

import { CorrectionDialog } from "@/app/clock/correction-dialog";
import { SetupScreen } from "@/app/setup-screen";
import { SignInForm } from "@/app/sign-in-form";
import {
  WorkspaceShell,
  type WorkspaceNavigationGroup,
} from "@/app/workspace-shell";
import { authClient } from "@/lib/auth-client";
import { requestCurrentLocation } from "@/lib/browser-location";
import { verifyGeofence } from "@/lib/geofence";
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
};

type CorrectionRequest = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  event: "clock_in" | "clock_out";
  requestedAt: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
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
};

type ClockPageData = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  outlets: ClockOutlet[];
  activeSession: { id: string; outletId: string; clockInAt: string } | null;
  recentSessions: ClockRecord[];
  correctionRequests: CorrectionRequest[];
};

async function loadClockData(history?: { from: string; to: string }) {
  const params = new URLSearchParams();
  if (history?.from) params.set("from", history.from);
  if (history?.to) params.set("to", history.to);
  const query = params.toString();
  const [clockResponse, correctionResponse] = await Promise.all([
    fetch(`/api/clock${query ? `?${query}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
    fetch("/api/corrections", {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
  ]);
  const [clockBody, correctionBody] = await Promise.all([
    clockResponse.json(),
    correctionResponse.json(),
  ]);
  if (!clockResponse.ok) {
    throw new Error(clockBody.error ?? "Could not load timekeeping data.");
  }
  if (!correctionResponse.ok) {
    throw new Error(
      correctionBody.error ?? "Could not load correction requests.",
    );
  }
  return {
    ...clockBody,
    correctionRequests: correctionBody.requests,
  } as ClockPageData;
}

async function loadStaffDeviceStatus() {
  const response = await fetch("/api/staff-devices", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Could not load device status.");
  return body as StaffDeviceStatus;
}

function formatDuration(start: string, end: Date | string) {
  const minutes = Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
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
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [clockData, setClockData] = useState<ClockPageData | null>(null);
  const [staffDeviceStatus, setStaffDeviceStatus] =
    useState<StaffDeviceStatus | null>(null);
  const [isRequestingStaffDevice, setIsRequestingStaffDevice] = useState(false);
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
  const clockedInAt = activeSession ? new Date(activeSession.clockInAt) : null;
  const selectedOutlet =
    clockData?.outlets.find((outlet) => outlet.id === selectedOutletId) ??
    clockData?.outlets[0] ??
    null;
  const pendingCorrectionCount =
    clockData?.correctionRequests.filter(
      (request) => request.status === "pending",
    ).length ?? 0;
  const liveGeofence =
    selectedOutlet && locationFix?.outletId === selectedOutlet.id
      ? verifyGeofence(locationFix, selectedOutlet, selectedOutlet.radiusMeters)
      : null;
  const activeLocationError =
    locationError && locationError.outletId === selectedOutlet?.id
      ? locationError.reason
      : null;
  const isDeviceBlocked = Boolean(
    selectedOutlet?.role === "staff" &&
    staffDeviceStatus?.required &&
    !staffDeviceStatus.currentBrowserApproved,
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
    if (!authSession.data?.user.id || isConfigured !== true) return;
    let active = true;
    loadClockData()
      .then((data) => {
        if (!active) return;
        setClockData(data);
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
  }, [authSession.data?.user.id, isConfigured]);

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
    if (!authSession.data?.user.id || isConfigured !== true) return;
    let active = true;
    loadStaffDeviceStatus()
      .then((status) => {
        if (active) setStaffDeviceStatus(status);
      })
      .catch(() => {
        if (active) setStaffDeviceStatus(null);
      });
    return () => {
      active = false;
    };
  }, [authSession.data?.user.id, isConfigured]);

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
        Loading Shiftline…
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
          : "Device request sent. A manager must approve this browser before it can clock.",
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
        setActionMessage(
          result.error ?? "Clock action could not be recorded.",
        );
        return;
      }

      stage = "refreshing";
      setActionMessage("Clock action recorded. Refreshing your shift…");
      setClockData(await loadClockData());
      setActionMessage(
        "Clock action recorded with server time and location evidence.",
      );
    } catch (error) {
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
          count: pendingCorrectionCount,
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
            <article className="clock-panel">
              <div className="clock-panel-top">
                <span className="live-indicator">
                  <i /> {isClockedIn ? "SHIFT IN PROGRESS" : "READY TO START"}
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
                <span className="clock-timezone">
                  {selectedOutlet?.timezone ?? "Outlet time"}
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
                {selectedOutlet && (
                  <span className="distance-pill">
                    {selectedOutlet.radiusMeters} m radius
                  </span>
                )}
              </div>
              <button
                className={`clock-action${isClockedIn ? " is-clocked-in" : ""}`}
                type="button"
                onClick={() => void handleClockAction()}
                disabled={
                  !selectedOutlet ||
                  isCheckingLocation ||
                  isLoadingData
                }
              >
                <span className="clock-action-icon" aria-hidden="true">
                  ↗
                </span>
                {isCheckingLocation
                  ? "Checking location…"
                  : isClockedIn
                    ? "Clock out"
                    : "Clock in"}
              </button>
              {selectedOutlet?.role === "staff" &&
                staffDeviceStatus?.required && (
                  <div>
                    {(staffDeviceStatus.status === "not_enrolled" ||
                      (staffDeviceStatus.status === "active" &&
                        !staffDeviceStatus.currentBrowserApproved)) && (
                      <button
                        className="reset-link-button"
                        type="button"
                        disabled={isRequestingStaffDevice}
                        onClick={() => void handleRequestStaffDevice()}
                      >
                        {isRequestingStaffDevice
                          ? "Requesting…"
                          : staffDeviceStatus.status === "active"
                            ? "Request this browser"
                            : "Enroll this browser"}
                      </button>
                    )}
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
                      ? "No outlet is assigned to your account"
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
                      ? "Ask your manager to add you to an active outlet before clocking."
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
                                      "Your location is checked before every clock action."}
                  </span>
                </div>
                {isDeviceBlocked ? (
                  <button
                    className="clock-correction-link"
                    type="button"
                    disabled={isRequestingStaffDevice}
                    onClick={() => void handleRequestStaffDevice()}
                  >
                    {isRequestingStaffDevice ? "Requesting…" : "Enroll browser"}
                  </button>
                ) : activeLocationError ||
                  clockBlockInfo ||
                  (liveGeofence && !liveGeofence.allowed) ? (
                  <button
                    className="clock-correction-link"
                    type="button"
                    onClick={() => setIsCorrectionDialogOpen(true)}
                  >
                    Request correction
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
              <h2>{isClockedIn ? "You’re on the clock" : "Not clocked in"}</h2>
              <strong className="shift-state-duration">
                {isClockedIn && clockedInAt && currentTime
                  ? formatDuration(clockedInAt.toISOString(), currentTime)
                  : "Ready when you are"}
              </strong>
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

            <button
              className="help-row"
              type="button"
              onClick={() => setIsCorrectionDialogOpen(true)}
            >
              <span className="help-mark">?</span>
              <div>
                <strong>Something not right?</strong>
                <small>Request a time correction</small>
              </div>
              <span className="help-arrow">→</span>
            </button>
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
                    ? formatDuration(record.clockInAt, record.clockOutAt)
                    : isClockedIn && currentTime
                      ? formatDuration(record.clockInAt, currentTime)
                      : "—"}
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
              initialEvent={isClockedIn ? "clock_out" : "clock_in"}
              onOpenChange={setIsCorrectionDialogOpen}
              onSubmitted={async () => {
                setClockData(await loadClockData());
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
