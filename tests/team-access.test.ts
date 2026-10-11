import { canManageTargetAccess } from "@/lib/team-access-rules";
import assert from "node:assert/strict";
import test from "node:test";

const superAdmin = { id: "super", isSuperAdmin: true };
const backoffice = { id: "back", isSuperAdmin: false };

const clockOnly = {
  id: "clock",
  accountType: "user" as const,
  canAccessBackoffice: false,
};
const otherBackoffice = {
  id: "other-back",
  accountType: "user" as const,
  canAccessBackoffice: true,
};
const otherSuperAdmin = {
  id: "other-super",
  accountType: "super_admin" as const,
  canAccessBackoffice: true,
};

test("super admin can manage any other account, including other super admins", () => {
  assert.equal(canManageTargetAccess(superAdmin, clockOnly, false), true);
  assert.equal(canManageTargetAccess(superAdmin, otherBackoffice, false), true);
  assert.equal(canManageTargetAccess(superAdmin, otherSuperAdmin, false), true);
});

test("backoffice user manages clock-only users that share an outlet", () => {
  assert.equal(canManageTargetAccess(backoffice, clockOnly, true), true);
});

test("backoffice user cannot manage clock-only users outside their outlets", () => {
  assert.equal(canManageTargetAccess(backoffice, clockOnly, false), false);
});

test("backoffice user cannot manage other backoffice users", () => {
  assert.equal(canManageTargetAccess(backoffice, otherBackoffice, true), false);
});

test("backoffice user cannot manage super admin accounts", () => {
  assert.equal(canManageTargetAccess(backoffice, otherSuperAdmin, true), false);
});

test("nobody manages their own access through this guard", () => {
  assert.equal(
    canManageTargetAccess(
      superAdmin,
      { ...clockOnly, id: superAdmin.id },
      true,
    ),
    false,
  );
  assert.equal(
    canManageTargetAccess(
      backoffice,
      { ...clockOnly, id: backoffice.id },
      true,
    ),
    false,
  );
});
