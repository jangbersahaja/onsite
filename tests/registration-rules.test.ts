import {
  canManageOutletRegistration,
  canReviewRegistration,
} from "@/lib/registration-rules";
import assert from "node:assert/strict";
import test from "node:test";

const outletA = "outlet-a";
const outletB = "outlet-b";

const superAdmin = { id: "super", isSuperAdmin: true, outletIds: [outletA] };
const managerA = { id: "mgr-a", isSuperAdmin: false, outletIds: [outletA] };
const managerB = { id: "mgr-b", isSuperAdmin: false, outletIds: [outletB] };

const pendingForA = {
  id: "applicant",
  approvalStatus: "pending" as const,
  registrationOutletId: outletA,
};

test("backoffice users can manage registration links only for their outlets", () => {
  assert.equal(canManageOutletRegistration(managerA, outletA), true);
  assert.equal(canManageOutletRegistration(managerA, outletB), false);
  assert.equal(canManageOutletRegistration(superAdmin, outletB), true);
});

test("manager of the registration outlet can approve a pending applicant", () => {
  assert.equal(canReviewRegistration(managerA, pendingForA), true);
});

test("manager of another outlet cannot review the applicant", () => {
  assert.equal(canReviewRegistration(managerB, pendingForA), false);
});

test("super admin can review any pending applicant", () => {
  assert.equal(canReviewRegistration(superAdmin, pendingForA), true);
});

test("approved accounts are never returned to the review queue", () => {
  assert.equal(
    canReviewRegistration(managerA, {
      ...pendingForA,
      approvalStatus: "approved",
    }),
    false,
  );
});

test("nobody reviews their own registration", () => {
  assert.equal(
    canReviewRegistration(superAdmin, { ...pendingForA, id: superAdmin.id }),
    false,
  );
});

test("pending applicant without an outlet can only be reviewed by super admin", () => {
  const orphan = { ...pendingForA, registrationOutletId: null };
  assert.equal(canReviewRegistration(managerA, orphan), false);
  assert.equal(canReviewRegistration(superAdmin, orphan), true);
});
