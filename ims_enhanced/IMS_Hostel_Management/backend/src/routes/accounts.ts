import { Router } from "express";
import { z } from "zod";
import { supabase } from "../supabase.js";
import { roleFromAppMetadata } from "../auth/roles.js";
import { roomHasAvailability } from "../auth/room-assignment.js";
import { canResubmitAccountRequest } from "../auth/account-workflow.js";
import { writeActivity } from "../audit.js";
import { forwardAsyncErrors } from "../middleware/async-errors.js";

const router = Router();
const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(20).optional().default(""),
  roomNumber: z.string().trim().max(30).optional().default("")
});

function pendingReset() {
  return { status: "Pending", reviewed_by: null, reviewed_at: null, rejection_reason: null };
}

router.post("/register", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Please sign in." });
  const parsed = registrationSchema.safeParse({
    fullName: user.userMetadata.full_name,
    phone: user.userMetadata.phone,
    roomNumber: user.userMetadata.room_number
  });
  if (!parsed.success) return res.status(400).json({ message: "Your account details are incomplete. Check your name and room number." });
  const { fullName, phone, roomNumber } = parsed.data;
  const requestedRole = user.userMetadata.requested_role;

  if (user.role === "Pending") {
    const { data, error } = await supabase.from("account_requests").select("id,status,requested_role").eq("user_id", user.id).maybeSingle();
    if (error) return res.status(500).json({ message: "Could not read your application status." });
    if (data && canResubmitAccountRequest(user.role, data.status, requestedRole)) {
      const resubmitted = await supabase.from("account_requests").update({
        full_name: fullName, email: user.email, phone: phone || null, requested_role: requestedRole,
        status: "Pending", rejection_reason: null, reviewed_by: null, reviewed_at: null
      }).eq("id", data.id).eq("status", "Rejected").select("id").maybeSingle();
      if (resubmitted.error) return res.status(500).json({ message: "Could not resubmit your access request." });
      if (!resubmitted.data) return res.status(409).json({ message: "Your application changed while it was being resubmitted. Refresh and try again." });
      await writeActivity(user.id, "Account request resubmitted", "account_request", data.id, { requested_role: requestedRole });
      return res.json({ message: "Your access request has been resubmitted for Administrator approval.", status: "Pending" });
    }
    return res.json({ message: data ? `Your access request is ${String(data.status).toLowerCase()}.` : "Your account is pending Administrator review.", status: data?.status ?? "Pending" });
  }

  if (user.role === "Unassigned" || user.role === "Student") {
    if (user.role === "Unassigned" && requestedRole !== "Student") {
      if (requestedRole !== "Warden" && requestedRole !== "Maintenance Staff") return res.status(403).json({ message: "Your account has no valid registration request. Contact an Administrator." });
      const { data: existing, error: lookupError } = await supabase.from("account_requests").select("id,status,requested_role").eq("user_id", user.id).maybeSingle();
      if (lookupError) return res.status(500).json({ message: "Could not check for an existing access request." });
      if (existing?.status === "Pending" || existing?.status === "Approved") return res.json({ message: `Your access request is ${existing.status.toLowerCase()}.`, status: existing.status });
      const requestData = { user_id: user.id, full_name: fullName, email: user.email, phone: phone || null, requested_role: requestedRole, status: "Pending", rejection_reason: null, reviewed_by: null, reviewed_at: null };
      const requestResult = existing
        ? await supabase.from("account_requests").update(requestData).eq("id", existing.id)
        : await supabase.from("account_requests").insert(requestData);
      if (requestResult.error) return res.status(500).json({ message: "Could not save your access request." });
      const { error: roleError } = await supabase.auth.admin.updateUserById(user.id, { app_metadata: { ...user.appMetadata, role: "Pending" } });
      if (roleError) return res.status(500).json({ message: "Application saved, but pending access could not be set. Contact an Administrator." });
      await writeActivity(user.id, existing ? "Account request resubmitted" : "Account request submitted", "account_request", existing?.id ?? null, { requested_role: requestedRole });
      return res.status(existing ? 200 : 201).json({ message: "Your access request has been submitted for Administrator approval.", status: "Pending" });
    }

    if (requestedRole && requestedRole !== "Student") return res.status(403).json({ message: "This account cannot register as a Student." });
    if (!roomNumber) return res.status(400).json({ message: "Enter your registered hostel room number." });
    const { data: room, error: roomError } = await supabase.from("rooms").select("id,capacity,is_available").eq("room_number", roomNumber).maybeSingle();
    if (roomError) return res.status(500).json({ message: "Could not verify the hostel room. Confirm the room-management migration is applied." });
    if (!room) return res.status(400).json({ message: "That room number is not registered. Contact your hostel office." });

    const { data: linked, error: linkedError } = await supabase.from("students").select("id,auth_user_id,room_id").eq("auth_user_id", user.id).maybeSingle();
    if (linkedError) return res.status(500).json({ message: "Could not load your Student profile." });
    let existing = linked;
    if (!existing && user.email) {
      const { data: byEmail, error } = await supabase.from("students").select("id,auth_user_id,room_id").eq("email", user.email).maybeSingle();
      if (error) return res.status(500).json({ message: "Could not check your existing Student profile." });
      if (byEmail?.auth_user_id && byEmail.auth_user_id !== user.id) return res.status(409).json({ message: "A Student profile with this email is linked to another account. Contact an Administrator." });
      existing = byEmail;
    }
    const { count, error: countError } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("room_id", room.id);
    if (countError) return res.status(500).json({ message: "Could not verify room availability." });
    if (!roomHasAvailability(room.capacity, count ?? 0, existing?.room_id === room.id, room.is_available !== false)) return res.status(409).json({ message: "That room is full or unavailable. Choose another registered room." });

    const details = { auth_user_id: user.id, full_name: fullName, email: user.email, phone: phone || null, room_id: room.id };
    const saved = existing
      ? await supabase.from("students").update(details).eq("id", existing.id).select("id").single()
      : await supabase.from("students").insert(details).select("id").single();
    if (saved.error) {
      if (saved.error.message.includes("Room is at capacity") || saved.error.message.includes("Room is unavailable")) return res.status(409).json({ message: "That room became full or unavailable. Choose another registered room." });
      return res.status(500).json({ message: "Could not save your Student profile." });
    }
    if (user.role === "Unassigned") {
      const { error } = await supabase.auth.admin.updateUserById(user.id, { app_metadata: { ...user.appMetadata, role: "Student" } });
      if (error) return res.status(500).json({ message: "Student profile saved, but the account role could not be provisioned. Sign in again to retry." });
    }
    await writeActivity(user.id, "Student registration completed", "student", saved.data.id);
    return res.json({ message: "Student registration completed.", status: "Registered" });
  }

  return res.status(403).json({ message: "This account already has a provisioned role." });
});

router.get("/status", async (req, res) => {
  if (!req.user) return res.status(401).json({ message: "Please sign in." });
  if (req.user.role === "Unassigned") return res.json({ role: req.user.role, status: "Registration required" });
  if (req.user.role === "Pending") {
    const { data, error } = await supabase.from("account_requests").select("status,requested_role,rejection_reason,created_at").eq("user_id", req.user.id).maybeSingle();
    if (error) return res.status(500).json({ message: "Could not read your application status." });
    return res.json({ role: req.user.role, ...(data ?? { status: "Pending" }) });
  }
  return res.json({ role: req.user.role, status: "Active" });
});

router.patch("/profile", async (req, res) => {
  const user = req.user;
  if (!user || !["Student", "Warden", "Maintenance Staff", "Administrator"].includes(user.role)) return res.status(403).json({ message: "This account cannot update a profile." });
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Provide a valid name and room number." });
  const { fullName, roomNumber } = parsed.data;
  if (user.role === "Student") {
    if (!roomNumber) return res.status(400).json({ message: "Enter a registered hostel room number." });
    const { data: student, error } = await supabase.from("students").select("id,room_id").eq("auth_user_id", user.id).maybeSingle();
    if (error) return res.status(500).json({ message: "Could not load your Student profile." });
    if (!student) return res.status(404).json({ message: "Complete Student registration before editing your profile." });
    let roomId: string | null = null;
    if (roomNumber) {
      const { data: room, error: roomError } = await supabase.from("rooms").select("id,capacity,is_available").eq("room_number", roomNumber).maybeSingle();
      if (roomError) return res.status(500).json({ message: "Could not verify the room. Confirm the room-management migration is applied." });
      if (!room) return res.status(400).json({ message: "That room number is not registered." });
      roomId = room.id;
      const { count, error: countError } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("room_id", room.id);
      if (countError) return res.status(500).json({ message: "Could not verify room availability." });
      if (!roomHasAvailability(room.capacity, count ?? 0, student.room_id === room.id, room.is_available !== false)) return res.status(409).json({ message: "That room is full or unavailable. Choose another room." });
    }
    const { data, error: updateError } = await supabase.from("students").update({ full_name: fullName, room_id: roomId }).eq("id", student.id).select("id").maybeSingle();
    if (updateError) return res.status(updateError.message.includes("Room is at capacity") || updateError.message.includes("Room is unavailable") ? 409 : 500).json({ message: "Could not save the Student profile or room assignment." });
    if (!data) return res.status(404).json({ message: "Student profile not found." });
    await writeActivity(user.id, "Student profile updated", "student", data.id);
  } else if (user.role === "Warden" || user.role === "Maintenance Staff") {
    const { data, error } = await supabase.from("staff").update({ full_name: fullName }).eq("auth_user_id", user.id).select("id").maybeSingle();
    if (error) return res.status(500).json({ message: "Could not update your staff profile." });
    if (!data) return res.status(404).json({ message: "Your staff profile is not linked. Contact an Administrator." });
    await writeActivity(user.id, "Staff profile updated", "staff", data.id);
  } else {
    await writeActivity(user.id, "Administrator profile updated", "auth_user", user.id);
  }
  const { data: authUser, error: lookupError } = await supabase.auth.admin.getUserById(user.id);
  if (lookupError || !authUser.user) return res.status(500).json({ message: "Profile saved, but sign-in details could not be synchronized." });
  const { error: metadataError } = await supabase.auth.admin.updateUserById(user.id, { user_metadata: { ...authUser.user.user_metadata, full_name: fullName, ...(user.role === "Student" ? { room_number: roomNumber } : {}) } });
  if (metadataError) return res.status(500).json({ message: "Profile saved, but sign-in details could not be synchronized." });
  return res.json({ message: "Profile saved." });
});

router.get("/requests", async (req, res) => {
  if (req.user?.role !== "Administrator") return res.status(403).json({ message: "Only Administrators can review account requests." });
  const { data, error } = await supabase.from("account_requests").select("id,user_id,full_name,email,phone,requested_role,status,rejection_reason,created_at").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ message: "Could not load account requests." });
  return res.json(data ?? []);
});

router.get("/users", async (req, res) => {
  if (req.user?.role !== "Administrator") return res.status(403).json({ message: "Only Administrators can view user accounts." });
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return res.status(500).json({ message: "Could not load user accounts." });
    users.push(...data.users.map(account => ({ id: account.id, email: account.email ?? "", full_name: typeof account.user_metadata?.full_name === "string" ? account.user_metadata.full_name : "", role: roleFromAppMetadata(account.app_metadata?.role) ?? "Invalid", active: account.app_metadata?.active !== false, email_confirmed_at: account.email_confirmed_at ?? null, created_at: account.created_at, last_sign_in_at: account.last_sign_in_at ?? null })));
    if (data.users.length < 1000) break;
  }
  return res.json(users);
});

router.patch("/users/:id/status", async (req, res) => {
  if (req.user?.role !== "Administrator") return res.status(403).json({ message: "Only Administrators can manage user accounts." });
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Choose an active or inactive status." });
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid account identifier." });
  if (!parsed.data.active && req.params.id === req.user.id) return res.status(400).json({ message: "You cannot deactivate your own account." });
  const { data: target, error } = await supabase.auth.admin.getUserById(req.params.id);
  if (error || !target.user) return res.status(404).json({ message: "User account not found." });
  const role = roleFromAppMetadata(target.user.app_metadata?.role);
  if (role === "Administrator") return res.status(403).json({ message: "Administrator accounts cannot be managed through this endpoint." });
  const { error: updateError } = await supabase.auth.admin.updateUserById(req.params.id, { app_metadata: { ...target.user.app_metadata, active: parsed.data.active } });
  if (updateError) return res.status(500).json({ message: "Could not update this account status." });
  if (role === "Maintenance Staff" || role === "Warden") {
    const { error: staffError } = await supabase.from("staff").update({ active: parsed.data.active }).eq("auth_user_id", req.params.id);
    if (staffError) return res.status(500).json({ message: "Account status changed, but staff profile synchronization failed." });
  }
  await writeActivity(req.user.id, parsed.data.active ? "Account activated" : "Account deactivated", "auth_user", req.params.id);
  return res.json({ id: req.params.id, active: parsed.data.active });
});

router.patch("/requests/:id", async (req, res) => {
  if (req.user?.role !== "Administrator") return res.status(403).json({ message: "Only Administrators can review account requests." });
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid account request identifier." });
  const parsed = z.object({ decision: z.enum(["Approved", "Rejected"]), reason: z.string().trim().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Choose Approved or Rejected and provide a valid optional reason." });
  const { data: request, error: lookupError } = await supabase.from("account_requests").select("*").eq("id", req.params.id).maybeSingle();
  if (lookupError) return res.status(500).json({ message: "Could not load this account request." });
  if (!request) return res.status(404).json({ message: "Account request not found." });
  if (request.status !== "Pending") return res.status(409).json({ message: "This request has already been reviewed." });

  const { data: claimed, error: claimError } = await supabase.from("account_requests").update({ status: parsed.data.decision, rejection_reason: parsed.data.decision === "Rejected" ? parsed.data.reason || null : null, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() }).eq("id", request.id).eq("status", "Pending").select("id").maybeSingle();
  if (claimError) return res.status(500).json({ message: "Could not save the account review." });
  if (!claimed) return res.status(409).json({ message: "This request was reviewed by another Administrator." });

  if (parsed.data.decision === "Approved") {
    if (request.requested_role !== "Maintenance Staff" && request.requested_role !== "Warden") {
      await supabase.from("account_requests").update(pendingReset()).eq("id", request.id).eq("status", "Approved");
      return res.status(409).json({ message: "This request has an unsupported role and cannot be approved." });
    }
    const { data: applicant, error: applicantError } = await supabase.auth.admin.getUserById(request.user_id);
    if (applicantError || !applicant.user) {
      await supabase.from("account_requests").update(pendingReset()).eq("id", request.id).eq("status", "Approved");
      return res.status(404).json({ message: "Applicant Auth account was not found." });
    }
    const existingRole = roleFromAppMetadata(applicant.user.app_metadata?.role);
    if (existingRole !== "Pending" && existingRole !== "Unassigned") {
      await supabase.from("account_requests").update(pendingReset()).eq("id", request.id).eq("status", "Approved");
      return res.status(409).json({ message: "Applicant already has an assigned role. Review the account before approving." });
    }
    const staffRole = request.requested_role === "Maintenance Staff" ? "Maintenance" : "Warden";
    const { data: linked, error: linkedError } = await supabase.from("staff").select("id,auth_user_id,role").eq("auth_user_id", request.user_id).maybeSingle();
    if (linkedError) {
      await supabase.from("account_requests").update(pendingReset()).eq("id", request.id).eq("status", "Approved");
      return res.status(500).json({ message: "Could not check the applicant staff profile." });
    }
    let profile = linked;
    if (!profile) {
      const { data, error } = await supabase.from("staff").select("id,auth_user_id,role").eq("email", request.email).maybeSingle();
      if (error) {
        await supabase.from("account_requests").update(pendingReset()).eq("id", request.id).eq("status", "Approved");
        return res.status(500).json({ message: "Could not check the applicant staff profile." });
      }
      profile = data;
    }
    if ((profile?.auth_user_id && profile.auth_user_id !== request.user_id) || (profile && profile.role !== staffRole)) {
      await supabase.from("account_requests").update(pendingReset()).eq("id", request.id).eq("status", "Approved");
      return res.status(409).json({ message: "The linked staff profile belongs to another account or has a different role. No role was changed." });
    }
    const details = { auth_user_id: request.user_id, full_name: request.full_name, email: request.email, phone: request.phone, role: staffRole, active: applicant.user.app_metadata?.active !== false };
    const profileResult = profile
      ? await supabase.from("staff").update(details).eq("id", profile.id)
      : await supabase.from("staff").insert(details);
    if (profileResult.error) {
      await supabase.from("account_requests").update(pendingReset()).eq("id", request.id).eq("status", "Approved");
      return res.status(500).json({ message: "Could not prepare the staff profile for approval." });
    }
    const { error: roleError } = await supabase.auth.admin.updateUserById(request.user_id, { app_metadata: { ...applicant.user.app_metadata, role: request.requested_role } });
    if (roleError) {
      await supabase.from("staff").update({ active: false }).eq("auth_user_id", request.user_id);
      await supabase.from("account_requests").update(pendingReset()).eq("id", request.id).eq("status", "Approved");
      return res.status(500).json({ message: "Could not provision the approved role. Check server configuration." });
    }
  }
  await writeActivity(req.user.id, `Account request ${parsed.data.decision.toLowerCase()}`, "account_request", request.id, { requested_role: request.requested_role });
  return res.json({ id: request.id, status: parsed.data.decision });
});

export default forwardAsyncErrors(router);
