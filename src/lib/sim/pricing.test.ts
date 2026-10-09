import { describe, expect, it } from "vitest";
import { CHAIN_ORDER, priceNight, priceStay, repriceTimeline } from "./pricing";
import { dec, format2, roundHalfUp, toPlain, valueOfDouble } from "./booking/decimal";

describe("decimal (BigDecimal mirror)", () => {
  it("valueOf(double) keeps the short scale", () => {
    expect(toPlain(valueOfDouble(1.2))).toBe("1.2");
    expect(toPlain(valueOfDouble(1.25))).toBe("1.25");
    expect(toPlain(valueOfDouble(1.4))).toBe("1.4");
  });
  it("rounds half up to 2 dp", () => {
    expect(toPlain(roundHalfUp(dec("3079.98460"), 2))).toBe("3079.98");
    expect(toPlain(roundHalfUp(dec("0.125"), 2))).toBe("0.13");
    expect(format2(dec("1234567.005"))).toBe("1,234,567.01");
  });
});

describe("pricing chain", () => {
  it("runs Base → Surge → Occupancy → Urgency → Holiday", () => {
    const n = priceNight({ dayOffset: 3, basePrice: dec("2000.00"), surgeFactor: dec("1.00"), bookedCount: 9, totalCount: 10 });
    expect(n.steps.map((s) => s.name)).toEqual([...CHAIN_ORDER]);
  });

  it("base 2000, surge 1.0, occupancy 0.9, 3 days out = 2000 × 1.2 × 1.25 × 1.4 = 4200 (exact BigDecimal scale 8)", () => {
    const n = priceNight({ dayOffset: 3, basePrice: dec("2000.00"), surgeFactor: dec("1.00"), bookedCount: 9, totalCount: 10 });
    expect(toPlain(n.price)).toBe("4200.00000000");
    expect(n.steps.map((s) => s.applied)).toEqual([true, true, true, true, true]);
  });

  it("occupancy is strictly greater than 80%", () => {
    const at80 = priceNight({ dayOffset: 30, basePrice: dec("1000.00"), surgeFactor: dec("1.00"), bookedCount: 8, totalCount: 10 });
    expect(at80.steps[2].applied).toBe(false);
    expect(format2(at80.price)).toBe("1,400.00");
  });

  it("urgency window is [today, today + 7)", () => {
    const p = (d: number) => priceNight({ dayOffset: d, basePrice: dec("1000.00"), surgeFactor: dec("1.00"), bookedCount: 0, totalCount: 10 }).steps[3].applied;
    expect([0, 6, 7, -1].map(p)).toEqual([true, true, false, false]);
  });

  it("holiday ×1.4 always applies (isTodayHoliday is hard-coded)", () => {
    const n = priceNight({ dayOffset: 60, basePrice: dec("1999.99"), surgeFactor: dec("1.10"), bookedCount: 1, totalCount: 10 });
    expect(n.steps[4].applied).toBe(true);
    expect(toPlain(n.price)).toBe("3079.98460");
  });

  it("calculateTotalPrice sums nights, × roomsCount; amount is stored to 2 dp; Stripe gets paise", () => {
    const stay = priceStay({ basePrice: "1999.99", surgeFactor: "1.10", totalCount: 10, bookedCount: 1, checkInOffset: 5, rows: 3, roomsCount: 2 });
    // nights at +5 and +6 get urgency, +7 does not
    expect(stay.nights.map((n) => n.steps[3].applied)).toEqual([true, true, false]);
    expect(toPlain(stay.priceForOneRoom)).toBe("10779.9461000"); // 3849.9807500 + 3849.9807500 + 3079.98460
    expect(toPlain(stay.storedAmount)).toBe("21559.89");
    expect(stay.stripeUnitAmount.toString()).toBe("2155989");
    expect(stay.overflow).toBe(false);
  });

  it("is deterministic", () => {
    const input = { basePrice: "2500", surgeFactor: "1.5", totalCount: 5, bookedCount: 5, checkInOffset: 0, rows: 4, roomsCount: 1 };
    expect(priceStay(input)).toEqual(priceStay(input));
  });
});

describe("hourly repricing", () => {
  it("a surge change at :20 reaches search 40 minutes later; /init charges it at once", () => {
    const t = repriceTimeline({ dayOffset: 10, basePrice: dec("2000.00"), bookedCount: 0, totalCount: 10 }, dec("1.00"), dec("1.50"), 20);
    expect(t.staleMinutes).toBe(40);
    expect(format2(t.storedBefore)).toBe("2,800.00");
    expect(format2(t.liveAfter)).toBe("4,200.00");
  });
});
