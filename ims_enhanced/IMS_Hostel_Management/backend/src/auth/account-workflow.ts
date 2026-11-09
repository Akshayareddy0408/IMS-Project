import type { AuthRole } from "./roles.js";

export function canResubmitAccountRequest(role: AuthRole, status: unknown, requestedRole: unknown): requestedRole is "Warden" | "Maintenance Staff" {
  return role === "Pending" && status === "Rejected" && (requestedRole === "Warden" || requestedRole === "Maintenance Staff");
}
