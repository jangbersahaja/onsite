"use client";

import { CorrectionDialog } from "@/app/clock/correction-dialog";
import { SignInForm } from "@/app/sign-in-form";
import {
  WorkspaceShell,
  type WorkspaceNavigationGroup,
} from "@/app/workspace-shell";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type HistoryOutlet = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  timezone: string;
  role: "manager" | "supervisor" | "staff";
};

type HistoryShift = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string | null;
};

type HistoryRequest = {
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

type HistoryPageData = {
  outlets: HistoryOutlet[];
  recentSessions: HistoryShift[];
  historyPage: { hasMore: boolean; nextOffset: number | null };
};

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    from: `${month}-${"01"}`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function formatDate(
  value: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-SG", {
    ...options,
    timeZone: timezone,
  }).format(new Date(value));
}

function formatDuration(start: string, end: string) {
  const minutes = Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

async function loadHistoryPage(month: string, offset: number) {
  const range = monthBounds(month);
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    limit: "20",
    offset: String(offset),
  });
  const [clockResponse, correctionResponse] = await Promise.all([
    fetch(`/api/clock?${params}`, { cache: "no-store" }),
    fetch("/api/corrections", { cache: "no-store" }),
  ]);
  const [clockBody, correctionBody] = await Promise.all([
    clockResponse.json(),
    correctionResponse.json(),
  ]);
  if (!clockResponse.ok)
    throw new Error(clockBody.error ?? "Could not load shift history.");
  if (!correctionResponse.ok)
    throw new Error(
      correctionBody.error ?? "Could not load correction requests.",
    );
  return {
    ...(clockBody as HistoryPageData),
    correctionRequests: correctionBody.requests as HistoryRequest[],
  };
}

export default function ClockHistoryPage() {
  const authSession = authClient.useSession();
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth);
  const [activeTab, setActiveTab] = useState<"shifts" | "requests">("shifts");
  const [data, setData] = useState<HistoryPageData | null>(null);
  const [requests, setRequests] = useState<HistoryRequest[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isCorrectionDialogOpen, setIsCorrectionDialogOpen] = useState(false);
  const [correctionDefaults, setCorrectionDefaults] = useState<{
    outletId?: string;
    shiftId?: string;
    event?: "clock_in" | "clock_out";
  }>({});

  useEffect(() => {
    if (!authSession.data?.user.id || !authSession.data.user.canAccessClock)
      return;
    let active = true;
    loadHistoryPage(month, 0)
      .then((result) => {
        if (!active) return;
        setData(result);
        setRequests(result.correctionRequests);
        setSelectedOutletId(
          (current) => current || result.outlets[0]?.id || "",
        );
        setNextOffset(result.historyPage.nextOffset);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load shift history.",
          );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authSession.data?.user.id, authSession.data?.user.canAccessClock, month]);

  useEffect(() => {
    const user = authSession.data?.user;
    if (user && !user.canAccessClock && user.canAccessBackoffice) {
      router.replace("/manage");
    }
  }, [authSession.data?.user, router]);

  async function loadMore() {
    if (nextOffset === null || isLoadingMore) return;
    setIsLoadingMore(true);
    setMessage("");
    try {
      const result = await loadHistoryPage(month, nextOffset);
      setData((current) =>
        current
          ? {
              ...current,
              recentSessions: [
                ...current.recentSessions,
                ...result.recentSessions,
              ],
              historyPage: result.historyPage,
            }
          : result,
      );
      setRequests(result.correctionRequests);
      setNextOffset(result.historyPage.nextOffset);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load more shifts.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function refreshRequests() {
    const response = await fetch("/api/corrections", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Could not refresh correction requests.");
    setRequests(result.requests as HistoryRequest[]);
  }

  if (authSession.isPending) {
    return <main className="loading-screen">Loading your history…</main>;
  }
  if (!authSession.data) return <SignInForm />;
  if (!authSession.data.user.canAccessClock) {
    return <main className="loading-screen">Opening Backoffice…</main>;
  }

  const canManage = authSession.data.user.canAccessBackoffice;
  const pendingCount = requests.filter(
    (request) => request.status === "pending",
  ).length;
  const navigation: WorkspaceNavigationGroup[] = [
    {
      label: "MY TIME",
      items: [
        { href: "/clock", label: "Clock", glyph: "◷", requiredAccess: "clock" },
        {
          href: "/clock/history",
          label: "History",
          glyph: "▤",
          requiredAccess: "clock",
          count: pendingCount,
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
  const outlet = data?.outlets.find((item) => item.id === selectedOutletId);
  const visibleShifts = (data?.recentSessions ?? []).filter(
    (shift) => !selectedOutletId || shift.outletId === selectedOutletId,
  );
  const visibleRequests = requests.filter(
    (request) => !selectedOutletId || request.outletId === selectedOutletId,
  );
  const monthHours = visibleShifts.reduce((total, shift) => {
    if (!shift.clockOutAt) return total;
    const minutes = Math.max(
      0,
      Math.floor(
        (new Date(shift.clockOutAt).getTime() -
          new Date(shift.clockInAt).getTime()) /
          60_000,
      ),
    );
    return total + minutes;
  }, 0);

  return (
    <WorkspaceShell
      activeHref="/clock/history"
      pageTitle="History"
      workspaceName={outlet?.name ?? "Timekeeping"}
      outlets={data?.outlets}
      selectedOutletId={selectedOutletId}
      onOutletChange={setSelectedOutletId}
      navigation={navigation}
    >
      <main className="page-content history-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">MY TIME</p>
            <h1>History</h1>
            <p className="subheading">
              Your recorded shifts and time requests.
            </p>
          </div>
          <button
            className="team-primary-action"
            type="button"
            onClick={() => {
              setCorrectionDefaults({ outletId: selectedOutletId });
              setIsCorrectionDialogOpen(true);
            }}
          >
            Request correction
          </button>
        </div>

        <div className="history-controls">
          <div
            className="history-tabs"
            role="tablist"
            aria-label="History views"
          >
            <button
              className={activeTab === "shifts" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "shifts"}
              onClick={() => setActiveTab("shifts")}
            >
              Shifts
            </button>
            <button
              className={activeTab === "requests" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "requests"}
              onClick={() => setActiveTab("requests")}
            >
              Requests
              {pendingCount > 0 && <span>{pendingCount}</span>}
            </button>
          </div>
          {activeTab === "shifts" && (
            <label className="history-month-control">
              <span>Month</span>
              <input
                type="month"
                value={month}
                onChange={(event) => {
                  setIsLoading(true);
                  setMessage("");
                  setMonth(event.target.value);
                }}
              />
            </label>
          )}
        </div>

        {message && (
          <p className="team-message" role="status">
            {message}
          </p>
        )}
        {activeTab === "shifts" ? (
          <section className="history-shifts" aria-label="Recorded shifts">
            <div className="history-month-summary">
              <span>{outlet?.name ?? "All outlets"}</span>
              <strong>
                {Math.floor(monthHours / 60)}h{" "}
                {String(monthHours % 60).padStart(2, "0")}m
              </strong>
              <small>hours in loaded shifts</small>
            </div>
            {visibleShifts.map((shift) => (
              <article className="history-shift-row" key={shift.id}>
                <div className="history-shift-date">
                  <strong>
                    {formatDate(shift.clockInAt, shift.timezone, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </strong>
                  <span>{shift.outletName}</span>
                </div>
                <div className="history-shift-times">
                  <span>
                    <small>Clock in</small>
                    {formatDate(shift.clockInAt, shift.timezone, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>
                    <small>Clock out</small>
                    {shift.clockOutAt
                      ? formatDate(shift.clockOutAt, shift.timezone, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "In progress"}
                  </span>
                </div>
                <strong className="history-shift-duration">
                  {shift.clockOutAt
                    ? formatDuration(shift.clockInAt, shift.clockOutAt)
                    : "In progress"}
                </strong>
                <button
                  className="history-row-action"
                  type="button"
                  onClick={() => {
                    setCorrectionDefaults({
                      outletId: shift.outletId,
                      shiftId: shift.id,
                      event: "clock_in",
                    });
                    setIsCorrectionDialogOpen(true);
                  }}
                >
                  Request correction
                </button>
              </article>
            ))}
            {!isLoading && visibleShifts.length === 0 && (
              <p className="history-empty">
                No shifts recorded for this month.
              </p>
            )}
            {isLoading && <p className="history-empty">Loading shifts…</p>}
            {data?.historyPage.hasMore && (
              <button
                className="history-load-more"
                type="button"
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? "Loading…" : "Load more shifts"}
              </button>
            )}
          </section>
        ) : (
          <section
            className="history-requests"
            aria-label="Correction requests"
          >
            {visibleRequests.map((request) => (
              <article className="history-request-row" key={request.id}>
                <div>
                  <strong>
                    {request.event === "clock_in" ? "Clock-in" : "Clock-out"} ·{" "}
                    {request.outletName}
                  </strong>
                  <span>
                    {formatDate(request.requestedAt, request.timezone, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <p>{request.reason}</p>
                  {request.reviewReason && (
                    <small>Review: {request.reviewReason}</small>
                  )}
                </div>
                <span className={`correction-status ${request.status}`}>
                  {request.status}
                </span>
              </article>
            ))}
            {visibleRequests.length === 0 && (
              <p className="history-empty">
                No correction requests for this outlet.
              </p>
            )}
          </section>
        )}
        {isCorrectionDialogOpen && (
          <CorrectionDialog
            open
            outlets={data?.outlets ?? []}
            shifts={data?.recentSessions ?? []}
            initialOutletId={correctionDefaults.outletId}
            initialShiftId={correctionDefaults.shiftId}
            initialEvent={correctionDefaults.event}
            onOpenChange={setIsCorrectionDialogOpen}
            onSubmitted={refreshRequests}
          />
        )}
      </main>
    </WorkspaceShell>
  );
}
