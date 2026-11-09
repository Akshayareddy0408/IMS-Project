
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { supabase } from "../supabase.js";
import type { Complaint, ComplaintStatus } from "../types.js";
import { canTransitionComplaint, hasResolutionNotes } from "../auth/complaint-workflow.js";
import { canAccessComplaintRecord } from "../auth/complaint-access.js";
import { writeActivity } from "../audit.js";
import { forwardAsyncErrors } from "../middleware/async-errors.js";

const router = Router();

const createSchema = z.object({
  category: z.string().trim().min(1).max(60),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(2000),
  priority: z.enum(["Low", "Medium", "High", "Urgent"])
});

const statuses: ComplaintStatus[] = [
  "Submitted", "Reviewed", "Assigned", "In Progress", "Resolved", "Closed"
];
const uuidSchema = z.string().uuid();
function toComplaint(row: any): Complaint {
  return {
    id: row.id,
    code: row.code,
    studentName: row.student_name,
    room: row.room,
    category: row.category,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    assignedTo: row.assigned_to ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolutionNotes: row.resolution_notes ?? null
  };
}

async function getMaintenanceStaffId(userId: string) {
  const { data, error } = await supabase
    .from("staff")
    .select("id")
    .eq("auth_user_id", userId)
    .eq("role", "Maintenance")
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

async function canAccessComplaint(user: Express.Request["user"], row: any) {
  if (!user) return false;

  const staffId = user.role === "Maintenance Staff" ? await getMaintenanceStaffId(user.id) : null;
  return canAccessComplaintRecord(user.role, user.id, row.submitted_by ?? null, row.assigned_staff_id ?? null, staffId);
}

router.get("/", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Please sign in." });

  let query = supabase
    .from("complaints")
    .select("*")
    .order("created_at", { ascending: false });

  if (user.role === "Student") {
    query = query.eq("submitted_by", user.id);
  } else if (user.role === "Maintenance Staff") {
    try {
      const staffId = await getMaintenanceStaffId(user.id);
      if (!staffId) {
        return res.status(403).json({ message: "No active Maintenance Staff profile is linked to your account." });
      }
      query = query.eq("assigned_staff_id", staffId);
    } catch (error) {
      return res.status(500).json({ message: "Could not load the Maintenance Staff profile." });
    }
  } else if (user.role !== "Warden" && user.role !== "Administrator") {
    return res.status(403).json({ message: "You are not allowed to view complaints." });
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ message: "Could not load complaints." });

  return res.json((data ?? []).map(toComplaint));
});

router.get("/:id", async (req, res) => {
  if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid complaint identifier." });
  const { data, error } = await supabase
    .from("complaints")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) return res.status(500).json({ message: "Could not load the complaint." });
  if (!data) return res.status(404).json({ message: "Complaint not found." });

  try {
    if (!(await canAccessComplaint(req.user, data))) {
      return res.status(403).json({ message: "You are not allowed to view this complaint." });
    }
  } catch (error) {
    return res.status(500).json({ message: "Could not verify complaint access." });
  }

  return res.json(toComplaint(data));
});

router.get("/:id/activity", async (req, res) => {
  if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid complaint identifier." });
  const { data: complaint, error: complaintError } = await supabase.from("complaints").select("id,submitted_by,assigned_staff_id").eq("id", req.params.id).maybeSingle();
  if (complaintError) return res.status(500).json({ message: "Could not load complaint activity." });
  if (!complaint) return res.status(404).json({ message: "Complaint not found." });
  try {
    if (!(await canAccessComplaint(req.user, complaint))) return res.status(403).json({ message: "You are not allowed to view this complaint." });
  } catch { return res.status(500).json({ message: "Could not verify complaint access." }); }
  const { data, error } = await supabase.from("complaint_activity").select("id,actor_user_id,action,details,created_at").eq("complaint_id", req.params.id).order("created_at", { ascending: true });
  if (error) return res.status(500).json({ message: "Could not load complaint activity." });
  const actorIds = [...new Set((data ?? []).map(row => row.actor_user_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const [{ data: studentActors }, { data: staffActors }] = await Promise.all([
      supabase.from("students").select("auth_user_id,full_name").in("auth_user_id", actorIds),
      supabase.from("staff").select("auth_user_id,full_name").in("auth_user_id", actorIds)
    ]);
    for (const actor of [...(studentActors ?? []), ...(staffActors ?? [])]) if (actor.auth_user_id) names.set(actor.auth_user_id, actor.full_name);
  }
  return res.json((data ?? []).map(row => {
    const details = row.details ?? {};
    const safeDetails = Object.fromEntries(["status", "from", "to", "staff_name"].filter(key => typeof details[key] === "string").map(key => [key, details[key]]));
    return { id: row.id, actorName: row.actor_user_id ? names.get(row.actor_user_id) ?? "HostelCare user" : "System", action: row.action, details: safeDetails, createdAt: row.created_at };
  }));
});

router.post("/", async (req, res) => {
  const user = req.user;

  if (!user) return res.status(401).json({ message: "Please sign in." });
  if (user.role !== "Student") {
    return res.status(403).json({ message: "Only students can submit complaints." });
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Please check the form fields.",
      errors: parsed.error.flatten().fieldErrors
    });
  }

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, full_name, room_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (studentError) return res.status(500).json({ message: "Could not load your student profile." });
  if (!student) {
    return res.status(400).json({ message: "Complete your student registration before submitting a complaint." });
  }

  let room = "";
  if (student.room_id) {
    const { data: roomData, error: roomError } = await supabase
      .from("rooms")
      .select("room_number")
      .eq("id", student.room_id)
      .maybeSingle();

    if (roomError) return res.status(500).json({ message: "Could not load your registered room." });
    room = roomData?.room_number ?? "";
  }

  let data: any = null;
  let error: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = `CMP-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const inserted = await supabase.from("complaints").insert({
      code,
      student_id: student.id,
      submitted_by: user.id,
      student_name: student.full_name,
      room,
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
      status: "Submitted"
    }).select("*").single();
    data = inserted.data;
    error = inserted.error;
    if (!error || error.code !== "23505") break;
  }

  if (error) return res.status(500).json({ message: error.code === "23505" ? "A unique complaint reference could not be generated. Please try again." : "Could not create your complaint." });
  await supabase.from("complaint_activity").insert({ complaint_id: data.id, actor_user_id: user.id, action: "Complaint created", details: { status: "Submitted" } });
  await writeActivity(user.id, "Complaint created", "complaint", data.id, { code: data.code });
  const { data: wardens } = await supabase.from("staff").select("id").eq("role", "Warden").eq("active", true);
  if (wardens?.length) await supabase.from("notifications").insert(wardens.map(warden => ({ recipient_staff_id: warden.id, title: "New complaint", message: `${data.code}: ${data.title}` })));
  return res.status(201).json(toComplaint(data));
});

router.patch("/:id/status", async (req, res) => {
  if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid complaint identifier." });
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Please sign in." });

  const parsedStatus = z.object({ status: z.enum(statuses as [ComplaintStatus, ...ComplaintStatus[]]), resolutionNotes: z.string().trim().max(2000).optional() }).superRefine((value, context) => {
    if (!hasResolutionNotes(value.status, value.resolutionNotes)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolutionNotes"], message: "Resolution notes are required and must be no more than 2000 characters." });
  }).safeParse(req.body);
  if (!parsedStatus.success) return res.status(400).json({ message: "Provide a valid status and resolution notes (up to 2000 characters)." });
  const { status, resolutionNotes } = parsedStatus.data;

  if (user.role !== "Warden" && user.role !== "Administrator" && user.role !== "Maintenance Staff") {
    return res.status(403).json({ message: "You are not allowed to update complaint status." });
  }

  const { data: current, error: lookupError } = await supabase
    .from("complaints")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (lookupError) return res.status(500).json({ message: "Could not load the complaint." });
  if (!current) return res.status(404).json({ message: "Complaint not found." });

  try {
    if (!(await canAccessComplaint(user, current))) {
      return res.status(403).json({ message: "You are not allowed to update this complaint." });
    }
  } catch (error) {
    return res.status(500).json({ message: "Could not verify complaint access." });
  }

  if (!canTransitionComplaint(user.role, current.status as ComplaintStatus, status)) {
    if (user.role === "Maintenance Staff" && status !== "In Progress" && status !== "Resolved") {
      return res.status(403).json({ message: "Maintenance Staff can move assigned work to In Progress or Resolved." });
    }
    return res.status(409).json({ message: `Cannot move a ${current.status} complaint to ${status}.` });
  }

  const { data, error } = await supabase
    .from("complaints")
    .update({ status, ...(status === "Resolved" && resolutionNotes !== undefined ? { resolution_notes: resolutionNotes || null } : {}) })
    .eq("id", req.params.id)
    .eq("status", current.status)
    .select("*")
    .maybeSingle();

  if (error) return res.status(500).json({ message: "Could not update complaint status." });
  if (!data) return res.status(409).json({ message: "Complaint status changed concurrently. Refresh and try again." });

  if (current.status !== status) await supabase.from("complaint_activity").insert({ complaint_id: data.id, actor_user_id: user.id, action: "Status changed", details: { from: current.status, to: status } });
  if (current.status !== status) await writeActivity(user.id, "Complaint status changed", "complaint", data.id, { from: current.status, to: status });
  if (current.status !== status && current.student_id) await supabase.from("notifications").insert({ recipient_student_id: current.student_id, title: "Complaint updated", message: `${data.code} is now ${status}.` });

  return res.json(toComplaint(data));
});

router.patch("/:id/assign", async (req, res) => {
  if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid complaint identifier." });
  const user = req.user;

  if (!user) return res.status(401).json({ message: "Please sign in." });
  if (user.role !== "Warden" && user.role !== "Administrator") {
    return res.status(403).json({ message: "Only Wardens and Administrators can assign complaints." });
  }

  const staffId = typeof req.body?.staffId === "string" ? req.body.staffId.trim() : "";
  if (!uuidSchema.safeParse(staffId).success) return res.status(400).json({ message: "Select a valid Maintenance Staff member." });

  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .select("id, full_name")
    .eq("id", staffId)
    .eq("role", "Maintenance")
    .eq("active", true)
    .maybeSingle();

  if (staffError) return res.status(500).json({ message: "Could not verify the selected staff member." });
  if (!staff) return res.status(400).json({ message: "Selected staff member is not active Maintenance Staff." });

  const { data: current, error: lookupError } = await supabase
    .from("complaints")
    .select("status,assigned_staff_id")
    .eq("id", req.params.id)
    .maybeSingle();

  if (lookupError) return res.status(500).json({ message: "Could not load the complaint." });
  if (!current) return res.status(404).json({ message: "Complaint not found." });
  if (!["Submitted", "Reviewed", "Assigned", "In Progress"].includes(current.status)) return res.status(409).json({ message: "Resolved or closed complaints cannot be assigned." });

  const status = ["Submitted", "Reviewed"].includes(current.status) ? "Assigned" : current.status;

  const { data, error } = await supabase
    .from("complaints")
    .update({
      assigned_staff_id: staff.id,
      assigned_to: staff.full_name,
      status
    })
    .eq("id", req.params.id)
    .eq("status", current.status)
    .select("*")
    .maybeSingle();

  if (error) return res.status(500).json({ message: "Could not assign the complaint." });
  if (!data) return res.status(409).json({ message: "Complaint changed concurrently. Refresh and try again." });
  if (current.assigned_staff_id !== staff.id) {
    await supabase.from("complaint_activity").insert({ complaint_id: data.id, actor_user_id: user.id, action: "Staff assigned", details: { staff_id: staff.id, staff_name: staff.full_name } });
    await writeActivity(user.id, "Complaint assigned", "complaint", data.id, { staff_id: staff.id });
    await supabase.from("notifications").insert({ recipient_staff_id: staff.id, title: "Complaint assigned", message: `${data.code}: ${data.title}` });
  }
  return res.json(toComplaint(data));
});

export default forwardAsyncErrors(router);
