import {
  AUDIT_ACTIONS,
  describeAuditEvent,
  isAuditAction,
} from "@/lib/audit-events";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("audit actions", () => {
  it("has no duplicate action names", () => {
    assert.equal(new Set(AUDIT_ACTIONS).size, AUDIT_ACTIONS.length);
  });

  it("recognises registered actions only", () => {
    assert.equal(isAuditAction("clock_in"), true);
    assert.equal(isAuditAction("not_a_real_action"), false);
  });
});

describe("describeAuditEvent", () => {
  it("names the actor and outlet for clock events", () => {
    assert.equal(
      describeAuditEvent({
        action: "clock_in",
        actorName: "Ali",
        outletName: "Outlet 1",
        newValues: null,
      }),
      "Ali clocked in at Outlet 1",
    );
  });

  it("omits the outlet suffix when no outlet is recorded", () => {
    assert.equal(
      describeAuditEvent({
        action: "clock_out",
        actorName: "Ali",
        outletName: null,
        newValues: null,
      }),
      "Ali clocked out",
    );
  });

  it("falls back to System when the actor was deleted", () => {
    assert.equal(
      describeAuditEvent({
        action: "sign_in",
        actorName: null,
        outletName: null,
        newValues: null,
      }),
      "System signed in",
    );
  });

  it("uses the recorded username for invitations", () => {
    assert.equal(
      describeAuditEvent({
        action: "invitation_created",
        actorName: "Sara",
        outletName: null,
        newValues: { username: "bob" },
      }),
      "Sara invited bob",
    );
  });

  it("names the outlet for outlet changes", () => {
    assert.equal(
      describeAuditEvent({
        action: "outlet_updated",
        actorName: "Sara",
        outletName: "Outlet 2",
        newValues: null,
      }),
      "Sara updated outlet Outlet 2",
    );
  });

  it("describes unknown actions without throwing", () => {
    assert.equal(
      describeAuditEvent({
        action: "legacy_action",
        actorName: "Ali",
        outletName: null,
        newValues: null,
      }),
      "Ali performed legacy_action",
    );
  });
});
