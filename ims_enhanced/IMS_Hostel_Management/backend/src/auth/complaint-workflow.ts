import type { ComplaintStatus } from "../types.js";
import type { AuthRole } from "./roles.js";

const allowedTransitions: Record<ComplaintStatus, ComplaintStatus[]> = {
  Submitted: ["Reviewed", "Assigned"],
  Reviewed: ["Assigned", "In Progress"],
  Assigned: ["In Progress"],
  "In Progress": ["Resolved"],
  Resolved: ["Closed", "In Progress"],
  Closed: []
};

export function canTransitionComplaint(role: AuthRole, current: ComplaintStatus, next: ComplaintStatus): boolean {
  if (role !== "Administrator" && role !== "Warden" && role !== "Maintenance Staff") return false;
  if (current === next) return true;
  if (role === "Maintenance Staff" && next !== "In Progress" && next !== "Resolved") return false;
  return allowedTransitions[current].includes(next);
}

export function hasResolutionNotes(status: string, notes: unknown): boolean {
  return status !== "Resolved" || (typeof notes === "string" && notes.trim().length > 0 && notes.trim().length <= 2000);
}
