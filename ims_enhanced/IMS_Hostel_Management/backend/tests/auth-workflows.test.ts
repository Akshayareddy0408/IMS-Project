import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionComplaint, hasResolutionNotes } from "../src/auth/complaint-workflow.js";
import { canResubmitAccountRequest } from "../src/auth/account-workflow.js";
import { canAccessComplaintRecord } from "../src/auth/complaint-access.js";
import { isNotificationRecipient, notificationRecipient } from "../src/auth/notification-access.js";
import { canManageInventory, canViewInventoryHistory, isValidInventoryQuantity } from "../src/auth/inventory-access.js";
import { createRequireAuth, type AuthUserClaims } from "../src/auth/guard.js";
import { accountIsActive, roleAllowed, roleFromAppMetadata } from "../src/auth/roles.js";

async function runGuard(header: string | undefined, user: AuthUserClaims | null, error?: unknown) {
  let statusCode = 200;
  let payload: unknown;
  let continued = false;
  const req = { headers: { authorization: header } } as import("express").Request;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { payload = value; return this; }
  } as unknown as import("express").Response;
  const middleware = createRequireAuth(async () => ({ user, error }));
  await middleware(req, res, (() => { continued = true; }) as import("express").NextFunction);
  return { statusCode, payload, continued, user: req.user };
}

test("missing or pending trusted metadata never becomes Student", () => {
  assert.equal(roleFromAppMetadata(undefined), "Unassigned");
  assert.equal(roleFromAppMetadata(null), "Unassigned");
  assert.equal(roleFromAppMetadata("Pending"), "Pending");
  assert.equal(roleAllowed("Unassigned", ["Student"]), false);
  assert.equal(roleAllowed("Pending", ["Administrator", "Warden"]), false);
});

test("only recognized app metadata roles map to application roles", () => {
  assert.equal(roleFromAppMetadata("Student"), "Student");
  assert.equal(roleFromAppMetadata("Maintenance Staff"), "Maintenance Staff");
  assert.equal(roleFromAppMetadata("Warden"), "Warden");
  assert.equal(roleFromAppMetadata("Administrator"), "Administrator");
  assert.equal(roleFromAppMetadata("Student;Administrator"), null);
  assert.equal(roleFromAppMetadata(42), null);
});

test("API authentication ignores editable user metadata and blocks missing, invalid, and expired roles", async () => {
  const noRole = await runGuard("Bearer token", { id: "u1", user_metadata: { role: "Administrator" } });
  assert.equal(noRole.continued, true);
  assert.equal(noRole.user?.role, "Unassigned");

  const pending = await runGuard("Bearer token", { id: "u2", app_metadata: { role: "Pending" } });
  assert.equal(pending.user?.role, "Pending");

  const invalid = await runGuard("Bearer token", { id: "u3", app_metadata: { role: "Root" } });
  assert.equal(invalid.statusCode, 403);
  assert.equal(invalid.continued, false);

  const expired = await runGuard("Bearer token", null, new Error("expired"));
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.continued, false);

  const missing = await runGuard(undefined, null);
  assert.equal(missing.statusCode, 401);
});

test("inactive accounts are rejected by the API authentication guard", async () => {
  const inactive = await runGuard("Bearer token", { id: "u4", app_metadata: { role: "Student", active: false } });
  assert.equal(accountIsActive({ active: false }), false);
  assert.equal(inactive.statusCode, 403);
  assert.equal(inactive.continued, false);
});

test("rejected staff applicants can explicitly resubmit without granting access", () => {
  assert.equal(canResubmitAccountRequest("Pending", "Rejected", "Warden"), true);
  assert.equal(canResubmitAccountRequest("Pending", "Rejected", "Maintenance Staff"), true);
  assert.equal(canResubmitAccountRequest("Pending", "Approved", "Warden"), false);
  assert.equal(canResubmitAccountRequest("Student", "Rejected", "Warden"), false);
  assert.equal(canResubmitAccountRequest("Pending", "Rejected", "Administrator"), false);
});

test("complaint transitions enforce role and workflow restrictions", () => {
  assert.equal(canTransitionComplaint("Student", "Submitted", "Reviewed"), false);
  assert.equal(canTransitionComplaint("Pending", "Submitted", "Assigned"), false);
  assert.equal(canTransitionComplaint("Maintenance Staff", "Assigned", "In Progress"), true);
  assert.equal(canTransitionComplaint("Maintenance Staff", "Assigned", "Closed"), false);
  assert.equal(canTransitionComplaint("Warden", "Submitted", "Reviewed"), true);
  assert.equal(canTransitionComplaint("Administrator", "Closed", "In Progress"), false);
});

test("resolution status requires non-empty notes within the allowed length", () => {
  assert.equal(hasResolutionNotes("Resolved", "Repaired the leak"), true);
  assert.equal(hasResolutionNotes("Resolved", "  "), false);
  assert.equal(hasResolutionNotes("Resolved", "x".repeat(2001)), false);
  assert.equal(hasResolutionNotes("In Progress", undefined), true);
});

test("complaint access is limited to owner, assigned maintenance staff, and managers", () => {
  assert.equal(canAccessComplaintRecord("Student", "student-a", "student-a", null, null), true);
  assert.equal(canAccessComplaintRecord("Student", "student-a", "student-b", null, null), false);
  assert.equal(canAccessComplaintRecord("Maintenance Staff", "staff-user", "student-a", "staff-a", "staff-a"), true);
  assert.equal(canAccessComplaintRecord("Maintenance Staff", "staff-user", "student-a", "staff-b", "staff-a"), false);
  assert.equal(canAccessComplaintRecord("Maintenance Staff", "staff-user", "student-a", "staff-a", null), false);
  assert.equal(canAccessComplaintRecord("Warden", "warden", "student-a", null, null), true);
  assert.equal(canAccessComplaintRecord("Administrator", "admin", "student-a", null, null), true);
  assert.equal(canAccessComplaintRecord("Pending", "pending", "pending", null, null), false);
});

test("notification scope only matches the signed-in user's linked recipient profile", () => {
  assert.deepEqual(notificationRecipient("Student"), { table: "students", column: "recipient_student_id" });
  assert.equal(isNotificationRecipient("Student", "student-a", "student-a", "staff-a"), true);
  assert.equal(isNotificationRecipient("Student", "student-a", "student-b", null), false);
  assert.equal(isNotificationRecipient("Maintenance Staff", "staff-a", null, "staff-a"), true);
  assert.equal(isNotificationRecipient("Warden", "staff-a", null, "staff-b"), false);
  assert.equal(isNotificationRecipient("Pending", "pending-a", null, "pending-a"), false);
});

test("inventory authorization and quantity validation are role and range restricted", () => {
  assert.equal(canManageInventory("Administrator"), true);
  assert.equal(canManageInventory("Warden"), false);
  assert.equal(canManageInventory("Maintenance Staff"), false);
  assert.equal(canViewInventoryHistory("Warden"), true);
  assert.equal(canViewInventoryHistory("Student"), false);
  assert.equal(isValidInventoryQuantity(0), true);
  assert.equal(isValidInventoryQuantity(100000), true);
  assert.equal(isValidInventoryQuantity(-1), false);
  assert.equal(isValidInventoryQuantity(1.5), false);
});
