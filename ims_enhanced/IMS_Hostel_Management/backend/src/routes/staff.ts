import { Router } from "express";
import { supabase } from "../supabase.js";
import { forwardAsyncErrors } from "../middleware/async-errors.js";

const router = Router();

router.get("/", async (req, res) => {
  if (
    req.user?.role !== "Warden" &&
    req.user?.role !== "Administrator"
  ) {
    return res.status(403).json({
      message: "Only Wardens and Administrators can view staff."
    });
  }

  const { data, error } = await supabase
    .from("staff")
    .select("id, full_name, email, role")
    .eq("role", "Maintenance")
    .eq("active", true)
    .order("full_name");

  if (error) {
    return res.status(500).json({
      message: error.message
    });
  }

  return res.json(data ?? []);
});

export default forwardAsyncErrors(router);
