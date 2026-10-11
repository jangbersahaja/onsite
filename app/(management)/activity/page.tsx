"use client";

import { AUDIT_ACTIONS } from "@/lib/audit-events";
import { useEffect, useRef, useState, type FormEvent } from "react";

type ActivityEvent = {
  id: string;
  createdAt: string;
  action: string;
  actorName: string | null;
  outletName: string | null;
  reason: string | null;
  description: string;
};

type ActivityOutlet = { id: string; name: string };

type ActivityResponse = {
  events: ActivityEvent[];
  nextBefore: string | null;
  outlets: ActivityOutlet[];
};

type Filters = {
  outletId: string;
  action: string;
  from: string;
  to: string;
};

const emptyFilters: Filters = { outletId: "", action: "", from: "", to: "" };

// Date inputs are local to the viewer, so the range is converted to instants
// in the browser's timezone before it is sent.
function startOfDayIso(date: string) {
  return new Date(`${date}T00:00:00`).toISOString();
}

function endOfDayIso(date: string) {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

function formatActionLabel(action: string) {
  const label = action.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

async function fetchActivity(
  filters: Filters,
  before?: string,
): Promise<ActivityResponse> {
  const params = new URLSearchParams();
  if (filters.outletId) params.set("outletId", filters.outletId);
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("from", startOfDayIso(filters.from));
  if (filters.to) params.set("to", endOfDayIso(filters.to));
  if (before) params.set("before", before);

  const response = await fetch(`/api/activity?${params}`, {
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not load activity.");
  return body as ActivityResponse;
}

export default function ActivityPage() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [outlets, setOutlets] = useState<ActivityOutlet[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [message, setMessage] = useState("");
  const generationRef = useRef(0);

  useEffect(() => {
    let active = true;

    async function load() {
      generationRef.current += 1;
      setIsLoading(true);
      setIsLoadingMore(false);
      setLoadMoreError("");
      setMessage("");
      try {
        const body = await fetchActivity(appliedFilters);
        if (!active) return;
        setEvents(body.events);
        setNextBefore(body.nextBefore);
        setOutlets(body.outlets);
      } catch (error) {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "Could not load activity.",
          );
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [appliedFilters]);

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(filters);
  }

  async function loadMore() {
    if (!nextBefore || isLoading || isLoadingMore) return;
    const generation = generationRef.current;
    setIsLoadingMore(true);
    setLoadMoreError("");
    try {
      const body = await fetchActivity(appliedFilters, nextBefore);
      if (generation !== generationRef.current) return;
      setEvents((current) => [...current, ...body.events]);
      setNextBefore(body.nextBefore);
    } catch (error) {
      if (generation !== generationRef.current) return;
      setLoadMoreError(
        error instanceof Error
          ? error.message
          : "Could not load more activity.",
      );
    } finally {
      if (generation === generationRef.current) setIsLoadingMore(false);
    }
  }

  return (
    <div className="team-page-content timesheet-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">AUDIT TRAIL</p>
          <h1>Activity</h1>
          <p className="subheading">
            Who did what, and where, across the outlets you manage.
          </p>
        </div>
      </div>

      <form className="timesheet-filters" onSubmit={handleFilterSubmit}>
        <label>
          Outlet
          <select
            value={filters.outletId}
            onChange={(event) =>
              setFilters({ ...filters, outletId: event.target.value })
            }
          >
            <option value="">All outlets</option>
            {outlets.map((outlet) => (
              <option value={outlet.id} key={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Activity
          <select
            value={filters.action}
            onChange={(event) =>
              setFilters({ ...filters, action: event.target.value })
            }
          >
            <option value="">All activity</option>
            {AUDIT_ACTIONS.map((action) => (
              <option value={action} key={action}>
                {formatActionLabel(action)}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters({ ...filters, from: event.target.value })
            }
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.to}
            onChange={(event) =>
              setFilters({ ...filters, to: event.target.value })
            }
          />
        </label>
        <button className="auth-submit" type="submit" disabled={isLoading}>
          Apply filters
        </button>
      </form>

      {message && (
        <p className="team-message" role="status">
          {message}
        </p>
      )}

      {events.length > 0 && (
        <div className="activity-table-wrap">
          <table className="activity-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Activity</th>
                <th>Outlet</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const createdAt = new Date(event.createdAt);
                return (
                  <tr key={event.id}>
                    <td>
                      <strong>
                        {createdAt.toLocaleTimeString("en-SG", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </strong>
                      <small>
                        {createdAt.toLocaleDateString("en-SG", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </small>
                    </td>
                    <td>
                      {event.description}
                      {event.reason && <small> · Reason: {event.reason}</small>}
                    </td>
                    <td>{event.outletName ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !message && events.length === 0 && (
        <p className="empty-table">No activity matches these filters.</p>
      )}

      {nextBefore && !isLoading && (
        <>
          {loadMoreError && (
            <p className="team-message" role="alert">
              {loadMoreError}
            </p>
          )}
          <button
            className="activity-load-more"
            type="button"
            disabled={isLoadingMore}
            aria-busy={isLoadingMore}
            onClick={() => void loadMore()}
          >
            {isLoadingMore
              ? "Loading…"
              : loadMoreError
                ? "Try again"
                : "Load more"}
          </button>
        </>
      )}
    </div>
  );
}
