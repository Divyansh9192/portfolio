/**
 * NeonStays pricing, modelled on strategy/*.java and PricingService.java.
 *
 * PricingService.calculateDynamicPricing builds the chain on every call:
 *   new Holiday(new Urgency(new Occupancy(new Surge(new Base()))))
 * Each decorator first asks the strategy it wraps for a price, then applies its own rule, so the
 * multipliers run in the order Base -> Surge -> Occupancy -> Urgency -> Holiday.
 *
 * Arithmetic is exact (BigDecimal.multiply without a MathContext). Nothing rounds inside the chain.
 * PostgreSQL rounds to 2 decimals only when a value is stored into a numeric(10,2) column
 * (Inventory.price, HotelMinPrice.price, Booking.amount).
 */

import { DEC_ZERO, add, dec, fromInt, mul, roundHalfUp, toPlain, truncToBigInt, valueOfDouble, type Decimal } from "./booking/decimal";

export type StrategyName = "Base" | "Surge" | "Occupancy" | "Urgency" | "Holiday";

/** Real composition order (PricingService.java:12-20). */
export const CHAIN_ORDER: readonly StrategyName[] = ["Base", "Surge", "Occupancy", "Urgency", "Holiday"];

/** The literal multipliers, as BigDecimal.valueOf(double) produces them. */
export const OCCUPANCY_MULTIPLIER = valueOfDouble(1.2);
export const URGENCY_MULTIPLIER = valueOfDouble(1.25);
export const HOLIDAY_MULTIPLIER = valueOfDouble(1.4);
/** OccupancyPricingStrategy: applies when bookedCount / totalCount > 0.8 (strictly greater). */
export const OCCUPANCY_THRESHOLD = 0.8;
/** UrgencyPricingStrategy: applies when date is in [today, today + 7). */
export const URGENCY_WINDOW_DAYS = 7;
/** HolidayPricingStrategy: `boolean isTodayHoliday = true;// Call a Third-party API to get Holidays` */
export const IS_TODAY_HOLIDAY = true;

/** numeric(10,2): largest value Booking.amount / Inventory.price can hold. */
export const NUMERIC_10_2_MAX = dec("99999999.99");

export interface NightInput {
  /** inventory.date minus today, in days. */
  dayOffset: number;
  /** room.basePrice (numeric(10,2)). */
  basePrice: Decimal;
  /** inventory.surgeFactor (numeric(5,2), default 1). */
  surgeFactor: Decimal;
  bookedCount: number;
  totalCount: number;
}

export interface ChainStep {
  name: StrategyName;
  /** Multiplier this decorator would apply, as text ("1.2"); null for Base. */
  factor: string | null;
  applied: boolean;
  /** Why it did or did not apply, in the code's own terms. */
  reason: string;
  /** Running price after this step (exact). */
  value: Decimal;
}

export interface NightPrice {
  dayOffset: number;
  steps: ChainStep[];
  /** calculateDynamicPricing(inventory): exact BigDecimal. */
  price: Decimal;
  occupancyRate: number;
}

function pct(r: number): string {
  if (!Number.isFinite(r)) return String(r);
  return `${Math.round(r * 1000) / 10}%`;
}

/** calculateDynamicPricing for one inventory row. */
export function priceNight(n: NightInput): NightPrice {
  const steps: ChainStep[] = [];
  let price = n.basePrice;
  steps.push({ name: "Base", factor: null, applied: true, reason: "room.basePrice", value: price });

  price = mul(price, n.surgeFactor);
  steps.push({ name: "Surge", factor: toPlain(n.surgeFactor), applied: true, reason: "x inventory.surgeFactor, always applied", value: price });

  // Java: double occupancyRate = (double) bookedCount / totalCount; same IEEE double semantics in JS.
  const occupancyRate = n.bookedCount / n.totalCount;
  const occ = occupancyRate > OCCUPANCY_THRESHOLD;
  if (occ) price = mul(price, OCCUPANCY_MULTIPLIER);
  steps.push({
    name: "Occupancy",
    factor: "1.2",
    applied: occ,
    reason: `booked/total = ${n.bookedCount}/${n.totalCount} = ${pct(occupancyRate)} ${occ ? ">" : "is not >"} 80%`,
    value: price,
  });

  const urg = n.dayOffset >= 0 && n.dayOffset < URGENCY_WINDOW_DAYS;
  if (urg) price = mul(price, URGENCY_MULTIPLIER);
  steps.push({
    name: "Urgency",
    factor: "1.25",
    applied: urg,
    reason: urg ? `date is today + ${n.dayOffset}, inside [today, today + 7)` : `date is today + ${n.dayOffset}, outside [today, today + 7)`,
    value: price,
  });

  if (IS_TODAY_HOLIDAY) price = mul(price, HOLIDAY_MULTIPLIER);
  steps.push({ name: "Holiday", factor: "1.4", applied: IS_TODAY_HOLIDAY, reason: "isTodayHoliday is hard-coded to true", value: price });

  return { dayOffset: n.dayOffset, steps, price, occupancyRate };
}

export interface StayInput {
  /** Text as typed; stored as numeric(10,2). */
  basePrice: string;
  /** Text as typed; stored as numeric(5,2). */
  surgeFactor: string;
  totalCount: number;
  bookedCount: number;
  /** Days from today to checkInDate. */
  checkInOffset: number;
  /**
   * Inventory rows priced. /init prices every row from checkInDate to checkOutDate inclusive
   * (DAYS.between + 1), so this is checkOutDate - checkInDate + 1.
   */
  rows: number;
  roomsCount: number;
}

export interface StayPrice {
  nights: NightPrice[];
  /** pricingService.calculateTotalPrice(inventoryList): exact sum, one room. */
  priceForOneRoom: Decimal;
  /** priceForOneRoom x roomsCount: exact, what initialiseBooking puts on the Booking. */
  totalPrice: Decimal;
  /** What PostgreSQL keeps in Booking.amount (numeric(10,2)). */
  storedAmount: Decimal;
  /** CheckoutServiceImpl: amount x 100, .longValue(), currency "inr" (paise). */
  stripeUnitAmount: bigint;
  /** True when the amount exceeds numeric(10,2) and the INSERT would fail. */
  overflow: boolean;
}

/** Parse and normalise inputs the way the columns would store them. Returns null when invalid. */
export function normaliseMoney(text: string, maxText: string): Decimal | null {
  let d: Decimal;
  try {
    d = dec(text);
  } catch {
    return null;
  }
  const r = roundHalfUp(d, 2);
  if (r.unscaled <= BigInt(0)) return null;
  if (cmp(r, dec(maxText)) > 0) return null;
  return r;
}

export function cmp(a: Decimal, b: Decimal): number {
  const diff = add(a, { unscaled: -b.unscaled, scale: b.scale }).unscaled;
  return diff === BigInt(0) ? 0 : diff > BigInt(0) ? 1 : -1;
}

export function priceStay(input: StayInput): StayPrice {
  const base = normaliseMoney(input.basePrice, "99999999.99") ?? dec("0.00");
  const surge = normaliseMoney(input.surgeFactor, "999.99") ?? dec("1.00");
  const nights: NightPrice[] = [];
  for (let i = 0; i < input.rows; i++) {
    nights.push(
      priceNight({
        dayOffset: input.checkInOffset + i,
        basePrice: base,
        surgeFactor: surge,
        bookedCount: input.bookedCount,
        totalCount: input.totalCount,
      }),
    );
  }
  // calculateTotalPrice: inventoryList.stream().map(calculateDynamicPricing).reduce(BigDecimal.ZERO, add)
  const priceForOneRoom = nights.reduce<Decimal>((acc, n) => add(acc, n.price), DEC_ZERO);
  // initialiseBooking: priceForOneRoom.multiply(BigDecimal.valueOf(roomsCount))
  const totalPrice = mul(priceForOneRoom, fromInt(input.roomsCount));
  const storedAmount = roundHalfUp(totalPrice, 2);
  const overflow = cmp(storedAmount, NUMERIC_10_2_MAX) > 0;
  // getCheckoutSession reads the booking back from the database, so amount has scale 2 here.
  const stripeUnitAmount = truncToBigInt(mul(storedAmount, fromInt(100)));
  return { nights, priceForOneRoom, totalPrice, storedAmount, stripeUnitAmount, overflow };
}

/* ------------------------------------------------------------------ */
/* Hourly repricing and the search read model                          */
/* ------------------------------------------------------------------ */

/** PricingUpdateService: @Scheduled(cron = "0 0 * * * *"), hotels paged 100 at a time, today to today + 1 year. */
export const PRICING_CRON = "0 0 * * * *";
export const PRICING_BATCH_SIZE = 100;

export interface RepriceTimeline {
  /** Minute past the hour when the admin PATCHes surgeFactor. */
  changeMinute: number;
  /** Minutes until the next cron run writes the new Inventory.price and HotelMinPrice. */
  staleMinutes: number;
  /** Price /init charges right after the change (live chain, exact). */
  liveAfter: Decimal;
  /** Price search and the room price endpoint show until the next run (stored, rounded). */
  storedBefore: Decimal;
  /** Stored price after the next run. */
  storedAfter: Decimal;
}

/**
 * What a surgeFactor change looks like to each reader of price.
 * PATCH /api/v1/admin/inventory/rooms/{roomId} updates surgeFactor only (InventoryServiceImpl.updateInventory);
 * Inventory.price and HotelMinPrice change at the next hourly run.
 */
export function repriceTimeline(night: Omit<NightInput, "surgeFactor">, oldSurge: Decimal, newSurge: Decimal, changeMinute: number): RepriceTimeline {
  const m = Math.min(59, Math.max(1, Math.round(changeMinute)));
  const before = priceNight({ ...night, surgeFactor: oldSurge }).price;
  const after = priceNight({ ...night, surgeFactor: newSurge }).price;
  return {
    changeMinute: m,
    staleMinutes: 60 - m,
    liveAfter: after,
    storedBefore: roundHalfUp(before, 2),
    storedAfter: roundHalfUp(after, 2),
  };
}
