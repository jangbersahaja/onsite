import {
  getStaffDeviceCookieName,
  isApprovedStaffDevice,
  isStaffDeviceRequired,
  matchesStaffDeviceToken,
} from "@/lib/staff-device";
import { createOneTimeToken } from "@/lib/one-time-token";
import assert from "node:assert/strict";
import test from "node:test";

test("requires a device only for the staff role", () => {
  assert.equal(isStaffDeviceRequired("staff"), true);
  assert.equal(isStaffDeviceRequired("supervisor"), false);
  assert.equal(isStaffDeviceRequired("manager"), false);
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
