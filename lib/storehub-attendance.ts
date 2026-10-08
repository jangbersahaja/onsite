import "server-only";

import {
  normalizeStoreHubTimesheets,
  type StoreHubShift,
} from "@/lib/storehub-attendance-data";
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

function getStoreHubConfig() {
  const storeName = process.env.STOREHUB_STORE_NAME;
  const apiToken = process.env.STOREHUB_API_TOKEN;
  const outletId = process.env.STOREHUB_OUTLET_ID;
  const storeId = process.env.STOREHUB_POS_STORE_ID;
  if (!storeName || !apiToken || !outletId || !storeId) return null;
  return { storeName, apiToken, outletId, storeId };
}

export function getConfiguredStoreHubOutletId() {
  return getStoreHubConfig()?.outletId ?? null;
}

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

export async function getStoreHubAttendance(
  outlet: OutletIdentity,
  range: StoreHubDateRange = {},
): Promise<StoreHubAttendanceResult> {
  const config = getStoreHubConfig();
  if (!config || config.outletId !== outlet.id) {
    return { status: "not_configured", rows: [], fetchedAt: null };
  }

  try {
    const client = new StoreHubClient({
      storeName: config.storeName,
      apiToken: config.apiToken,
      fetcher,
    });
    const [timesheets, employees] = await Promise.all([
      client.getTimesheets({
        storeId: config.storeId,
        from: range.from,
        to: range.to,
      }),
      client.getEmployees(),
    ]);
    const storeTimesheets = timesheets.filter(
      (timesheet) => timesheet.storeId === config.storeId,
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
