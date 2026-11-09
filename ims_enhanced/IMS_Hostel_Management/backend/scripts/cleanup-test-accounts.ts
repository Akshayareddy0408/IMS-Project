import "dotenv/config";
import { createHash } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";

type Row = Record<string, any>;
type TargetPlan = {
  email: string;
  user: User | null;
  students: Row[];
  staff: Row[];
  requests: Row[];
  ownedComplaints: Row[];
  assignedComplaints: Row[];
  notifications: Row[];
  activityLogs: Row[];
  resourceTransactions: Row[];
  complaintActivity: Row[];
  reviewRows: Row[];
};
type Plan = { targets: TargetPlan[]; dependencies: Row[]; blockers: string[]; phrase: string; hash: string };

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set the existing server-side Supabase configuration in backend/.env. No credential value is printed.");
const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueRows(rows: Row[]): Row[] {
  const byId = new Map<string, Row>();
  for (const row of rows) byId.set(String(row.id), row);
  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function checkedIds(ids: string[], context: string, blockers: string[]): string[] {
  const valid: string[] = [];
  for (const id of ids) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) valid.push(id);
    else blockers.push(`${context}: a linked row has a missing or invalid UUID. Cleanup fails closed.`);
  }
  return [...new Set(valid)];
}

async function rowsBy(table: string, column: string, values: string[]): Promise<Row[]> {
  if (!values.length) return [];
  const { data, error } = await client.from(table).select("*").in(column, values);
  if (error) throw new Error(`Could not inspect ${table}.${column}; cleanup stopped before changes: ${error.message}`);
  return (data ?? []) as Row[];
}

async function rowsByEmails(table: string, emails: string[]): Promise<Row[]> {
  if (!emails.length) return [];
  const matches: Row[] = [];
  for (const email of emails) {
    const { data, error } = await client.from(table).select("*").ilike("email", email);
    if (error) throw new Error(`Could not inspect ${table}.email; cleanup stopped before changes: ${error.message}`);
    matches.push(...((data ?? []) as Row[]).filter(row => String(row.email ?? "").toLowerCase() === email.toLowerCase()));
  }
  return uniqueRows(matches);
}

async function allAuthUsers(): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not inspect Supabase Auth users; cleanup stopped: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function buildPlan(emails: string[]): Promise<Plan> {
  const blockers: string[] = [];
  const authUsers = await allAuthUsers();
  const targets: TargetPlan[] = [];

  for (const email of emails) {
    const matches = authUsers.filter(user => user.email?.toLowerCase() === email);
    if (matches.length > 1) blockers.push(`${email}: more than one Auth user matched the exact email.`);
    const user = matches.length === 1 ? matches[0] : null;
    const userId = user?.id;
    const students = uniqueRows([
      ...(userId ? await rowsBy("students", "auth_user_id", [userId]) : []),
      ...await rowsByEmails("students", [email])
    ]);
    const staff = uniqueRows([
      ...(userId ? await rowsBy("staff", "auth_user_id", [userId]) : []),
      ...await rowsByEmails("staff", [email])
    ]);
    const requests = uniqueRows([
      ...(userId ? await rowsBy("account_requests", "user_id", [userId]) : []),
      ...await rowsByEmails("account_requests", [email])
    ]);

    if (!user) blockers.push(`${email}: no unique Auth user was found; cleanup will not guess from email-only database rows.`);
    if (user && ["Administrator", "Admin"].includes(String(user.app_metadata?.role))) {
      blockers.push(`${email}: this is an Administrator Auth account. Cleanup stops without deleting anything.`);
    }
    if (staff.some(row => ["Admin", "Administrator"].includes(String(row.role)))) {
      blockers.push(`${email}: a linked staff profile has Administrator role. Cleanup stops without deleting anything.`);
    }
    if (userId && students.some(row => row.auth_user_id && row.auth_user_id !== userId)) {
      blockers.push(`${email}: an email-matched Student profile is linked to a different Auth user.`);
    }
    if (userId && staff.some(row => row.auth_user_id && row.auth_user_id !== userId)) {
      blockers.push(`${email}: an email-matched Staff profile is linked to a different Auth user.`);
    }
    if (userId && requests.some(row => row.user_id !== userId)) {
      blockers.push(`${email}: an email-matched account request belongs to a different Auth user.`);
    }

    targets.push({ email, user, students, staff, requests, ownedComplaints: [], assignedComplaints: [], notifications: [], activityLogs: [], resourceTransactions: [], complaintActivity: [], reviewRows: [] });
  }

  const userIds = checkedIds(targets.flatMap(target => target.user ? [target.user.id] : []), "Auth users", blockers);
  const studentIds = checkedIds(targets.flatMap(target => target.students.map(row => String(row.id))), "Student profiles", blockers);
  const staffIds = checkedIds(targets.flatMap(target => target.staff.map(row => String(row.id))), "Staff profiles", blockers);
  const studentComplaintRows = await rowsBy("complaints", "student_id", studentIds);
  const submittedComplaintRows = await rowsBy("complaints", "submitted_by", userIds);
  const allOwnedCandidates = uniqueRows([...studentComplaintRows, ...submittedComplaintRows]);
  const ownedComplaintRows: Row[] = [];
  const studentOwnerIds = new Set(studentIds);
  const userOwnerIds = new Set(userIds);
  for (const complaint of allOwnedCandidates) {
    if (complaint.submitted_by && !userOwnerIds.has(String(complaint.submitted_by))) {
      blockers.push(`Complaint ${complaint.code ?? complaint.id} links a target Student profile to another Auth user's submission.`);
      continue;
    }
    if (complaint.student_id && !studentOwnerIds.has(String(complaint.student_id))) {
      blockers.push(`Complaint ${complaint.code ?? complaint.id} was submitted by a target Auth user but points to another Student profile.`);
      continue;
    }
    ownedComplaintRows.push(complaint);
  }
  const ownedComplaintIds = checkedIds(ownedComplaintRows.map(row => String(row.id)), "Complaints", blockers);
  const ownedComplaintSet = new Set(ownedComplaintIds);
  const assignedRows = uniqueRows(await rowsBy("complaints", "assigned_staff_id", staffIds));
  for (const complaint of assignedRows) {
    if (!ownedComplaintSet.has(String(complaint.id))) {
      blockers.push(`Complaint ${complaint.code ?? complaint.id} belongs to another user but is assigned to a target staff profile.`);
    }
  }

  const notifications = uniqueRows([
    ...await rowsBy("notifications", "recipient_student_id", studentIds),
    ...await rowsBy("notifications", "recipient_staff_id", staffIds)
  ]);
  for (const notification of notifications) {
    if (notification.recipient_student_id && !studentOwnerIds.has(String(notification.recipient_student_id))) {
      blockers.push(`Notification ${notification.id} is also addressed to a non-target Student; cleanup will not remove it.`);
    }
    if (notification.recipient_staff_id && !new Set(staffIds).has(String(notification.recipient_staff_id))) {
      blockers.push(`Notification ${notification.id} is also addressed to non-target Staff; cleanup will not remove it.`);
    }
  }
  const resourceTransactions = await rowsBy("resource_transactions", "staff_id", staffIds);
  if (resourceTransactions.length) blockers.push(`${resourceTransactions.length} inventory transaction(s) reference target Staff profiles; cleanup will not alter inventory audit history.`);
  const staffActivity = await rowsBy("activity_logs", "actor_staff_id", staffIds);
  const entityActivity = await rowsBy("activity_logs", "entity_id", [...staffIds, ...ownedComplaintIds]);
  const activityLogs = uniqueRows([...staffActivity, ...entityActivity]);
  if (activityLogs.length) blockers.push(`${activityLogs.length} activity log(s) reference target staff or complaints; cleanup will not alter audit history.`);

  const reviewRows = uniqueRows(await rowsBy("account_requests", "reviewed_by", userIds));
  if (reviewRows.length) blockers.push(`${reviewRows.length} account request(s) were reviewed by a target user; cleanup will not erase another applicant's review history.`);

  const activityByComplaint = await rowsBy("complaint_activity", "complaint_id", ownedComplaintIds);
  const activityByActor = await rowsBy("complaint_activity", "actor_user_id", userIds);
  const complaintActivity = uniqueRows([...activityByComplaint, ...activityByActor]);
  for (const item of activityByActor) {
    if (!ownedComplaintSet.has(String(item.complaint_id))) {
      blockers.push(`Complaint activity ${item.id} was written by a target user on a complaint owned by someone else.`);
    }
  }
  for (const item of activityByComplaint) {
    if (item.actor_user_id && !userOwnerIds.has(String(item.actor_user_id))) {
      blockers.push(`Complaint ${item.complaint_id} has activity by another user; deleting it would remove that user's history.`);
    }
  }
  for (const complaint of ownedComplaintRows) {
    if (complaint.assigned_staff_id && !new Set(staffIds).has(String(complaint.assigned_staff_id))) {
      blockers.push(`Target-owned complaint ${complaint.code ?? complaint.id} is assigned to non-target staff; cleanup will not erase their work assignment.`);
    }
  }

  for (const target of targets) {
    const targetUserId = target.user?.id;
    const targetStudentIds = new Set(target.students.map(row => String(row.id)));
    const targetStaffIds = new Set(target.staff.map(row => String(row.id)));
    target.ownedComplaints = ownedComplaintRows.filter(row =>
      (targetUserId && String(row.submitted_by ?? "") === targetUserId) || targetStudentIds.has(String(row.student_id ?? ""))
    );
    target.assignedComplaints = assignedRows.filter(row => targetStaffIds.has(String(row.assigned_staff_id ?? "")));
    target.notifications = notifications.filter(row =>
      targetStudentIds.has(String(row.recipient_student_id ?? "")) || targetStaffIds.has(String(row.recipient_staff_id ?? ""))
    );
    target.resourceTransactions = resourceTransactions.filter(row => targetStaffIds.has(String(row.staff_id ?? "")));
    target.activityLogs = activityLogs.filter(row =>
      targetStaffIds.has(String(row.actor_staff_id ?? "")) ||
      targetStaffIds.has(String(row.entity_id ?? "")) ||
      target.ownedComplaints.some(complaint => String(complaint.id) === String(row.entity_id ?? ""))
    );
    target.complaintActivity = complaintActivity.filter(row =>
      target.ownedComplaints.some(complaint => String(complaint.id) === String(row.complaint_id ?? "")) ||
      (targetUserId && String(row.actor_user_id ?? "") === targetUserId)
    );
    target.reviewRows = reviewRows.filter(row => targetUserId && String(row.reviewed_by ?? "") === targetUserId);
  }

  const requestIds = checkedIds(targets.flatMap(target => target.requests.map(row => String(row.id))), "Account requests", blockers);
  const { data: dependencyRows, error: dependencyError } = await client.rpc("hostelcare_cleanup_dependency_preview", {
    p_user_ids: userIds,
    p_student_ids: studentIds,
    p_staff_ids: staffIds,
    p_complaint_ids: ownedComplaintIds,
    p_account_request_ids: requestIds
  });
  if (dependencyError) {
    throw new Error("The read-only FK dependency scanner is unavailable. Apply database/migrations/20261108_targeted_cleanup_preview.sql before running cleanup. No data was changed.");
  }
  const dependencies = ((dependencyRows ?? []) as Row[]).sort((a, b) =>
    [a.source_schema, a.source_table, a.source_column, a.target_schema, a.target_table, a.constraint_name].join(".")
      .localeCompare([b.source_schema, b.source_table, b.source_column, b.target_schema, b.target_table, b.constraint_name].join("."))
  );
  const safeEdges = new Set([
    "auth.identities|auth.users|user_id",
    "public.students|auth.users|auth_user_id",
    "public.staff|auth.users|auth_user_id",
    "public.account_requests|auth.users|user_id",
    "public.complaints|auth.users|submitted_by",
    "public.complaint_activity|auth.users|actor_user_id",
    "public.complaints|public.students|student_id",
    "public.notifications|public.students|recipient_student_id",
    "public.complaints|public.staff|assigned_staff_id",
    "public.notifications|public.staff|recipient_staff_id",
    "public.resource_transactions|public.staff|staff_id",
    "public.activity_logs|public.staff|actor_staff_id",
    "public.complaint_activity|public.complaints|complaint_id",
    "public.account_requests|auth.users|reviewed_by"
  ]);
  for (const dependency of dependencies) {
    const edge = `${dependency.source_schema}.${dependency.source_table}|${dependency.target_schema}.${dependency.target_table}|${dependency.source_column}`;
    if (!dependency.supported) blockers.push(`Unsupported composite FK ${dependency.constraint_name} (${edge}); cleanup fails closed.`);
    else if (Number(dependency.matching_rows) > 0 && !safeEdges.has(edge)) blockers.push(`Unexpected FK dependency ${dependency.constraint_name}: ${dependency.matching_rows} row(s) in ${edge}.`);
  }

  const canonicalEmails = emails.slice().sort();
  const phrase = `DELETE HOSTELCARE TEST ACCOUNTS: ${canonicalEmails.join(",")}`;
  const hashInput = { targets, dependencies, blockers: blockers.slice().sort() };
  const hash = createHash("sha256").update(stable(hashInput)).digest("hex");
  return { targets, dependencies, blockers: [...new Set(blockers)].sort(), phrase, hash };
}

function showPlan(plan: Plan, executionPreflight = false): void {
  console.log(executionPreflight
    ? "\nEXECUTION PREFLIGHT — NO DATA HAS BEEN CHANGED YET"
    : "\nDRY-RUN PLAN — NO DATA HAS BEEN CHANGED");
  for (const target of plan.targets) {
    console.log(`\nAccount: ${target.email}`);
    console.log(target.user
      ? `  Auth user: ${target.user.id} | role=${String(target.user.app_metadata?.role ?? "Unassigned")} | created=${target.user.created_at}`
      : "  Auth user: NOT FOUND");
    console.log(`  Student profiles to remove: ${target.students.length}`);
    for (const row of target.students) console.log(`    ${row.id} | ${row.full_name} | ${row.email} | room_id=${row.room_id ?? "none"}`);
    console.log(`  Staff profiles to remove: ${target.staff.length}`);
    for (const row of target.staff) console.log(`    ${row.id} | ${row.full_name} | ${row.email} | role=${row.role} | active=${row.active}`);
    console.log(`  Account requests to remove: ${target.requests.length}`);
    for (const row of target.requests) console.log(`    ${row.id} | ${row.requested_role} | ${row.status} | submitted=${row.created_at}`);
  }
  const complaints = uniqueRows(plan.targets.flatMap(target => target.ownedComplaints));
  const assigned = uniqueRows(plan.targets.flatMap(target => target.assignedComplaints));
  const ownedComplaintIds = new Set(complaints.map(row => String(row.id)));
  const otherAssignments = assigned.filter(row => !ownedComplaintIds.has(String(row.id)));
  const notifications = uniqueRows(plan.targets.flatMap(target => target.notifications));
  const logs = uniqueRows(plan.targets.flatMap(target => target.activityLogs));
  const transactions = uniqueRows(plan.targets.flatMap(target => target.resourceTransactions));
  const history = uniqueRows(plan.targets.flatMap(target => target.complaintActivity));
  console.log(`\nUser-owned test complaints to remove: ${complaints.length}`);
  for (const row of complaints) console.log(`  ${row.id} | ${row.code} | ${row.title} | ${row.status} | submitter=${row.submitted_by ?? "none"} | student=${row.student_id ?? "none"}`);
  console.log(`Direct notifications to remove: ${notifications.length}`);
  for (const row of notifications) console.log(`  ${row.id} | ${row.title} | created=${row.created_at}`);
  console.log(`Complaint activity rows attached to those accounts/complaints: ${history.length} (complaint-linked history will cascade with planned complaint deletion)`);
  console.log(`Other complaints assigned to target staff (not planned for deletion): ${otherAssignments.length}`);
  for (const row of otherAssignments) console.log(`  ${row.id} | ${row.code} | ${row.title} | status=${row.status}`);
  console.log(`Inventory transaction dependencies: ${transactions.length}`);
  for (const row of transactions) console.log(`  ${row.id} | resource=${row.resource_id} | ${row.transaction_type} ${row.quantity}`);
  console.log(`Activity-log dependencies: ${logs.length}`);
  for (const row of logs) console.log(`  ${row.id} | ${row.action} | ${row.entity_type}:${row.entity_id}`);
  console.log("\nForeign-key dependencies:");
  for (const dep of plan.dependencies) {
    if (Number(dep.matching_rows) !== 0) console.log(`  ${dep.matching_rows} row(s) | ${dep.constraint_name}: ${dep.source_schema}.${dep.source_table}.${dep.source_column} -> ${dep.target_schema}.${dep.target_table} | ON DELETE ${dep.delete_action}`);
  }
  console.log("\nPreserved: all rooms, resources, inventory quantities, unrelated users, unrelated complaints, and database structure.");
  console.log(`Plan hash: ${plan.hash}`);
  console.log(`Required confirmation phrase: ${plan.phrase}`);
  if (plan.blockers.length) {
    console.log("\nBLOCKERS — cleanup will not run:");
    for (const blocker of plan.blockers) console.log(`  - ${blocker}`);
  }
}

async function deleteIds(table: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await client.from(table).delete().in("id", ids).select("id");
  if (error) throw new Error(`Deletion from ${table} failed: ${error.message}`);
  return data?.length ?? 0;
}

async function executePlan(plan: Plan): Promise<void> {
  if (plan.blockers.length) throw new Error("Cleanup was blocked by preflight findings; no data was changed.");
  const deletedAuth: string[] = [];
  let deletedRequests = 0;
  let deletedComplaints = 0;
  let deletedNotifications = 0;
  let deletedStudents = 0;
  let deletedStaff = 0;
  let cascadedActivity = 0;
  for (const target of plan.targets) {
    if (!target.user) throw new Error(`Auth user ${target.email} disappeared after preview; stopping.`);
    const requestIds = target.requests.map(row => String(row.id));
    let thisTargetRequestsDeleted = 0;
    if (requestIds.length) {
      const { data, error } = await client.from("account_requests").delete().in("id", requestIds).select("id");
      if (error) throw new Error(`Could not remove application rows for ${target.email}; no Auth deletion was attempted for this account: ${error.message}`);
      thisTargetRequestsDeleted = data?.length ?? 0;
      deletedRequests += thisTargetRequestsDeleted;
      console.log(`Account request rows temporarily removed for ${target.email}: ${thisTargetRequestsDeleted}`);
    }
    const { error: authError } = await client.auth.admin.deleteUser(target.user.id);
    if (authError) {
      if (target.requests.length) {
        const { error: restoreError } = await client.from("account_requests").insert(target.requests);
        if (!restoreError) {
          deletedRequests -= thisTargetRequestsDeleted;
          console.log(`Account request rows restored for ${target.email}: ${thisTargetRequestsDeleted}`);
        }
        else console.error(`Could not restore account request rows after Auth deletion failed for ${target.email}; request IDs: ${requestIds.join(", ")}`);
      }
      throw new Error(`Supabase Auth deletion failed for ${target.email}: ${authError.message}`);
    }
    deletedAuth.push(target.user.id);
    console.log(`Auth user deleted: ${target.email} (${target.user.id})`);

    const complaintIds = uniqueRows(target.ownedComplaints).map(row => String(row.id));
    const notificationIds = uniqueRows(target.notifications).map(row => String(row.id));
    const studentIds = uniqueRows(target.students).map(row => String(row.id));
    const staffIds = uniqueRows(target.staff).map(row => String(row.id));
    const historyCount = uniqueRows(target.complaintActivity.filter(row => complaintIds.includes(String(row.complaint_id)))).length;
    const complaintCount = await deleteIds("complaints", complaintIds);
    deletedComplaints += complaintCount;
    console.log(`  Complaint rows deleted for ${target.email}: ${complaintCount}`);
    const notificationCount = await deleteIds("notifications", notificationIds);
    deletedNotifications += notificationCount;
    console.log(`  Notification rows deleted for ${target.email}: ${notificationCount}`);
    const studentCount = await deleteIds("students", studentIds);
    deletedStudents += studentCount;
    console.log(`  Student profiles deleted for ${target.email}: ${studentCount}`);
    const staffCount = await deleteIds("staff", staffIds);
    deletedStaff += staffCount;
    console.log(`  Staff profiles deleted for ${target.email}: ${staffCount}`);
    cascadedActivity += historyCount;
    console.log(`  Complaint activity rows cascaded for ${target.email}: ${historyCount}`);
  }
  console.log("\nCleanup completed:");
  console.log(`  Auth users deleted through Supabase Admin API: ${deletedAuth.length}`);
  console.log(`  Student profiles deleted: ${deletedStudents}`);
  console.log(`  Staff profiles deleted: ${deletedStaff}`);
  console.log(`  Account request rows deleted: ${deletedRequests}`);
  console.log(`  User-owned complaints deleted: ${deletedComplaints}`);
  console.log(`  Complaint activity rows cascaded: ${cascadedActivity}`);
  console.log(`  Direct notifications deleted: ${deletedNotifications}`);
  console.log("  Rooms, resources, inventory, unrelated accounts, and unrelated complaints preserved.");
}

async function main(): Promise<void> {
  const rawEmails = option("--emails");
  if (!rawEmails) throw new Error("Provide exactly two email addresses with --emails first@example.com,second@example.com.");
  const emails = rawEmails.split(",").map(email => email.trim().toLowerCase());
  if (emails.length !== 2 || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || emails[0] === emails[1]) {
    throw new Error("Provide two distinct valid email addresses, separated by a comma.");
  }

  const plan = await buildPlan(emails);
  showPlan(plan, process.argv.includes("--execute"));
  if (!process.argv.includes("--execute")) return;

  if (option("--plan-hash") !== plan.hash) throw new Error("Plan hash does not match this fresh inspection. No data was changed.");
  if (option("--confirm") !== plan.phrase) throw new Error("Exact confirmation phrase is missing or does not match. No data was changed.");
  console.log("\nConfirmation and fresh preflight match. Starting targeted cleanup.");
  await executePlan(plan);

  const remainingUsers = await allAuthUsers();
  const remaining = remainingUsers.filter(user => user.email && emails.includes(user.email.toLowerCase()));
  if (remaining.length) throw new Error(`Post-delete verification failed: ${remaining.length} target Auth user(s) remain.`);
  console.log("Verification passed: neither target email remains in Supabase Auth.");
  const remainingProfileRows = uniqueRows([
    ...await rowsByEmails("students", emails),
    ...await rowsByEmails("staff", emails),
    ...await rowsByEmails("account_requests", emails)
  ]);
  if (remainingProfileRows.length) throw new Error(`Post-delete verification found ${remainingProfileRows.length} email-matched database row(s) still present.`);
  const residualProfiles = uniqueRows([
    ...await rowsBy("students", "id", plan.targets.flatMap(target => target.students.map(row => String(row.id)))),
    ...await rowsBy("staff", "id", plan.targets.flatMap(target => target.staff.map(row => String(row.id)))),
    ...await rowsBy("account_requests", "id", plan.targets.flatMap(target => target.requests.map(row => String(row.id))))
  ]);
  if (residualProfiles.length) throw new Error(`Post-delete verification found ${residualProfiles.length} linked profile/application row(s) still present.`);
  const residualNotifications = uniqueRows([
    ...await rowsBy("notifications", "recipient_student_id", plan.targets.flatMap(target => target.students.map(row => String(row.id)))),
    ...await rowsBy("notifications", "recipient_staff_id", plan.targets.flatMap(target => target.staff.map(row => String(row.id))))
  ]);
  if (residualNotifications.length) throw new Error(`Post-delete verification found ${residualNotifications.length} direct notification row(s) still present.`);
  const residualComplaints = uniqueRows([
    ...await rowsBy("complaints", "submitted_by", plan.targets.flatMap(target => target.user ? [target.user.id] : [])),
    ...await rowsBy("complaints", "id", uniqueRows(plan.targets.flatMap(target => target.ownedComplaints)).map(row => String(row.id)))
  ]);
  if (residualComplaints.length) throw new Error(`Post-delete verification found ${residualComplaints.length} target-owned complaint row(s) still present.`);
  console.log("Verification passed: email-matched Student/Staff profiles and account requests are absent.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Targeted cleanup stopped.");
  process.exitCode = 1;
});
