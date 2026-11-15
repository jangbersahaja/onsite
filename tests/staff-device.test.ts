import { createOneTimeToken } from "@/lib/one-time-token";
import {
  findApprovedStaffDevice,
  getStaffDeviceCookieName,
  isApprovedStaffDevice,
  isStaffDeviceRequired,
  matchesStaffDeviceToken,
} from "@/lib/staff-device";
import assert from "node:assert/strict";
import test from "node:test";

test("requires a device only for users with clock access", () => {
  assert.equal(isStaffDeviceRequired(true), true);
  assert.equal(isStaffDeviceRequired(false), false);
});

test("accepts only the active device token matching its stored hash", () => {
  const credential = createOneTimeToken();

  assert.equal(
    isApprovedStaffDevice(credential.token, "active", credential.tokenHash),
    true,
  );
  assert.equal(
    isApprovedStaffDevice(credential.token, "pending", credential.tokenHash),
    false,
  );
  assert.equal(
    isApprovedStaffDevice(credential.token, "revoked", credential.tokenHash),
    false,
  );
  assert.equal(
    isApprovedStaffDevice("different-token", "active", credential.tokenHash),
    false,
  );
  assert.equal(
    isApprovedStaffDevice(undefined, "active", credential.tokenHash),
    false,
  );
});

test("uses a stable account-scoped cookie name", () => {
  assert.equal(
    getStaffDeviceCookieName("staff-1"),
    getStaffDeviceCookieName("staff-1"),
  );
  assert.notEqual(
    getStaffDeviceCookieName("staff-1"),
    getStaffDeviceCookieName("staff-2"),
  );
});

test("rejects malformed credentials and token hashes", () => {
  assert.equal(matchesStaffDeviceToken("short", "a".repeat(64)), false);
  assert.equal(matchesStaffDeviceToken("a".repeat(43), "not-a-hash"), false);
});

test("finds the matching active device when a staff member has several", () => {
  const first = createOneTimeToken();
  const second = createOneTimeToken();
  const pending = createOneTimeToken();
  const devices = [
    { id: "pending-device", status: "pending" as const, tokenHash: pending.tokenHash },
    { id: "first-device", status: "active" as const, tokenHash: first.tokenHash },
    { id: "second-device", status: "active" as const, tokenHash: second.tokenHash },
  ];

  assert.equal(findApprovedStaffDevice(first.token, devices)?.id, "first-device");
  assert.equal(findApprovedStaffDevice(second.token, devices)?.id, "second-device");
  assert.equal(findApprovedStaffDevice(pending.token, devices), undefined);
  assert.equal(findApprovedStaffDevice(undefined, devices), undefined);
});
