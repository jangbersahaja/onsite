"use client";

import { useLocale } from "@/app/_components/locale-provider";
import { useReportClockWorkspace } from "@/app/clock/_components/clock-workspace";
import { ShiftCorrectionDialog } from "@/app/clock/_components/shift-correction-dialog";
import { SignInForm } from "@/app/clock/_components/sign-in-form";
import { authClient } from "@/lib/auth-client";
import type { CorrectionEvent } from "@/lib/break-corrections";
import { localeTags } from "@/lib/i18n/config";
import { errorMessage, type ErrorText } from "@/lib/i18n/errors";
import { format } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import { getCompletedBreakMinutes, getWorkedMinutes } from "@/lib/work-breaks";
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
};

type HistoryShift = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string | null;
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
};

type HistoryRequest = {
  id: string;
  outletId: string;
  outletName: string;
  timezone: string;
  event: CorrectionEvent;
  requestedAt: string;
  reason: string;
  status: "reconciliation" | "approved" | "rejected";
  reviewReason: string | null;
  createdAt: string;
};

type HistoryPageData = {
  outlets: HistoryOutlet[];
  recentSessions: HistoryShift[];
  historyPage: { hasMore: boolean; nextOffset: number | null };
};

function correctionEventLabel(event: CorrectionEvent, messages: Messages) {
  switch (event) {
    case "clock_in":
      return messages.history.request.clockIn;
    case "clock_out":
      return messages.history.request.clockOut;
    case "break_update":
      return messages.dialogs.correction.eventBreakUpdate;
    case "break_add":
      return messages.dialogs.correction.eventBreakAdd;
    case "break_delete":
      return messages.dialogs.correction.eventBreakDelete;
  }
}

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
  localeTag: string,
) {
  return new Intl.DateTimeFormat(localeTag, {
    ...options,
    timeZone: timezone,
  }).format(new Date(value));
}

function formatMinutes(minutes: number, template: string) {
  return format(template, {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, "0"),
  });
}

class HistoryLoadError extends Error {
  code: string | null;

  constructor(code: string | null, text: string) {
    super(text);
    this.code = code;
  }
}

function toErrorText(error: unknown): ErrorText {
  if (error instanceof HistoryLoadError) {
    return { code: error.code, text: error.message };
  }
  return { text: error instanceof Error ? error.message : "" };
}

function getGrossMinutes(clockInAt: string, clockOutAt: string | null) {
  if (!clockOutAt) return null;
  return Math.max(
    0,
    Math.floor(
      (new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 60_000,
    ),
  );
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
    throw new HistoryLoadError(
      clockBody.code ?? null,
      String(clockBody.error ?? ""),
    );
  const correctionError = correctionResponse.ok
    ? null
    : new HistoryLoadError(
        correctionBody.code ?? null,
        String(correctionBody.error ?? ""),
      );
  return {
    ...(clockBody as HistoryPageData),
    correctionRequests: correctionResponse.ok
      ? (correctionBody.requests as HistoryRequest[])
      : [],
    correctionError,
  };
}

export default function ClockHistoryPage() {
  const { locale, messages } = useLocale();
  const localeTag = localeTags[locale];
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
  const [message, setMessage] = useState<ErrorText | null>(null);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const editingShift = data?.recentSessions.find(
    (shift) => shift.id === editingShiftId,
  );

  useEffect(() => {
    if (!authSession.data?.user.id || !authSession.data.user.canAccessClock)
      return;
    let active = true;
    loadHistoryPage(month, 0)
      .then((result) => {
        if (!active) return;
        setData(result);
        setRequests(result.correctionRequests);
        setMessage(
          result.correctionError ? toErrorText(result.correctionError) : null,
        );
        setSelectedOutletId(
          (current) => current || result.outlets[0]?.id || "",
        );
        setNextOffset(result.historyPage.nextOffset);
      })
      .catch((error: unknown) => {
        if (active) setMessage(toErrorText(error));
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

  const reconciliationCount = requests.filter(
    (request) => request.status === "reconciliation",
  ).length;
  const outlet = data?.outlets.find((item) => item.id === selectedOutletId);
  useReportClockWorkspace({
    pageTitle: messages.history.page.title,
    workspaceName: outlet?.name ?? messages.history.page.fallbackWorkspaceName,
    outlets: data?.outlets,
    selectedOutletId,
    onOutletChange: setSelectedOutletId,
    reconciliationCount,
  });

  async function loadMore() {
    if (nextOffset === null || isLoadingMore) return;
    setIsLoadingMore(true);
    setMessage(null);
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
      setMessage(
        result.correctionError ? toErrorText(result.correctionError) : null,
      );
      setNextOffset(result.historyPage.nextOffset);
    } catch (error) {
      setMessage(toErrorText(error));
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function refreshHistory() {
    const result = await loadHistoryPage(month, 0);
    setData(result);
    setRequests(result.correctionRequests);
    setMessage(
      result.correctionError ? toErrorText(result.correctionError) : null,
    );
    setNextOffset(result.historyPage.nextOffset);
  }

  if (authSession.isPending) {
    return (
      <main className="loading-screen">
        {messages.history.states.loadingHistory}
      </main>
    );
  }
  if (!authSession.data) return <SignInForm />;
  if (!authSession.data.user.canAccessClock) {
    return (
      <main className="loading-screen">
        {messages.history.states.openingBackoffice}
      </main>
    );
  }

  const visibleShifts = (data?.recentSessions ?? []).filter(
    (shift) => !selectedOutletId || shift.outletId === selectedOutletId,
  );
  const visibleRequests = requests.filter(
    (request) => !selectedOutletId || request.outletId === selectedOutletId,
  );
  const monthHours = visibleShifts.reduce((total, shift) => {
    const minutes = getWorkedMinutes(
      shift.clockInAt,
      shift.clockOutAt,
      shift.breaks,
    );
    return total + (minutes ?? 0);
  }, 0);

  return (
    <>
      <main className="page-content history-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{messages.history.page.eyebrow}</p>
            <h1>{messages.history.page.title}</h1>
            <p className="subheading">{messages.history.page.subheading}</p>
          </div>
        </div>

        <div className="history-controls">
          <div
            className="history-tabs"
            role="tablist"
            aria-label={messages.history.tabs.label}
          >
            <button
              className={`btn btn-ghost btn-sm${activeTab === "shifts" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === "shifts"}
              onClick={() => setActiveTab("shifts")}
            >
              {messages.history.tabs.shifts}
            </button>
            <button
              className={`btn btn-ghost btn-sm${activeTab === "requests" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === "requests"}
              onClick={() => setActiveTab("requests")}
            >
              {messages.history.tabs.requests}
              {reconciliationCount > 0 && <span>{reconciliationCount}</span>}
            </button>
          </div>
          {activeTab === "shifts" && (
            <label className="history-month-control">
              <span>{messages.history.filters.month}</span>
              <input
                type="month"
                value={month}
                onChange={(event) => {
                  setIsLoading(true);
                  setMessage(null);
                  setMonth(event.target.value);
                }}
              />
            </label>
          )}
        </div>

        {message && (
          <p className="team-message" role="status">
            {errorMessage(messages, message) ||
              messages.history.errors.loadFailed}
          </p>
        )}
        {activeTab === "shifts" ? (
          <section
            className="history-shifts"
            aria-label={messages.history.aria.shifts}
          >
            <div className="history-month-summary">
              <span>{outlet?.name ?? messages.history.summary.allOutlets}</span>
              <strong>
                {formatMinutes(monthHours, messages.history.units.hoursMinutes)}
              </strong>
              <small>{messages.history.summary.workedHours}</small>
            </div>
            {visibleShifts.map((shift) => (
              <article className="history-shift-row" key={shift.id}>
                <div className="history-shift-date">
                  <strong>
                    {formatDate(
                      shift.clockInAt,
                      shift.timezone,
                      {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      },
                      localeTag,
                    )}
                  </strong>
                  <span>{shift.outletName}</span>
                </div>
                <div className="history-shift-times">
                  <span>
                    <small>{messages.history.shift.clockIn}</small>
                    {formatDate(
                      shift.clockInAt,
                      shift.timezone,
                      { hour: "2-digit", minute: "2-digit" },
                      localeTag,
                    )}
                  </span>
                  <span>
                    <small>{messages.history.shift.clockOut}</small>
                    {shift.clockOutAt
                      ? formatDate(
                          shift.clockOutAt,
                          shift.timezone,
                          { hour: "2-digit", minute: "2-digit" },
                          localeTag,
                        )
                      : messages.history.shift.inProgress}
                  </span>
                </div>
                <strong className="history-shift-duration">
                  {getWorkedMinutes(
                    shift.clockInAt,
                    shift.clockOutAt,
                    shift.breaks,
                  ) !== null
                    ? formatMinutes(
                        getWorkedMinutes(
                          shift.clockInAt,
                          shift.clockOutAt,
                          shift.breaks,
                        ) ?? 0,
                        messages.history.units.hoursMinutes,
                      )
                    : messages.history.shift.inProgress}
                  <small>
                    {shift.clockOutAt
                      ? format(messages.history.shift.grossDuration, {
                          duration: formatMinutes(
                            getGrossMinutes(
                              shift.clockInAt,
                              shift.clockOutAt,
                            ) ?? 0,
                            messages.history.units.hoursMinutes,
                          ),
                        })
                      : ""}
                    {format(messages.history.shift.breakDuration, {
                      duration: formatMinutes(
                        getCompletedBreakMinutes(shift.breaks),
                        messages.history.units.hoursMinutes,
                      ),
                    })}
                  </small>
                </strong>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => setEditingShiftId(shift.id)}
                >
                  {messages.history.actions.requestCorrection}
                </button>
              </article>
            ))}
            {!isLoading && visibleShifts.length === 0 && (
              <p className="history-empty">
                {messages.history.states.noShifts}
              </p>
            )}
            {isLoading && (
              <p className="history-empty">
                {messages.history.states.loadingShifts}
              </p>
            )}
            {data?.historyPage.hasMore && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
              >
                {isLoadingMore
                  ? messages.history.actions.loadingMore
                  : messages.history.actions.loadMore}
              </button>
            )}
          </section>
        ) : (
          <section
            className="history-requests"
            aria-label={messages.history.aria.requests}
          >
            {visibleRequests.map((request) => (
              <article className="history-request-row" key={request.id}>
                <div>
                  <strong>
                    {correctionEventLabel(request.event, messages)} ·{" "}
                    {request.outletName}
                  </strong>
                  <span>
                    {formatDate(
                      request.requestedAt,
                      request.timezone,
                      {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                      localeTag,
                    )}
                  </span>
                  <p>{request.reason}</p>
                  {request.reviewReason && (
                    <small>
                      {format(messages.history.request.review, {
                        reason: request.reviewReason,
                      })}
                    </small>
                  )}
                </div>
                <span className={`correction-status ${request.status}`}>
                  {messages.history.status[request.status]}
                </span>
              </article>
            ))}
            {visibleRequests.length === 0 && (
              <p className="history-empty">
                {messages.history.states.noRequests}
              </p>
            )}
          </section>
        )}
        {editingShift && (
          <ShiftCorrectionDialog
            key={editingShift.id}
            shift={editingShift}
            onOpenChange={(open) => {
              if (!open) setEditingShiftId(null);
            }}
            onSaved={async (error) => {
              await refreshHistory();
              if (error) setMessage(error);
            }}
          />
        )}
      </main>
    </>
  );
}
