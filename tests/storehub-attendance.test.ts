import {
  filterStoreHubTimesheets,
  normalizeStoreHubTimesheets,
  storeHubShiftOverlapsWindow,
} from "@/lib/storehub-attendance-data";
import type { Employee, Timesheet } from "@pyyupsk/storehub";
import assert from "node:assert/strict";
import test from "node:test";

const outlet = {
  id: "outlet-id",
  name: "Gembira Momento",
  timezone: "Asia/Kuala_Lumpur",
};

test("normalizes StoreHub attendance and leaves open duration unknown", () => {
  const timesheets: Timesheet[] = [
    {
      storeId: "pos-store-id",
      employeeId: "employee-1",
      clockInTime: "2026-10-06T09:00:00+08:00",
      clockOutTime: "2026-10-06T17:30:00+08:00",
    },
    {
      storeId: "pos-store-id",
      employeeId: "employee-2",
      clockInTime: "2026-10-06T10:00:00Z",
      clockOutTime: "",
    },
  ];
  const employees: Employee[] = [
    {
      id: "employee-1",
      firstName: "Ari",
      lastName: "Tan",
      email: "ari@example.com",
      phone: "",
      createdTime: "",
      modifiedTime: "",
    },
  ];

  const rows = normalizeStoreHubTimesheets(timesheets, employees, outlet);

  assert.equal(rows[0].employeeName, "Ari Tan");
  assert.equal(rows[0].clockInAt, "2026-10-06T01:00:00.000Z");
  assert.equal(rows[0].clockOutAt, "2026-10-06T09:30:00.000Z");
  assert.equal(rows[0].breakMinutes, 0);
  assert.equal(rows[0].workedMinutes, 510);
  assert.deepEqual(rows[0].breaks, []);
  assert.equal(rows[0].sessionCount, 1);
  assert.equal(rows[0].source, "storehub");
  assert.equal(rows[1].employeeName, "StoreHub employee employee-2");
  assert.equal(rows[1].clockOutAt, null);
  assert.equal(rows[1].breakMinutes, 0);
  assert.equal(rows[1].workedMinutes, null);
});

test("joins same-day sessions and treats the gap as a break", () => {
  const timesheets: Timesheet[] = [
    {
      storeId: "pos-store-id",
      employeeId: "employee-1",
      clockInTime: "2026-10-06T09:00:00+08:00",
      clockOutTime: "2026-10-06T12:00:00+08:00",
    },
    {
      storeId: "pos-store-id",
      employeeId: "employee-1",
      clockInTime: "2026-10-06T13:00:00+08:00",
      clockOutTime: "2026-10-06T17:00:00+08:00",
    },
  ];

  const rows = normalizeStoreHubTimesheets(timesheets, [], outlet);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].clockInAt, "2026-10-06T01:00:00.000Z");
  assert.equal(rows[0].clockOutAt, "2026-10-06T09:00:00.000Z");
  assert.equal(rows[0].sessionCount, 2);
  assert.equal(rows[0].breakMinutes, 60);
  assert.equal(rows[0].workedMinutes, 420);
  assert.deepEqual(rows[0].breaks, [
    {
      id: `${rows[0].id}:break:1`,
      startedAt: "2026-10-06T04:00:00.000Z",
      endedAt: "2026-10-06T05:00:00.000Z",
    },
  ]);
});

test("keeps known completed breaks when the latest session is still open", () => {
  const rows = normalizeStoreHubTimesheets(
    [
      {
        storeId: "pos-store-id",
        employeeId: "employee-1",
        clockInTime: "2026-10-06T09:00:00+08:00",
        clockOutTime: "2026-10-06T12:00:00+08:00",
      },
      {
        storeId: "pos-store-id",
        employeeId: "employee-1",
        clockInTime: "2026-10-06T13:00:00+08:00",
        clockOutTime: "",
      },
    ],
    [],
    outlet,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].clockOutAt, null);
  assert.equal(rows[0].breakMinutes, 60);
  assert.equal(rows[0].workedMinutes, null);
});

test("groups pre-6 a.m. sessions under the prior outlet workday", () => {
  const rows = normalizeStoreHubTimesheets(
    [
      {
        storeId: "pos-store-id",
        employeeId: "employee-1",
        clockInTime: "2026-10-06T17:00:00Z",
        clockOutTime: "2026-10-06T18:00:00Z",
      },
      {
        storeId: "pos-store-id",
        employeeId: "employee-1",
        clockInTime: "2026-10-06T20:00:00Z",
        clockOutTime: "2026-10-06T22:00:00Z",
      },
    ],
    [],
    outlet,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionCount, 2);
  assert.equal(rows[0].breakMinutes, 120);
  assert.deepEqual(
    filterStoreHubTimesheets(rows, {
      from: "2026-10-06",
      to: "2026-10-06",
    }),
    rows,
  );
});

test("deduplicates identical source sessions before calculating shift metrics", () => {
  const session: Timesheet = {
    storeId: "pos-store-id",
    employeeId: "employee-1",
    clockInTime: "2026-10-06T09:00:00Z",
    clockOutTime: "2026-10-06T17:00:00Z",
  };
  const rows = normalizeStoreHubTimesheets([session, session], [], outlet);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionCount, 1);
  assert.equal(rows[0].workedMinutes, 480);
});

test("rejects invalid StoreHub timestamps rather than returning misleading rows", () => {
  const timesheet = {
    storeId: "pos-store-id",
    employeeId: "employee-1",
    clockInTime: "not-a-date",
    clockOutTime: "",
  } as Timesheet;

  assert.throws(
    () => normalizeStoreHubTimesheets([timesheet], [], outlet),
    /invalid attendance timestamp/i,
  );
});

test("filters StoreHub employees and outlet-local clock-in dates independently", () => {
  const rows = normalizeStoreHubTimesheets(
    [
      {
        storeId: "pos-store-id",
        employeeId: "employee-1",
        clockInTime: "2026-10-06T23:00:00Z",
        clockOutTime: "2026-10-07T04:00:00Z",
      },
      {
        storeId: "pos-store-id",
        employeeId: "employee-2",
        clockInTime: "2026-10-07T02:00:00Z",
        clockOutTime: "2026-10-07T08:00:00Z",
      },
    ],
    [],
    outlet,
  );

  assert.deepEqual(
    filterStoreHubTimesheets(rows, {
      employeeId: "storehub:employee-1",
      from: "2026-10-07",
      to: "2026-10-07",
    }).map((row) => row.storeHubEmployeeId),
    ["employee-1"],
  );
  assert.deepEqual(
    filterStoreHubTimesheets(rows, { employeeId: "onsite-user" }),
    [],
  );
});

test("keeps open shifts that overlap a dashboard window from the prior day", () => {
  const [shift] = normalizeStoreHubTimesheets(
    [
      {
        storeId: "pos-store-id",
        employeeId: "employee-1",
        clockInTime: "2026-10-06T20:00:00Z",
        clockOutTime: "",
      },
    ],
    [],
    outlet,
  );

  assert.equal(
    storeHubShiftOverlapsWindow(
      shift,
      new Date("2026-10-07T00:00:00Z"),
      new Date("2026-10-07T04:00:00Z"),
    ),
    true,
  );
  assert.equal(
    storeHubShiftOverlapsWindow(
      shift,
      new Date("2026-10-07T00:00:00Z"),
      new Date("2026-10-06T19:00:00Z"),
    ),
    false,
  );
});
