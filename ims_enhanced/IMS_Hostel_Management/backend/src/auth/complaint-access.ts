import type { AuthRole } from "./roles.js";

export function canAccessComplaintRecord(role: AuthRole, userId: string, submittedBy: string | null, assignedStaffId: string | null, linkedActiveStaffId: string | null): boolean {
  if (role === "Administrator" || role === "Warden") return true;
  if (role === "Student") return submittedBy === userId;
  if (role === "Maintenance Staff") return Boolean(linkedActiveStaffId && assignedStaffId === linkedActiveStaffId);
  return false;
}
