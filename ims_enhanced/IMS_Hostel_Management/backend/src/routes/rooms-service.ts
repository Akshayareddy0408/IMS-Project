import { supabase } from "../supabase.js";
import { writeActivity } from "../audit.js";
import type { RoomInput, RoomRecord, RoomService } from "./rooms.js";

function mapRoom(row: any, occupiedCount = row.occupied_count): RoomRecord {
  return { id: row.id, roomNumber: row.room_number, block: row.block, floor: row.floor ?? null, capacity: row.capacity, occupiedCount, isAvailable: row.is_available !== false, availableCount: row.is_available === false ? 0 : Math.max(0, row.capacity - occupiedCount) };
}

export const roomService: RoomService = {
  async list() {
    const [{ data: rooms, error: roomsError }, { data: students, error: studentsError }] = await Promise.all([
      supabase.from("rooms").select("id,room_number,block,floor,capacity,occupied_count,is_available").order("block").order("room_number"),
      supabase.from("students").select("room_id")
    ]);
    if (roomsError || studentsError) throw new Error("Could not load room data.");
    const counts = new Map<string, number>();
    for (const student of students ?? []) if (student.room_id) counts.set(student.room_id, (counts.get(student.room_id) ?? 0) + 1);
    return (rooms ?? []).map(room => mapRoom(room, counts.get(room.id) ?? 0));
  },
  async create(input: RoomInput, actorId: string) {
    const { data: existingRooms, error: duplicateError } = await supabase.from("rooms").select("id,room_number");
    if (duplicateError) throw new Error("Could not check duplicate room numbers.");
    if ((existingRooms ?? []).some(room => room.room_number.trim().toLocaleLowerCase() === input.roomNumber.trim().toLocaleLowerCase())) throw new Error("A room with this identifier already exists (duplicate room number).");
    const { data, error } = await supabase.from("rooms").insert({ room_number: input.roomNumber.trim(), block: input.block.trim(), floor: input.floor, capacity: input.capacity, is_available: input.isAvailable, occupied_count: 0 }).select("id,room_number,block,floor,capacity,occupied_count,is_available").single();
    if (error) throw new Error(error.code === "23505" ? "A room with this identifier already exists (duplicate room number)." : "Could not create room.");
    await writeActivity(actorId, "Room created", "room", data.id, { room_number: data.room_number });
    return mapRoom(data);
  },
  async update(id: string, input: RoomInput, actorId: string) {
    const { data: existingRooms, error: duplicateError } = await supabase.from("rooms").select("id,room_number").neq("id", id);
    if (duplicateError) throw new Error("Could not check duplicate room numbers.");
    if ((existingRooms ?? []).some(room => room.room_number.trim().toLocaleLowerCase() === input.roomNumber.trim().toLocaleLowerCase())) throw new Error("A room with this identifier already exists (duplicate room number).");
    const { data, error } = await supabase.from("rooms").update({ room_number: input.roomNumber.trim(), block: input.block.trim(), floor: input.floor, capacity: input.capacity, is_available: input.isAvailable }).eq("id", id).select("id,room_number,block,floor,capacity,occupied_count,is_available").maybeSingle();
    if (error) throw new Error(error.code === "23505" ? "A room with this identifier already exists (duplicate room number)." : error.code === "23514" ? "Room capacity cannot be lower than its current occupancy." : "Could not update room.");
    if (!data) return null;
    const { count, error: countError } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("room_id", id);
    if (countError) throw new Error("Room details saved, but occupancy could not be refreshed.");
    await writeActivity(actorId, "Room updated", "room", id, { room_number: data.room_number, capacity: data.capacity, is_available: data.is_available });
    return mapRoom(data, count ?? 0);
  },
  async deleteEmpty(id: string, actorId: string) {
    const { error } = await supabase.rpc("hostelcare_delete_empty_room", { p_room_id: id });
    if (error) throw new Error(error.message.includes("Room not found") ? "Room not found." : error.message.includes("Room is occupied") ? "Room is occupied or linked to students and cannot be deleted." : "Could not safely delete room. Apply migration 20261108_01_room_management_safety.sql.");
    await writeActivity(actorId, "Room deleted", "room", id);
  }
};
