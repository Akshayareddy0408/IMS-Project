import type { AuthRole } from "./roles.js";

export function notificationRecipient(role: AuthRole): { table: "students" | "staff"; column: "recipient_student_id" | "recipient_staff_id" } | null {
  if (role === "Student") return { table: "students", column: "recipient_student_id" };
  if (role === "Warden" || role === "Maintenance Staff" || role === "Administrator") return { table: "staff", column: "recipient_staff_id" };
  return null;
}

export function isNotificationRecipient(role: AuthRole, ownProfileId: string, studentRecipientId: string | null, staffRecipientId: string | null): boolean {
  const recipient = notificationRecipient(role);
  if (!recipient) return false;
  return recipient.column === "recipient_student_id" ? studentRecipientId === ownProfileId : staffRecipientId === ownProfileId;
}
