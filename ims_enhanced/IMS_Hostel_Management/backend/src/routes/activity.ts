import { Router } from "express";
import { supabase } from "../supabase.js";
import { forwardAsyncErrors } from "../middleware/async-errors.js";

const router = Router();
router.get("/", async (req, res) => {
  if (req.user?.role !== "Administrator") return res.status(403).json({ message: "Only Administrators can view system activity." });
  const { data, error } = await supabase.from("activity_logs").select("id,action,entity_type,entity_id,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ message: "Could not load activity history." });
  // Do not return free-form details: older log rows may contain data that is not suitable for a broad admin activity feed.
  return res.json((data ?? []).map(row => ({ id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_type === "auth_user" ? null : row.entity_id, createdAt: row.created_at })));
});
export default forwardAsyncErrors(router);
