import { Router } from "express";
import { supabase } from "../supabase.js";
import { forwardAsyncErrors } from "../middleware/async-errors.js";

const router = Router();
router.get("/", async (req, res) => {
  if (!req.user || (req.user.role !== "Administrator" && req.user.role !== "Warden")) return res.status(403).json({ message: "Dashboard is available to hostel managers." });
  const [cResult, rResult] = await Promise.all([
    supabase.from("complaints").select("status, priority"),
    supabase.from("resources").select("quantity, minimum_stock")
  ]);
  if (cResult.error) return res.status(500).json({ message: "Could not calculate complaint statistics." });
  if (rResult.error) return res.status(500).json({ message: "Could not calculate inventory statistics." });
  const complaints = cResult.data ?? [];
  const resources = rResult.data ?? [];
  const done = ["Resolved", "Closed"];
  const statuses = ["Submitted", "Reviewed", "Assigned", "In Progress", "Resolved", "Closed"];
  return res.json({
    totalComplaints: complaints.length,
    openComplaints: complaints.filter(c => !done.includes(c.status)).length,
    resolvedComplaints: complaints.filter(c => done.includes(c.status)).length,
    urgentComplaints: complaints.filter(c => c.priority === "Urgent" && !done.includes(c.status)).length,
    lowStockItems: resources.filter(r => r.quantity <= r.minimum_stock).length,
    statusCounts: Object.fromEntries(statuses.map(s => [s, complaints.filter(c => c.status === s).length]))
  });
});
export default forwardAsyncErrors(router);
