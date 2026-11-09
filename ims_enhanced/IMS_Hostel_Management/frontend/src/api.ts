import type { Complaint, ComplaintActivity, DashboardSummary, Notification, Resource, ResourceTransaction, Room, SystemActivity } from "./types";
import { supabase } from "./supabase";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const sessionResult = await supabase?.auth.getSession();
  const token = sessionResult?.data.session?.access_token;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {})
    }
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    if (!response.ok) throw new Error(`API request failed (${response.status}).`);
    throw new Error("The API returned a non-JSON response. Check that VITE_API_URL points to the deployed Render API ending in /api.");
  }
  const payload = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(payload?.message ?? `Request failed (${response.status})`);
  if (payload === null) throw new Error("The API returned an invalid JSON response.");
  return payload as T;
}

export const api = {
  accountRequests: () => request<{id:string;user_id:string;full_name:string;email:string;requested_role:string;status:string;created_at:string}[]>("/accounts/requests"),
  accountUsers: () => request<{id:string;email:string;full_name:string;role:string;active:boolean;email_confirmed_at:string|null;created_at:string;last_sign_in_at:string|null}[]>("/accounts/users"),
  setAccountActive: (id:string, active:boolean) => request<{id:string;active:boolean}>(`/accounts/users/${id}/status`, {method:"PATCH", body:JSON.stringify({active})}),
  accountStatus: () => request<{role:string;status:string;requested_role?:string;rejection_reason?:string|null}>("/accounts/status"),
  reviewAccountRequest: (id:string, decision:"Approved"|"Rejected", reason?:string) => request<{id:string;status:string}>(`/accounts/requests/${id}`, {method:"PATCH", body:JSON.stringify({decision, reason})}),
  registerAccount: () =>
    request<{ message: string; status: string }>("/accounts/register", {
      method: "POST"
    }),

  health: () => request<{ status: string; message: string }>("/health"),

  dashboard: () => request<DashboardSummary>("/dashboard"),

  complaints: () => request<Complaint[]>("/complaints"),

  createComplaint: (body: Pick<Complaint, "category" | "title" | "description" | "priority">) =>
    request<Complaint>("/complaints", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  updateStatus: (id: string, status: Complaint["status"], resolutionNotes?: string) =>
    request<Complaint>(`/complaints/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, resolutionNotes })
    }),

  assignComplaint: (id: string, staffId: string) =>
    request<Complaint>(`/complaints/${id}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ staffId })
    }),

  staff: () =>
    request<{ id: string; full_name: string; email: string; role: string }[]>("/staff"),

  resources: () => request<Resource[]>("/resources"),

  updateResourceQuantity: (id: string, quantity: number) =>
    request<Resource>(`/resources/${id}/quantity`, {
      method: "PATCH",
      body: JSON.stringify({ quantity })
    }),

  createResource: (body: Omit<Resource, "id">) => request<Resource>("/resources", { method: "POST", body: JSON.stringify(body) }),
  updateResource: (id: string, body: Omit<Resource, "id" | "quantity">) => request<Resource>(`/resources/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  resourceTransactions: (id: string) => request<ResourceTransaction[]>(`/resources/${id}/transactions`),
  complaintActivity: (id: string) => request<ComplaintActivity[]>(`/complaints/${id}/activity`),
  notifications: () => request<Notification[]>("/notifications"),
  markNotificationRead: (id: string) => request<{ id: string; read_at: string }>(`/notifications/${id}/read`, { method: "PATCH" }),
  rooms: () => request<Room[]>("/rooms"),
  createRoom: (body: Omit<Room, "id" | "occupiedCount" | "availableCount">) => request<Room>("/rooms", { method: "POST", body: JSON.stringify(body) }),
  updateRoom: (id: string, body: Omit<Room, "id" | "occupiedCount" | "availableCount">) => request<Room>(`/rooms/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRoom: (id: string) => request<{ id: string; deleted: boolean }>(`/rooms/${id}`, { method: "DELETE" }),
  activity: () => request<SystemActivity[]>("/activity"),

  updateStudentProfile: (body: { fullName: string; roomNumber: string }) =>
    request<{ message: string }>("/accounts/profile", { method: "PATCH", body: JSON.stringify(body) })
}; 
