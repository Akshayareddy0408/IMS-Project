import { Router } from "express";
import { supabase } from "../supabase.js";
import { notificationRecipient } from "../auth/notification-access.js";
import { z } from "zod";
import { forwardAsyncErrors } from "../middleware/async-errors.js";

const router = Router();

router.get("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ message: "Please sign in." });
  const target = notificationRecipient(req.user.role);
  if (!target) return res.status(403).json({ message: "Your account cannot access notifications yet." });
  const { table, column } = target;
  const { data: profile, error: profileError } = await supabase.from(table).select("id").eq("auth_user_id", req.user.id).maybeSingle();
  if (profileError) return res.status(500).json({ message: "Could not load your notification profile." });
  if (!profile) return res.json([]);
  const { data, error } = await supabase.from("notifications").select("id,title,message,read_at,created_at").eq(column, profile.id).order("created_at", { ascending: false }).limit(50);
  if (error) return res.status(500).json({ message: "Could not load notifications." });
  return res.json(data ?? []);
});

router.patch("/:id/read", async (req, res) => {
  if (!req.user) return res.status(401).json({ message: "Please sign in." });
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid notification identifier." });
  const target = notificationRecipient(req.user.role);
  if (!target) return res.status(403).json({ message: "Your account cannot access notifications yet." });
  const { table, column } = target;
  const { data: profile, error: profileError } = await supabase.from(table).select("id").eq("auth_user_id", req.user.id).maybeSingle();
  if (profileError) return res.status(500).json({ message: "Could not verify notification ownership." });
  if (!profile) return res.status(404).json({ message: "Notification not found." });
  const { data, error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", req.params.id).eq(column, profile.id).select("id,read_at").maybeSingle();
  if (error) return res.status(500).json({ message: "Could not update notification." });
  if (!data) return res.status(404).json({ message: "Notification not found." });
  return res.json(data);
});

export default forwardAsyncErrors(router);
