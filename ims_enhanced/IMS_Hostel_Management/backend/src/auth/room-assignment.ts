export function roomHasAvailability(capacity: number, occupied: number, isAlreadyAssigned: boolean, isAvailable = true): boolean {
  return isAlreadyAssigned || (isAvailable && capacity > 0 && occupied < capacity);
}

export function roomOccupancyIsValid(capacity: number, occupied: number): boolean {
  return Number.isInteger(capacity) && Number.isInteger(occupied) && capacity > 0 && occupied >= 0 && occupied <= capacity;
}
