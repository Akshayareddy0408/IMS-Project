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

export interface ComplaintActivity {
  id: string;
  actorName: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Resource {
  id: string;
  name: string;
  category: string;
  location: string;
  quantity: number;
  minimumStock: number;
  unit: string;
}

export interface ResourceTransaction {
  id: string;
  resourceId: string;
  transactionType: "IN" | "OUT" | "ADJUSTMENT";
  quantity: number;
  note: string | null;
  staffName: string | null;
  createdAt: string;
}
