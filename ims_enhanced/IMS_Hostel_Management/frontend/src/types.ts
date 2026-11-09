export type ComplaintStatus =
  | "Submitted"
  | "Reviewed"
  | "Assigned"
  | "In Progress"
  | "Resolved"
  | "Closed";

export type Priority = "Low" | "Medium" | "High" | "Urgent";

export interface Complaint {
  id: string;
  code: string;
  studentName: string;
  room: string;
  category: string;
  title: string;
  description: string;
  priority: Priority;
  status: ComplaintStatus;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  resolutionNotes: string | null;
}

export interface ComplaintActivity { id: string; actorName: string; action: string; details: Record<string, unknown>; createdAt: string }
export interface ResourceTransaction { id: string; resourceId: string; transactionType: "IN" | "OUT" | "ADJUSTMENT"; quantity: number; note: string | null; staffName: string | null; createdAt: string }
export interface Notification { id: string; title: string; message: string; read_at: string | null; created_at: string }
export interface Room { id: string; roomNumber: string; block: string; floor: number | null; capacity: number; occupiedCount: number; availableCount: number; isAvailable: boolean }
export interface SystemActivity { id: string; action: string; entityType: string; entityId: string | null; createdAt: string }

export interface Resource {
  id: string;
  name: string;
  category: string;
  location: string;
  quantity: number;
  minimumStock: number;
  unit: string;
}

export interface DashboardSummary {
  totalComplaints: number;
  openComplaints: number;
  resolvedComplaints: number;
  urgentComplaints: number;
  lowStockItems: number;
  statusCounts: Record<ComplaintStatus, number>;
}
