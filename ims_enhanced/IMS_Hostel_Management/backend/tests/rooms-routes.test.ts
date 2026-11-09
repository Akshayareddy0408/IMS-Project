import assert from "node:assert/strict";
import test from "node:test";
import { createRoomsRouter, type RoomInput, type RoomRecord, type RoomService } from "../src/routes/rooms.js";
import { roomHasAvailability, roomOccupancyIsValid } from "../src/auth/room-assignment.js";

const roomId = "11111111-1111-4111-8111-111111111111";

function makeService(): RoomService {
  const rooms: RoomRecord[] = [{ id: roomId, roomNumber: "A-101", block: "A", floor: 1, capacity: 2, occupiedCount: 2, availableCount: 0, isAvailable: true }];
  return {
    async list() { return rooms; },
    async create(input: RoomInput) {
      if (rooms.some(room => room.roomNumber.toLowerCase() === input.roomNumber.toLowerCase())) throw new Error("duplicate room number");
      const room = { id: "22222222-2222-4222-8222-222222222222", ...input, occupiedCount: 0, availableCount: input.isAvailable ? input.capacity : 0 };
      rooms.push(room);
      return room;
    },
    async update(id: string, input: RoomInput) {
      const room = rooms.find(item => item.id === id);
      if (!room) return null;
      if (rooms.some(item => item.id !== id && item.roomNumber.toLowerCase() === input.roomNumber.toLowerCase())) throw new Error("duplicate room number");
      if (input.capacity < room.occupiedCount) throw new Error("capacity below occupancy");
      Object.assign(room, input, { availableCount: input.isAvailable ? input.capacity - room.occupiedCount : 0 });
      return room;
    },
    async deleteEmpty(id: string) {
      const index = rooms.findIndex(item => item.id === id);
      if (index < 0) throw new Error("Room not found");
      if (rooms[index].occupiedCount) throw new Error("Room is occupied or linked to students");
      rooms.splice(index, 1);
    }
  };
}

function createTestRouter() { return createRoomsRouter(makeService()); }
async function invoke(router: ReturnType<typeof createTestRouter>, method: string, path: string, role?: string, body?: unknown) {
  const layer = router.stack.find((item: any) => item.route?.path === path && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `route ${method} ${path} exists`);
  const handler = (layer as any).route.stack[0].handle as (req: any, res: any, next: (error?: unknown) => void) => unknown;
  let statusCode = 200;
  let payload: unknown;
  const req: any = { method, params: path === "/" ? {} : { id: roomId }, body, user: role ? { id: `${role.toLowerCase()}-1`, email: undefined, role, userMetadata: {}, appMetadata: {} } : undefined };
  const res: any = { status(code: number) { statusCode = code; return this; }, json(value: unknown) { payload = value; return this; } };
  await handler(req, res, error => { if (error) throw error; });
  return { statusCode, payload };
}

test("room CRUD routes enforce manager/admin roles, validation, duplicate IDs, capacity and occupied deletion rules", async t => {
  const router = createTestRouter();
  assert.equal((await invoke(router, "GET", "/")).statusCode, 401);
  assert.equal((await invoke(router, "GET", "/", "Student")).statusCode, 403);
  assert.equal((await invoke(router, "GET", "/", "Warden")).statusCode, 200);
  assert.equal((await invoke(router, "POST", "/", "Warden", {})).statusCode, 403);
  assert.equal((await invoke(router, "POST", "/", "Administrator", { roomNumber: "A-102", block: "A", floor: 1, capacity: 0, isAvailable: true })).statusCode, 400);
  assert.equal((await invoke(router, "POST", "/", "Administrator", { roomNumber: "a-101", block: "A", floor: 1, capacity: 2, isAvailable: true })).statusCode, 409);
  assert.equal((await invoke(router, "PATCH", "/:id", "Administrator", { roomNumber: "A-101", block: "A", floor: 1, capacity: 1, isAvailable: true })).statusCode, 409);
  assert.equal((await invoke(router, "DELETE", "/:id", "Administrator")).statusCode, 409);
  assert.equal((await invoke(router, "POST", "/", "Administrator", { roomNumber: "A-102", block: "A", floor: 1, capacity: 2, isAvailable: true })).statusCode, 201);
});

test("room assignment rules honor occupancy, current assignments and availability", () => {
  assert.equal(roomHasAvailability(2, 1, false), true);
  assert.equal(roomHasAvailability(2, 2, false), false);
  assert.equal(roomHasAvailability(2, 2, true), true);
  assert.equal(roomHasAvailability(2, 0, false, false), false);
  assert.equal(roomOccupancyIsValid(2, 2), true);
  assert.equal(roomOccupancyIsValid(2, 3), false);
  assert.equal(roomOccupancyIsValid(0, 0), false);
});
