"use client";

import { SetupScreen } from "@/app/setup-screen";
import { SignInForm } from "@/app/sign-in-form";
import {
  WorkspaceShell,
  type WorkspaceNavigationGroup,
} from "@/app/workspace-shell";
import { authClient } from "@/lib/auth-client";
import { useEffect, useState, type FormEvent } from "react";

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

type ClockPageData = {
  user: {
    id: string;
    name: string;
    email: string;
    globalRole: "member" | "admin";
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
    fetch(`/api/clock${query ? `?${query}` : ""}`, { cache: "no-store" }),
    fetch("/api/corrections", { cache: "no-store" }),
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

function outletTimeToISOString(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Enter a valid requested time.");
  const target = match.slice(1).map(Number);
  const targetUtc = Date.UTC(
    target[0],
    target[1] - 1,
    target[2],
    target[3],
    target[4],
  );
  let candidate = targetUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .map((part) => [part.type, part.value]),
    );
    const observedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    const difference = targetUtc - observedUtc;
    if (difference === 0) return new Date(candidate).toISOString();
    candidate += difference;
  }

  throw new Error("That local time does not exist in the outlet timezone.");
}

export default function Home() {
  const authSession = authClient.useSession();
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [clockData, setClockData] = useState<ClockPageData | null>(null);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [isFilteringHistory, setIsFilteringHistory] = useState(false);
  const [isCheckingLocation, setIsCheckingLocation] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionEvent, setCorrectionEvent] = useState<
    "clock_in" | "clock_out"
  >("clock_in");
  const [correctionTime, setCorrectionTime] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionSessionId, setCorrectionSessionId] = useState("");
  const [correctionMessage, setCorrectionMessage] = useState("");
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);
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
  if (isLoadingData && !clockData) {
    return (
      <main className="loading-screen" aria-live="polite">
        Loading your timekeeping data…
      </main>
    );
  }

  function handleClockAction() {
    if (!selectedOutlet || isCheckingLocation) return;
    if (!navigator.geolocation) {
      setActionMessage(
        "Location is unavailable. Ask your outlet lead to review your time.",
      );
      return;
    }

    setIsCheckingLocation(true);
    setActionMessage("Checking your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const response = await fetch("/api/clock", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: isClockedIn ? "clock_out" : "clock_in",
                outletId: selectedOutlet.id,
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
              }),
            });
            const result = await response.json();
            if (!response.ok) {
              setActionMessage(
                result.error ?? "Clock action could not be recorded.",
              );
              return;
            }

            setClockData(await loadClockData());
            setActionMessage(
              "Clock action recorded with server time and location evidence.",
            );
          } catch {
            setActionMessage(
              "Could not reach the timekeeping service. Try again.",
            );
          } finally {
            setIsCheckingLocation(false);
          }
        })();
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Ask your outlet lead to review your time."
            : "We could not get a reliable location. Ask your outlet lead to review your time.";
        setActionMessage(message);
        setIsCheckingLocation(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  }

  async function handleCorrectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOutlet || isSubmittingCorrection) return;

    setIsSubmittingCorrection(true);
    setCorrectionMessage("");
    try {
      const requestedAt = outletTimeToISOString(
        correctionTime,
        selectedOutlet.timezone,
      );
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: selectedOutlet.id,
          workSessionId: correctionSessionId || null,
          event: correctionEvent,
          requestedAt,
          reason: correctionReason,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not submit the request.");

      setClockData(await loadClockData());
      setCorrectionTime("");
      setCorrectionReason("");
      setCorrectionSessionId("");
      setCorrectionMessage("Request submitted for outlet review.");
    } catch (error) {
      setCorrectionMessage(
        error instanceof Error
          ? error.message
          : "Could not submit the request.",
      );
    } finally {
      setIsSubmittingCorrection(false);
    }
  }

  async function handleHistoryFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isFilteringHistory) return;
    setIsFilteringHistory(true);
    setHistoryMessage("");
    try {
      const data = await loadClockData({ from: historyFrom, to: historyTo });
      setClockData(data);
    } catch (error) {
      setHistoryMessage(
        error instanceof Error
          ? error.message
          : "Could not load shift history.",
      );
    } finally {
      setIsFilteringHistory(false);
    }
  }

  async function clearHistoryFilter() {
    setHistoryFrom("");
    setHistoryTo("");
    setHistoryMessage("");
    try {
      setClockData(await loadClockData());
    } catch (error) {
      setHistoryMessage(
        error instanceof Error
          ? error.message
          : "Could not load shift history.",
      );
    }
  }

  const canManage = Boolean(
    clockData?.user.globalRole === "admin" ||
    clockData?.outlets.some((outlet) => outlet.role === "manager"),
  );
  const navigation: WorkspaceNavigationGroup[] = [
    {
      label: "MY TIME",
      items: [
        { href: "/#clock", label: "Clock", glyph: "◷" },
        { href: "/#history", label: "My history", glyph: "▤" },
        {
          href: "/#requests",
          label: "My requests",
          glyph: "↗",
          count: pendingCorrectionCount,
        },
      ],
    },
    ...(canManage
      ? [
          {
            label: "MANAGE",
            items: [
              { href: "/timesheets", label: "Timesheets", glyph: "▦" },
              {
                href: "/corrections/review",
                label: "Review requests",
                glyph: "↗",
              },
              { href: "/team", label: "Team", glyph: "♙" },
            ],
          },
        ]
      : []),
  ];

  return (
    <WorkspaceShell
      activeHref="/#clock"
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
          <button className="date-control" type="button">
            <span aria-hidden="true">▦</span> Today{" "}
            <span className="switcher-chevron" aria-hidden="true">
              ⌄
            </span>
          </button>
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
                onClick={handleClockAction}
                disabled={
                  !selectedOutlet || isCheckingLocation || isLoadingData
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
              <p className="clock-hint" aria-live="polite">
                {actionMessage ||
                  "Every clock action is checked against your assigned outlet."}
              </p>
            </article>

            <article className="shift-strip">
              <div className="strip-heading">
                <div>
                  <p className="eyebrow">OUTLET ASSIGNMENT</p>
                  <h2>{selectedOutlet?.name ?? "No outlet assigned"}</h2>
                </div>
                <span className="shift-status">
                  {selectedOutlet?.role ?? "Unassigned"}
                </span>
              </div>
              <div className="shift-details">
                <div>
                  <span className="detail-label">CLOCKING RADIUS</span>
                  <strong>
                    {selectedOutlet
                      ? `${selectedOutlet.radiusMeters} metres`
                      : "Not set"}
                  </strong>
                </div>
                <div>
                  <span className="detail-label">TIMEZONE</span>
                  <strong>{selectedOutlet?.timezone ?? "Not set"}</strong>
                </div>
                <div>
                  <span className="detail-label">ADDRESS</span>
                  <strong>{selectedOutlet?.address ?? "Not set"}</strong>
                </div>
              </div>
            </article>
          </div>

          <aside className="day-column">
            <div className="day-summary">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">LIVE STATUS</p>
                  <h2>Your day</h2>
                </div>
                <span className="small-menu" aria-hidden="true">
                  ···
                </span>
              </div>
              <div className="day-total">
                <strong>
                  {isClockedIn && clockedInAt && currentTime
                    ? formatDuration(clockedInAt.toISOString(), currentTime)
                    : "0h 00m"}
                </strong>
                <span>hours worked</span>
              </div>
              <div className="progress-track">
                <span />
              </div>
              <div className="progress-caption">
                <span>{isClockedIn ? "Current shift" : "No active shift"}</span>
                <span>{selectedOutlet?.name ?? ""}</span>
              </div>
              <div className="timeline">
                <div className="timeline-entry">
                  <span
                    className={`timeline-marker${isClockedIn ? " completed" : " upcoming"}`}
                  />
                  <div>
                    <strong>Clock in</strong>
                    <small>
                      {isClockedIn ? "Clock recorded" : "Not started"}
                    </small>
                  </div>
                  <time>
                    {clockedInAt && selectedOutlet
                      ? formatDate(clockedInAt, selectedOutlet.timezone, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </time>
                </div>
                <div className="timeline-entry">
                  <span className="timeline-marker muted" />
                  <div>
                    <strong>Clock out</strong>
                    <small>
                      {isClockedIn
                        ? "When your shift ends"
                        : "After your shift"}
                    </small>
                  </div>
                  <time>—</time>
                </div>
              </div>
            </div>

            <button
              className="help-row"
              type="button"
              aria-expanded={showCorrectionForm}
              onClick={() => setShowCorrectionForm((isOpen) => !isOpen)}
            >
              <span className="help-mark">?</span>
              <div>
                <strong>Something not right?</strong>
                <small>
                  {showCorrectionForm
                    ? "Close request form"
                    : "Request a time correction"}
                </small>
              </div>
              <span className="help-arrow">→</span>
            </button>
          </aside>
        </section>

        <section className="recent-section" id="history">
          <div className="section-heading">
            <div>
              <p className="eyebrow">RECENT ACTIVITY</p>
              <h2>Recent shifts</h2>
            </div>
            <form className="history-filter" onSubmit={handleHistoryFilter}>
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={historyFrom}
                  onChange={(event) => setHistoryFrom(event.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={historyTo}
                  onChange={(event) => setHistoryTo(event.target.value)}
                />
              </label>
              <button type="submit" disabled={isFilteringHistory}>
                {isFilteringHistory ? "Loading…" : "Filter"}
              </button>
              {(historyFrom || historyTo) && (
                <button
                  className="history-filter-clear"
                  type="button"
                  onClick={() => void clearHistoryFilter()}
                >
                  Clear
                </button>
              )}
            </form>
          </div>
          {historyMessage && (
            <p className="team-message" role="status">
              {historyMessage}
            </p>
          )}
          <div className="activity-table-wrap">
            <table className="activity-table">
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>OUTLET</th>
                  <th>CLOCK IN</th>
                  <th>CLOCK OUT</th>
                  <th>HOURS</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {clockData?.recentSessions.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <strong>
                        {formatDate(record.clockInAt, record.timezone, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </strong>
                      <small>{record.outletName}</small>
                    </td>
                    <td>
                      <span className="table-outlet">
                        {record.outletName.slice(0, 1)}
                      </span>
                      {record.outletName}
                    </td>
                    <td>
                      {formatDate(record.clockInAt, record.timezone, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>
                      {record.clockOutAt
                        ? formatDate(record.clockOutAt, record.timezone, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td>
                      <strong>
                        {record.clockOutAt
                          ? formatDuration(record.clockInAt, record.clockOutAt)
                          : isClockedIn && currentTime
                            ? formatDuration(record.clockInAt, currentTime)
                            : "—"}
                      </strong>
                    </td>
                    <td>
                      <span
                        className={`record-status${record.clockOutAt ? " approved" : " review"}`}
                      >
                        <i />
                        {record.clockOutAt ? "Recorded" : "In progress"}
                      </span>
                    </td>
                  </tr>
                ))}
                {!clockData?.recentSessions.length && (
                  <tr>
                    <td colSpan={6} className="empty-table">
                      No clock records yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="correction-section" id="requests">
          {showCorrectionForm && (
            <form className="correction-form" onSubmit={handleCorrectionSubmit}>
              <div className="correction-form-heading">
                <div>
                  <p className="eyebrow">TIME ADJUSTMENT</p>
                  <h2>Request a correction</h2>
                </div>
                <span>{selectedOutlet?.timezone ?? "Outlet time"}</span>
              </div>
              <label>
                Outlet
                <select
                  value={selectedOutlet?.id ?? ""}
                  onChange={(event) => setSelectedOutletId(event.target.value)}
                  required
                >
                  {clockData?.outlets.map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="correction-form-row">
                <label>
                  Event
                  <select
                    value={correctionEvent}
                    onChange={(event) =>
                      setCorrectionEvent(
                        event.target.value as "clock_in" | "clock_out",
                      )
                    }
                  >
                    <option value="clock_in">Clock in</option>
                    <option value="clock_out">Clock out</option>
                  </select>
                </label>
                <label>
                  Requested time
                  <input
                    type="datetime-local"
                    value={correctionTime}
                    onChange={(event) => setCorrectionTime(event.target.value)}
                    required
                  />
                </label>
              </div>
              <label>
                Related shift
                <select
                  value={correctionSessionId}
                  onChange={(event) =>
                    setCorrectionSessionId(event.target.value)
                  }
                >
                  <option value="" disabled={correctionEvent === "clock_out"}>
                    Missing clock-in event
                  </option>
                  {clockData?.recentSessions
                    .filter((record) => record.outletId === selectedOutlet?.id)
                    .map((record) => (
                      <option key={record.id} value={record.id}>
                        {record.outletName} ·{" "}
                        {formatDate(record.clockInAt, record.timezone, {
                          day: "numeric",
                          month: "short",
                        })}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Reason
                <textarea
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  minLength={5}
                  maxLength={1000}
                  rows={3}
                  placeholder="Tell your outlet lead what happened."
                  required
                />
              </label>
              <div className="correction-form-footer">
                <p className="correction-message" aria-live="polite">
                  {correctionMessage}
                </p>
                <button
                  className="auth-submit"
                  type="submit"
                  disabled={isSubmittingCorrection || !selectedOutlet}
                >
                  {isSubmittingCorrection ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </form>
          )}
          {clockData?.correctionRequests.length ? (
            <div className="correction-list">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">YOUR REQUESTS</p>
                  <h2>Correction history</h2>
                </div>
              </div>
              {clockData.correctionRequests.map((request) => (
                <article className="correction-item" key={request.id}>
                  <div>
                    <strong>
                      {request.event === "clock_in" ? "Clock-in" : "Clock-out"}{" "}
                      · {request.outletName}
                    </strong>
                    <small>
                      {formatDate(request.requestedAt, request.timezone, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {request.reason}
                    </small>
                    {request.reviewReason && (
                      <small className="review-reason">
                        Review: {request.reviewReason}
                      </small>
                    )}
                  </div>
                  <span className={`correction-status ${request.status}`}>
                    {request.status}
                  </span>
                </article>
              ))}
            </div>
          ) : null}
        </section>
        <p className="preview-note">
          <span>i</span> Clock records use server time and location evidence.
          Browser GPS can be spoofed.
        </p>
      </main>
    </WorkspaceShell>
  );
}
