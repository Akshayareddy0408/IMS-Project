import { Router } from "express";
import { z } from "zod";
import type { AuthRole } from "../auth/roles.js";
import { forwardAsyncErrors } from "../middleware/async-errors.js";

export interface RoomRecord { id: string; roomNumber: string; block: string; floor: number | null; capacity: number; occupiedCount: number; availableCount: number; isAvailable: boolean }
export interface RoomInput { roomNumber: string; block: string; floor: number | null; capacity: number; isAvailable: boolean }
export interface RoomService {
  list(): Promise<RoomRecord[]>;
  create(input: RoomInput, actorId: string): Promise<RoomRecord>;
  update(id: string, input: RoomInput, actorId: string): Promise<RoomRecord | null>;
  deleteEmpty(id: string, actorId: string): Promise<void>;
}

const roomSchema = z.object({ roomNumber: z.string().trim().min(1).max(30), block: z.string().trim().min(1).max(60), floor: z.number().int().min(0).max(300).nullable(), capacity: z.number().int().min(1).max(1000), isAvailable: z.boolean() });
const roomIdSchema = z.string().uuid();
const managerRoles: AuthRole[] = ["Warden", "Administrator"];

export function createRoomsRouter(service: RoomService) {
  const router = Router();
  router.get("/", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Please sign in." });
    if (!managerRoles.includes(req.user.role)) return res.status(403).json({ message: "Only Wardens and Administrators can view room occupancy." });
    try { return res.json(await service.list()); }
    catch { return res.status(500).json({ message: "Could not load rooms." }); }
  });

  router.post("/", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Please sign in." });
    if (req.user.role !== "Administrator") return res.status(403).json({ message: "Only Administrators can manage rooms." });
    const parsed = roomSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Provide a room number, block, valid floor, and positive capacity." });
    try { return res.status(201).json(await service.create(parsed.data, req.user.id)); }
    catch (error) { const message = error instanceof Error ? error.message : "Could not create room."; return res.status(message.includes("duplicate") ? 409 : 500).json({ message }); }
  });

  router.patch("/:id", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Please sign in." });
    if (req.user.role !== "Administrator") return res.status(403).json({ message: "Only Administrators can manage rooms." });
    if (!roomIdSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid room identifier." });
    const parsed = roomSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Provide a room number, block, valid floor, and positive capacity." });
    try { const room = await service.update(req.params.id, parsed.data, req.user.id); return room ? res.json(room) : res.status(404).json({ message: "Room not found." }); }
    catch (error) { const message = error instanceof Error ? error.message : "Could not update room."; return res.status(message.includes("duplicate") ? 409 : message.includes("capacity") ? 409 : 500).json({ message }); }
  });

  router.delete("/:id", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Please sign in." });
    if (req.user.role !== "Administrator") return res.status(403).json({ message: "Only Administrators can manage rooms." });
    if (!roomIdSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid room identifier." });
    try { await service.deleteEmpty(req.params.id, req.user.id); return res.json({ id: req.params.id, deleted: true }); }
    catch (error) { const message = error instanceof Error ? error.message : "Could not delete room."; return res.status(message.includes("not found") ? 404 : message.includes("occupied") ? 409 : 500).json({ message }); }
  });
  return forwardAsyncErrors(router);
}
