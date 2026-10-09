/** Shared types for the NeonStays booking simulation. Names match the Java code. */

/** entity/enums/BookingStatus.java. EXPIRE is declared but no code ever assigns it. */
export type BookingStatus = "RESERVED" | "GUEST_ADDED" | "PAYMENT_PENDING" | "CONFIRMED" | "CANCELLED" | "EXPIRE";

export const BOOKING_STATUSES: readonly BookingStatus[] = ["RESERVED", "GUEST_ADDED", "PAYMENT_PENDING", "CONFIRMED", "CANCELLED", "EXPIRE"];

/** One Inventory row (entity/Inventory.java): one room type on one date. */
export interface InventoryRow {
  /** Display label for inventory.date, relative to the simulated today ("today+3"). */
  date: string;
  /** inventory.date minus today, in days. */
  dayOffset: number;
  totalCount: number;
  bookedCount: number;
  reservedCount: number;
  closed: boolean;
}

/** totalCount - bookedCount - reservedCount, the availability expression in every booking query. */
export function availableOf(r: InventoryRow): number {
  return r.totalCount - r.bookedCount - r.reservedCount;
}

export type Tone = "ok" | "warn" | "crit" | "neutral";

export function dateLabel(dayOffset: number): string {
  return dayOffset === 0 ? "today" : `today+${dayOffset}`;
}

/** Build the per-night rows for a stay. */
export function makeRows(dayOffsets: number[], totalCount: number, booked: number[] | number, reserved = 0): InventoryRow[] {
  return dayOffsets.map((d, i) => ({
    date: dateLabel(d),
    dayOffset: d,
    totalCount,
    bookedCount: Array.isArray(booked) ? booked[i] : booked,
    reservedCount: reserved,
    closed: false,
  }));
}
