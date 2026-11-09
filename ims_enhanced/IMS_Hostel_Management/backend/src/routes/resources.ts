import { Router } from "express";
import { z } from "zod";
import { supabase } from "../supabase.js";
import type { Resource } from "../types.js";
import { writeActivity } from "../audit.js";
import { canManageInventory, canViewInventoryHistory, isValidInventoryQuantity } from "../auth/inventory-access.js";
import { forwardAsyncErrors } from "../middleware/async-errors.js";

const router = Router();
const resourceIdSchema = z.string().uuid();
const resourceSchema = z.object({ name: z.string().trim().min(2).max(100), category: z.string().trim().min(1).max(60), location: z.string().trim().min(1).max(100), quantity: z.number().int().min(0).max(100000), minimumStock: z.number().int().min(0).max(100000), unit: z.string().trim().min(1).max(24) });
function toResource(row: any): Resource {
  return { id: row.id, name: row.name, category: row.category, location: row.location,
    quantity: row.quantity, minimumStock: row.minimum_stock, unit: row.unit };
}

router.get("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ message: "Please sign in." });
  if (req.user.role === "Pending" || req.user.role === "Unassigned") return res.status(403).json({ message: "Your account is not active yet." });
  const { data, error } = await supabase.from("resources").select("*").order("name");
  if (error) return res.status(500).json({ message: "Could not load inventory." });
  return res.json((data ?? []).map(toResource));
});

router.post("/", async (req, res) => {
  if (!req.user || !canManageInventory(req.user.role)) return res.status(403).json({ message: "Only Administrators can create inventory items." });
  const parsed = resourceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Enter a name, category, location, non-negative quantities, and unit." });
  const { data, error } = await supabase.from("resources").insert({ name: parsed.data.name, category: parsed.data.category, location: parsed.data.location, quantity: parsed.data.quantity, minimum_stock: parsed.data.minimumStock, unit: parsed.data.unit }).select("*").single();
  if (error) return res.status(500).json({ message: "Could not create the inventory item." });
  await writeActivity(req.user!.id, "Resource created", "resource", data.id);
  return res.status(201).json(toResource(data));
});

router.patch("/:id", async (req, res) => {
  if (!req.user || !canManageInventory(req.user.role)) return res.status(403).json({ message: "Only Administrators can edit inventory items." });
  if (!resourceIdSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid inventory item identifier." });
  const parsed = resourceSchema.omit({ quantity: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Enter a valid name, category, location, minimum stock, and unit." });
  const { data, error } = await supabase.from("resources").update({ name: parsed.data.name, category: parsed.data.category, location: parsed.data.location, minimum_stock: parsed.data.minimumStock, unit: parsed.data.unit }).eq("id", req.params.id).select("*").maybeSingle();
  if (error) return res.status(500).json({ message: "Could not update the inventory item." });
  if (!data) return res.status(404).json({ message: "Inventory item not found." });
  await writeActivity(req.user!.id, "Resource updated", "resource", data.id);
  return res.json(toResource(data));
});

router.get("/:id/transactions", async (req, res) => {
  if (!req.user || !canViewInventoryHistory(req.user.role)) return res.status(403).json({ message: "Only hostel managers can view inventory history." });
  if (!resourceIdSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid inventory item identifier." });
  const { data, error } = await supabase.from("resource_transactions").select("id,resource_id,transaction_type,quantity,note,created_at,staff(full_name)").eq("resource_id", req.params.id).order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ message: "Could not load inventory history." });
  return res.json((data ?? []).map((row: any) => ({ id: row.id, resourceId: row.resource_id, transactionType: row.transaction_type, quantity: row.quantity, note: row.note, staffName: row.staff?.full_name ?? null, createdAt: row.created_at })));
});

router.patch("/:id/quantity", async (req, res) => {
  if (!req.user || !canManageInventory(req.user.role)) return res.status(403).json({ message: "Only Administrators can change inventory." });
  if (!resourceIdSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid inventory item identifier." });
  const parsed = z.object({ quantity: z.unknown().refine(isValidInventoryQuantity) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Quantity must be a non-negative whole number." });
  const { data: staff } = await supabase.from("staff").select("id").eq("auth_user_id", req.user.id).maybeSingle();
  const { data, error } = await supabase.rpc("set_resource_quantity", {
    p_resource_id: req.params.id,
    p_quantity: parsed.data.quantity,
    p_actor_staff_id: staff?.id ?? null
  });
  if (error) return res.status(error.message.includes("Resource not found") ? 404 : 500).json({ message: error.message.includes("Resource not found") ? "Resource not found." : "Could not save inventory change. Apply database migration 20261107_02_auth_role_safety.sql." });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return res.status(404).json({ message: "Resource not found." });
  await writeActivity(req.user!.id, "Resource quantity adjusted", "resource", req.params.id, { quantity: row.quantity });
  return res.json(toResource(row));
});
export default forwardAsyncErrors(router);
