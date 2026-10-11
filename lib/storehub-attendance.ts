import "server-only";

import {
  normalizeStoreHubTimesheets,
  type StoreHubShift,
} from "@/lib/storehub-attendance-data";
import {
  getStoreHubConnection,
  type StoreHubConnection,
} from "@/lib/storehub-connections";
import { StoreHubClient, type FetchLike } from "@pyyupsk/storehub";

export type StoreHubAttendanceResult = {
  status: "not_configured" | "available" | "unavailable";
  rows: StoreHubShift[];
  fetchedAt: string | null;
};

type OutletIdentity = {
  id: string;
  name: string;
  timezone: string;
};

type StoreHubDateRange = {
  from?: Date;
  to?: Date;
};

let requestQueue = Promise.resolve();
let nextRequestAt = 0;

const fetcher: FetchLike = (input, init) => {
  const request = requestQueue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    nextRequestAt = Date.now() + 350;
    return fetch(input, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
  });
  requestQueue = request.then(
    () => undefined,
    () => undefined,
  );
  return request;
};

function createStoreHubClient(
  connection: Pick<StoreHubConnection, "storeName" | "apiToken">,
) {
  return new StoreHubClient({
    storeName: connection.storeName,
    apiToken: connection.apiToken,
    fetcher,
  });
}

/** Confirms the account token works and the POS store can be queried. */
export async function verifyStoreHubCredentials(
  connection: StoreHubConnection,
) {
  try {
    const client = createStoreHubClient(connection);
    const now = Date.now();
    await Promise.all([
      client.getEmployees(),
      client.getTimesheets({
        storeId: connection.posStoreId,
        from: new Date(now - 24 * 60 * 60 * 1000),
        to: new Date(now),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function getStoreHubAttendance(
  outlet: OutletIdentity,
  range: StoreHubDateRange = {},
): Promise<StoreHubAttendanceResult> {
  try {
    const connection = await getStoreHubConnection(outlet.id);
    if (!connection) {
      return { status: "not_configured", rows: [], fetchedAt: null };
    }

    const client = createStoreHubClient(connection);
    const [timesheets, employees] = await Promise.all([
      client.getTimesheets({
        storeId: connection.posStoreId,
        from: range.from,
        to: range.to,
      }),
      client.getEmployees(),
    ]);
    const storeTimesheets = timesheets.filter(
      (timesheet) => timesheet.storeId === connection.posStoreId,
    );
    return {
      status: "available",
      rows: normalizeStoreHubTimesheets(storeTimesheets, employees, outlet),
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return { status: "unavailable", rows: [], fetchedAt: null };
  }
}

/** Combines per-outlet results. Any failed outlet marks the combined result unavailable. */
export function mergeStoreHubAttendance(
  results: StoreHubAttendanceResult[],
): StoreHubAttendanceResult {
  const linked = results.filter((result) => result.status !== "not_configured");
  if (!linked.length) {
    return { status: "not_configured", rows: [], fetchedAt: null };
  }
  const fetchedAt =
    linked
      .map((result) => result.fetchedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  return {
    status: linked.some((result) => result.status === "unavailable")
      ? "unavailable"
      : "available",
    rows: linked.flatMap((result) => result.rows),
    fetchedAt,
  };
}
