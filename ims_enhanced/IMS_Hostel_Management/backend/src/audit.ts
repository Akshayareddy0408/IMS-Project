import { supabase } from "./supabase.js";

/** Logs a minimal, non-secret audit event. Details should contain identifiers/statuses only. */
export async function writeActivity(actorUserId: string, action: string, entityType: string, entityId: string | null, details: Record<string, unknown> = {}) {
  const { data: staff } = await supabase.from("staff").select("id").eq("auth_user_id", actorUserId).maybeSingle();
  const { error } = await supabase.from("activity_logs").insert({ actor_staff_id: staff?.id ?? null, action, entity_type: entityType, entity_id: entityId, details });
  if (error) console.error("HostelCare activity log write failed.");
}
