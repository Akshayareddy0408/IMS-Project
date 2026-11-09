export type UserRole =
  | "Student"
  | "Warden"
  | "Maintenance Staff"
  | "Administrator";

export type AuthRole = UserRole | "Pending" | "Unassigned";

const trustedRoleMap: Record<string, UserRole> = {
  Student: "Student",
  Warden: "Warden",
  Admin: "Administrator",
  Administrator: "Administrator",
  Maintenance: "Maintenance Staff",
  "Maintenance Staff": "Maintenance Staff"
};

/** Only call this with the value read from Supabase Auth app_metadata.role. */
export function roleFromAppMetadata(value: unknown): AuthRole | null {
  if (value == null || value === "") return "Unassigned";
  if (value === "Pending") return "Pending";
  if (typeof value !== "string") return null;
  return trustedRoleMap[value] ?? null;
}

export function roleAllowed(role: AuthRole, allowed: readonly UserRole[]): boolean {
  return allowed.includes(role as UserRole);
}

export function accountIsActive(appMetadata: Record<string, unknown> | undefined): boolean {
  return appMetadata?.active !== false;
}
