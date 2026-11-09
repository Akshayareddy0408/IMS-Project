import type { AuthRole } from "./roles.js";

export function canManageInventory(role: AuthRole): boolean { return role === "Administrator"; }
export function canViewInventoryHistory(role: AuthRole): boolean { return role === "Administrator" || role === "Warden"; }
export function isValidInventoryQuantity(quantity: unknown): quantity is number { return typeof quantity === "number" && Number.isInteger(quantity) && quantity >= 0 && quantity <= 100000; }
