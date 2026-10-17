"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { useLocale } from "@/app/_components/locale-provider";
import { useReportClockWorkspace } from "@/app/clock/_components/clock-workspace";
import { CorrectionDialog } from "@/app/clock/_components/correction-dialog";
import { PinSettingsPanel } from "@/app/clock/_components/pin-settings-panel";
import { SetupScreen } from "@/app/clock/_components/setup-screen";
import { SignInForm } from "@/app/clock/_components/sign-in-form";
import { authClient } from "@/lib/auth-client";
import { requestCurrentLocation } from "@/lib/browser-location";
import { verifyGeofence } from "@/lib/geofence";
import { localeTags, type Locale } from "@/lib/i18n/config";
import { errorMessage, type ErrorText } from "@/lib/i18n/errors";
import { format } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import { forgetPinUser, rememberPinUser } from "@/lib/pin-client";
import { getCompletedBreakMinutes } from "@/lib/work-breaks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type ClockOutlet = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  timezone: string;
  imageUrl?: string | null;
};

type ClockRecord = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string | null;
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
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
  correctionLoadError: boolean;
};

type NoticeKey = keyof Messages["clock"]["notices"];
type ActionNotice = { tone: "status" | "blocked" } & (
  | { key: NoticeKey }
  | { error: ErrorText }
);

class ClockRequestError extends Error {
  notice: ActionNotice;

  constructor(notice: ActionNotice) {
    super("Clock request failed.");
    this.notice = notice;
  }
}

function serverNotice(
  body: { code?: unknown; error?: unknown },
  fallback: NoticeKey,
): ActionNotice {
  const code = typeof body.code === "string" ? body.code : null;
  const text = typeof body.error === "string" ? body.error : "";
  if (!code && !text) return { tone: "blocked", key: fallback };
  return { tone: "blocked", error: { code, text } };
}

function noticeFromError(error: unknown, fallback: NoticeKey): ActionNotice {
  return error instanceof ClockRequestError
    ? error.notice
    : { tone: "blocked", key: fallback };
}

function locationFailureNotice(error: unknown): ActionNotice {
  if (!(error instanceof Error))
    return { tone: "blocked", key: "locationCheckFailed" };
  if (error.message.includes("timed out"))
    return { tone: "blocked", key: "locationTimedOut" };
  if (error.message.includes("permission was denied"))
    return { tone: "blocked", key: "locationPermissionDenied" };
  return { tone: "blocked", key: "locationUnreliable" };
}

function noticeText(messages: Messages, notice: ActionNotice) {
  return "key" in notice
    ? messages.clock.notices[notice.key]
    : errorMessage(messages, notice.error);
}

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
  if (clockResult.status === "rejected") {
    throw new ClockRequestError({ tone: "blocked", key: "loadFailed" });
  }
  const clockResponse = clockResult.value;
  const clockBody = await clockResponse.json();
  if (!clockResponse.ok) {
    throw new ClockRequestError(serverNotice(clockBody, "loadFailed"));
  }

  let correctionRequests: CorrectionRequest[] = [];
  let correctionLoadError = false;
  if (correctionResult.status === "rejected") {
    correctionLoadError = true;
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
      correctionLoadError = true;
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

function formatMinutes(messages: Messages, minutes: number) {
  return format(messages.clock.duration, {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, "0"),
  });
}

function getElapsedMinutes(start: string, end: Date | string) {
  return Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
}

function formatDuration(
  messages: Messages,
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
  return formatMinutes(messages, minutes);
}

function formatDate(
  locale: Locale,
  value: Date | string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(localeTags[locale], {
    ...options,
    timeZone: timezone,
  }).format(new Date(value));
}

function splitClockTime(value: string) {
  const match = value.match(/^(.*?)\s*([ap]m)$/i);
  return match
    ? { time: match[1], period: match[2] }
    : { time: value, period: "" };
}

type ClockCheck = {
  state: "ok" | "pending" | "blocked";
  title: string;
  detail?: string;
};

function ClockCheckItem({
  label,
  check,
  children,
}: {
  label: string;
  check: ClockCheck;
  children?: ReactNode;
}) {
  return (
    <div className={`clock-check is-${check.state}`}>
      <span className="clock-check-dot" aria-hidden="true" />
      <div className="clock-check-copy">
        <span className="clock-check-label">{label}</span>
        <strong>{check.title}</strong>
        {check.detail && <span>{check.detail}</span>}
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  const authSession = authClient.useSession();
  const router = useRouter();
  const { locale, messages } = useLocale();
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
  const [deviceTimeZone, setDeviceTimeZone] = useState<string | null>(null);
  const [locationRetryCount, setLocationRetryCount] = useState(0);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [isCorrectionDialogOpen, setIsCorrectionDialogOpen] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();
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
  const isDeviceRequired = Boolean(authSession.data?.user.canAccessClock);
  const isDeviceBlocked = Boolean(
    isDeviceRequired &&
    (!staffDeviceStatus || !staffDeviceStatus.currentBrowserApproved),
  );
  const isLivePoorAccuracy = Boolean(
    liveGeofence &&
    !liveGeofence.allowed &&
    liveGeofence.reason === "poor_accuracy",
  );
  const isLocationBlocked = Boolean(
    activeLocationError ||
    clockBlockInfo ||
    (liveGeofence && !liveGeofence.allowed && !isLivePoorAccuracy),
  );
  const shouldRequestManual = Boolean(
    !isOnBreak && isLocationBlocked && !isDeviceBlocked,
  );
  const canRetryLocation = Boolean(
    selectedOutlet && (activeLocationError || isLivePoorAccuracy),
  );
  const nextStepText = isDeviceBlocked
    ? messages.clock.nextStep.device
    : !isOnBreak && isLivePoorAccuracy
      ? messages.clock.nextStep.gps
      : null;

  function retryLocation() {
    setClockBlockInfo(null);
    setLocationError(null);
    setLocationFix(null);
    setLocationRetryCount((count) => count + 1);
  }

  function getGpsCheck(): ClockCheck {
    const { checks } = messages.clock;
    if (!selectedOutlet) {
      return clockData
        ? {
            state: "blocked",
            title: checks.noOutletTitle,
            detail: checks.noOutletDetail,
          }
        : {
            state: "blocked",
            title: checks.unavailableTitle,
            detail: checks.unavailableDetail,
          };
    }
    if (clockBlockInfo?.reason === "poor_accuracy") {
      return {
        state: "blocked",
        title: checks.accuracyLowTitle,
        detail: format(checks.accuracyServerDetail, {
          accuracy: clockBlockInfo.accuracyMeters,
        }),
      };
    }
    if (clockBlockInfo) {
      return {
        state: "blocked",
        title: checks.outsideTitle,
        detail: format(checks.outsideServerDetail, {
          distance: clockBlockInfo.distanceMeters,
          radius: clockBlockInfo.radiusMeters,
        }),
      };
    }
    if (activeLocationError === "permission_denied") {
      return {
        state: "blocked",
        title: checks.permissionTitle,
        detail: checks.permissionDetail,
      };
    }
    if (activeLocationError === "unavailable") {
      return {
        state: "blocked",
        title: checks.noLocationTitle,
        detail: checks.noLocationDetail,
      };
    }
    if (liveGeofence && !liveGeofence.allowed) {
      const accuracy = Math.round(locationFix?.accuracy ?? 0);
      return liveGeofence.reason === "poor_accuracy"
        ? {
            state: "pending",
            title: checks.gpsImprovingTitle,
            detail: format(checks.accuracyLiveDetail, { accuracy }),
          }
        : {
            state: "blocked",
            title: checks.outsideTitle,
            detail: format(checks.outsideLiveDetail, {
              distance: Math.max(
                0,
                Math.round(
                  liveGeofence.distanceMeters - selectedOutlet.radiusMeters,
                ),
              ),
              radius: selectedOutlet.radiusMeters,
            }),
          };
    }
    if (liveGeofence?.allowed) return { state: "ok", title: checks.gpsReady };
    return { state: "pending", title: checks.gpsChecking };
  }

  function getDeviceCheck(): ClockCheck {
    const { checks } = messages.clock;
    if (!staffDeviceStatus) {
      return {
        state: "pending",
        title: checks.browserCheckingTitle,
        detail: checks.browserCheckingDetail,
      };
    }
    if (!isDeviceBlocked) {
      return {
        state: "ok",
        title: checks.browserApprovedTitle,
        detail:
          staffDeviceStatus.status === "replacement_pending"
            ? checks.replacementReview
            : undefined,
      };
    }
    if (
      staffDeviceStatus.status === "pending" ||
      staffDeviceStatus.status === "replacement_pending"
    ) {
      return {
        state: "pending",
        title: checks.awaitingTitle,
        detail: staffDeviceStatus.currentBrowserHasPendingRequest
          ? checks.awaitingThisBrowser
          : checks.awaitingOther,
      };
    }
    return {
      state: "blocked",
      title: checks.notApprovedTitle,
      detail: checks.notApprovedDetail,
    };
  }

  const gpsCheck = getGpsCheck();
  const deviceCheck = getDeviceCheck();

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
  }, [selectedOutlet?.id, locationRetryCount]);

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
        setActionNotice(
          data.correctionLoadError
            ? { tone: "blocked", key: "correctionHistoryUnavailable" }
            : null,
        );
        setSelectedOutletId(
          data.activeSession?.outletId ?? data.outlets[0]?.id ?? "",
        );
      })
      .catch((error: unknown) => {
        if (active) setActionNotice(noticeFromError(error, "loadFailed"));
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
          setActionNotice({ tone: "blocked", key: "deviceVerifyFailed" });
        }
      });
    return () => {
      active = false;
    };
  }, [authUserId, isConfigured]);

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date());
      setDeviceTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    };
    updateTime();
    const timer = window.setInterval(updateTime, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useReportClockWorkspace({
    pageTitle: messages.clock.pageTitle,
    workspaceName: messages.clock.workspaceFallback,
    outlets: clockData?.outlets,
    selectedOutletId: selectedOutlet?.id,
    onOutletChange: setSelectedOutletId,
    isOutletLocked: isClockedIn,
    dateLabel:
      currentTime && selectedOutlet
        ? formatDate(locale, currentTime, selectedOutlet.timezone, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : undefined,
    reconciliationCount,
  });

  if (isConfigured === false) return <SetupScreen />;
  if (isConfigured === null || authSession.isPending) {
    return (
      <main className="loading-screen" aria-live="polite">
        {messages.clock.loading.app}
      </main>
    );
  }
  if (!authSession.data) return <SignInForm />;
  if (!authSession.data.user.canAccessClock) {
    return (
      <main className="loading-screen" aria-live="polite">
        {messages.clock.loading.backoffice}
      </main>
    );
  }
  if (isLoadingData && !clockData) {
    return (
      <main className="loading-screen" aria-live="polite">
        {messages.clock.loading.timekeeping}
      </main>
    );
  }

  async function handleRequestStaffDevice() {
    if (isRequestingStaffDevice) return;
    if (
      !(await confirm({
        title: messages.clock.confirm.deviceTitle,
        description: messages.clock.confirm.deviceDescription,
        confirmLabel: messages.clock.confirm.deviceConfirm,
      }))
    )
      return;
    setIsRequestingStaffDevice(true);
    setActionNotice(null);
    try {
      const response = await fetch("/api/staff-devices", { method: "POST" });
      const body = await response.json();
      if (!response.ok)
        throw new ClockRequestError(serverNotice(body, "deviceRequestFailed"));
      setStaffDeviceStatus(await loadStaffDeviceStatus());
      setActionNotice(
        body.status === "active"
          ? { tone: "status", key: "deviceAlreadyApproved" }
          : body.replacement
            ? { tone: "blocked", key: "deviceReplacementAwaiting" }
            : { tone: "blocked", key: "deviceEnrollmentAwaiting" },
      );
    } catch (error) {
      setActionNotice(noticeFromError(error, "deviceRequestFailed"));
    } finally {
      setIsRequestingStaffDevice(false);
    }
  }

  async function handleClockAction() {
    if (!selectedOutlet || isCheckingLocation) return;
    if (isDeviceBlocked) {
      setActionNotice({ tone: "blocked", key: "browserNotApproved" });
      return;
    }
    if (!navigator.geolocation) {
      setLocationError({ outletId: selectedOutlet.id, reason: "unavailable" });
      setActionNotice({ tone: "blocked", key: "locationUnavailable" });
      return;
    }

    if (
      !(await confirm({
        title: isClockedIn
          ? messages.clock.confirm.clockOutTitle
          : messages.clock.confirm.clockInTitle,
        description: messages.clock.confirm.clockDescription,
        confirmLabel: isClockedIn
          ? messages.clock.actions.clockOut
          : messages.clock.actions.clockIn,
      }))
    )
      return;
    setIsCheckingLocation(true);
    setClockBlockInfo(null);
    setActionNotice({ tone: "status", key: "checkingLocation" });
    let stage: "location" | "recording" | "refreshing" = "location";
    try {
      const fix = await requestCurrentLocation(navigator.geolocation);
      setLocationFix({ ...fix, outletId: selectedOutlet.id });
      setLocationError(null);
      stage = "recording";
      setActionNotice({ tone: "status", key: "recordingAction" });
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
        setActionNotice(serverNotice(result, "recordFailed"));
        return;
      }

      stage = "refreshing";
      setActionNotice({ tone: "status", key: "refreshingShift" });
      setClockData(await loadClockData());
      setActionNotice(null);
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
      setActionNotice(
        stage === "location"
          ? locationFailureNotice(error)
          : stage === "refreshing"
            ? { tone: "blocked", key: "refreshFailed" }
            : { tone: "blocked", key: "recordUnconfirmed" },
      );
    } finally {
      setIsCheckingLocation(false);
    }
  }

  async function handleBreakAction() {
    if (!selectedOutlet || !activeSession || isCheckingLocation) return;
    const action = isOnBreak ? "end_break" : "start_break";
    if (
      !(await confirm({
        title: isOnBreak
          ? messages.clock.confirm.breakEndTitle
          : messages.clock.confirm.breakStartTitle,
        description: messages.clock.confirm.breakDescription,
        confirmLabel: isOnBreak
          ? messages.clock.actions.endBreak
          : messages.clock.actions.startBreak,
      }))
    )
      return;
    setIsCheckingLocation(true);
    setActionNotice({
      tone: "status",
      key: isOnBreak ? "endingBreak" : "startingBreak",
    });
    try {
      const response = await fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ action, outletId: selectedOutlet.id }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new ClockRequestError(serverNotice(result, "breakFailed"));
      setClockData(await loadClockData());
      setActionNotice(null);
    } catch (error) {
      setActionNotice(noticeFromError(error, "breakFailed"));
    } finally {
      setIsCheckingLocation(false);
    }
  }

  const clockParts = splitClockTime(
    currentTime && selectedOutlet
      ? formatDate(locale, currentTime, selectedOutlet.timezone, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : "--:--",
  );

  return (
    <>
      <main className="page-content" id="clock">
        <section
          className="clock-layout"
          aria-label={messages.clock.shifts.detailsLabel}
        >
          <div className="clock-column">
            <article
              className={`clock-panel is-${isOnBreak ? "break" : isClockedIn ? "active" : "ready"}${isDeviceBlocked ? " is-device-blocked" : ""}`}
            >
              <div
                className={`clock-status-card is-${isOnBreak ? "break" : isClockedIn ? "active" : "ready"}`}
              >
                <span
                  className={`live-indicator clock-status is-${isOnBreak ? "break" : isClockedIn ? "active" : "ready"}`}
                >
                  <i />
                  {isOnBreak
                    ? messages.clock.status.onBreak
                    : isClockedIn
                      ? messages.clock.status.shiftInProgress
                      : messages.clock.status.readyToStart}
                </span>
                {isClockedIn &&
                  clockedInAt &&
                  currentTime &&
                  selectedOutlet && (
                    <dl className="clock-shift-meta">
                      <div>
                        <dt>{messages.clock.status.started}</dt>
                        <dd>
                          {formatDate(
                            locale,
                            clockedInAt,
                            selectedOutlet.timezone,
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>{messages.clock.status.worked}</dt>
                        <dd>
                          {formatDuration(
                            messages,
                            clockedInAt.toISOString(),
                            currentTime,
                            activeSessionBreaks,
                          )}
                        </dd>
                      </div>
                      {activeBreak && (
                        <div>
                          <dt>{messages.clock.status.onBreakLabel}</dt>
                          <dd>
                            {formatMinutes(
                              messages,
                              getElapsedMinutes(
                                activeBreak.startedAt,
                                currentTime,
                              ),
                            )}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}
              </div>
              <div className="clock-face">
                <span className="clock-time">
                  {clockParts.time}
                  {clockParts.period && <span>{clockParts.period}</span>}
                </span>
                {selectedOutlet &&
                  deviceTimeZone &&
                  deviceTimeZone !== selectedOutlet.timezone && (
                    <p className="clock-timezone">
                      {format(messages.clock.timezoneNotice, {
                        timezone: selectedOutlet.timezone,
                      })}
                    </p>
                  )}
              </div>
              <div className="clock-actions">
                {nextStepText && (
                  <p className="clock-next-step">{nextStepText}</p>
                )}
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
                  {isCheckingLocation
                    ? isOnBreak
                      ? messages.clock.actions.resuming
                      : messages.clock.actions.checkingLocation
                    : shouldRequestManual
                      ? isClockedIn
                        ? messages.clock.actions.manualClockOut
                        : messages.clock.actions.manualClockIn
                      : isOnBreak
                        ? messages.clock.actions.resumeShift
                        : isClockedIn
                          ? messages.clock.actions.clockOut
                          : messages.clock.actions.clockIn}
                </button>
                {isClockedIn && !isOnBreak && (
                  <button
                    className="btn btn-secondary btn-block btn-spaced"
                    type="button"
                    onClick={() => void handleBreakAction()}
                    disabled={
                      isDeviceBlocked || isCheckingLocation || isLoadingData
                    }
                  >
                    {isCheckingLocation
                      ? messages.clock.actions.savingBreak
                      : messages.clock.actions.startBreak}
                  </button>
                )}
              </div>
              {actionNotice && (
                <p
                  className={`clock-action-feedback${isCheckingLocation || actionNotice.tone === "status" ? "" : " is-blocked"}`}
                  role={
                    isCheckingLocation || actionNotice.tone === "status"
                      ? "status"
                      : "alert"
                  }
                >
                  {noticeText(messages, actionNotice)}
                </p>
              )}
              <div className="clock-checks" role="status" aria-live="polite">
                <ClockCheckItem
                  label={messages.clock.checks.gps}
                  check={gpsCheck}
                >
                  {canRetryLocation && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={retryLocation}
                    >
                      {messages.clock.actions.retryLocation}
                    </button>
                  )}
                </ClockCheckItem>
                {isDeviceRequired && (
                  <ClockCheckItem
                    label={messages.clock.checks.device}
                    check={deviceCheck}
                  >
                    {!staffDeviceStatus?.currentBrowserApproved && (
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={isRequestingStaffDevice}
                        onClick={() => void handleRequestStaffDevice()}
                      >
                        {isRequestingStaffDevice
                          ? messages.clock.actions.requesting
                          : staffDeviceStatus?.status === "active"
                            ? messages.clock.actions.requestThisBrowser
                            : staffDeviceStatus?.currentBrowserHasPendingRequest
                              ? messages.clock.actions.checkEnrollment
                              : staffDeviceStatus?.status === "pending" ||
                                  staffDeviceStatus?.status ===
                                    "replacement_pending"
                                ? messages.clock.actions.checkPending
                                : messages.clock.actions.requestEnrollment}
                      </button>
                    )}
                  </ClockCheckItem>
                )}
              </div>
            </article>
          </div>

          <aside className="day-column">
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
              <h2>{messages.clock.shifts.heading}</h2>
            </div>
            <Link className="text-link" href="/clock/history">
              {messages.clock.shifts.viewAll} <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="clock-recent-list">
            {clockData?.recentSessions.slice(0, 3).map((record) => (
              <article className="clock-recent-row" key={record.id}>
                <div className="clock-recent-outlet">
                  <strong>
                    {formatDate(locale, record.clockInAt, record.timezone, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </strong>
                  <span>{record.outletName}</span>
                </div>
                <div className="clock-recent-times">
                  <span>
                    <small>{messages.clock.timeIn}</small>
                    {formatDate(locale, record.clockInAt, record.timezone, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>
                    <small>{messages.clock.timeOut}</small>
                    {record.clockOutAt
                      ? formatDate(locale, record.clockOutAt, record.timezone, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : messages.clock.inProgress}
                  </span>
                </div>
                <strong className="clock-recent-duration">
                  {record.clockOutAt
                    ? formatDuration(
                        messages,
                        record.clockInAt,
                        record.clockOutAt,
                        record.breaks,
                      )
                    : isClockedIn && currentTime
                      ? formatDuration(
                          messages,
                          record.clockInAt,
                          currentTime,
                          record.breaks,
                        )
                      : "—"}
                  <small className="clock-recent-break-duration">
                    {format(messages.clock.breakTotal, {
                      duration: formatMinutes(
                        messages,
                        getCompletedBreakMinutes(record.breaks) +
                          (record.id === activeSession?.id &&
                          activeBreak &&
                          currentTime
                            ? getElapsedMinutes(
                                activeBreak.startedAt,
                                currentTime,
                              )
                            : 0),
                      ),
                    })}
                  </small>
                </strong>
              </article>
            ))}
            {!clockData?.recentSessions.length && (
              <p className="empty-table">{messages.clock.shifts.empty}</p>
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
              }}
            />
          )}
        </section>
      </main>
      {confirmDialog}
    </>
  );
}
