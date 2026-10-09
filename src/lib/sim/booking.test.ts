import { describe, expect, it } from "vitest";
import {
  addGuests,
  allFinalStates,
  cancelBooking,
  createRace,
  createUnhandledEvent,
  deliver,
  deliverBurst,
  initBooking,
  initiatePayments,
  latestEvent,
  outcome,
  pay,
  runRetry,
  runToEnd,
  scenarioCheckoutTwice,
  scenarioPaid,
  setMode,
  startScenario,
  tick,
  worldFromHolds,
  type RaceMode,
  type World,
} from "./booking";

const lastLog = (w: World) => w.log[w.log.length - 1];
const booking = (w: World, id = 101) => w.bookings.find((b) => b.id === id)!;

describe("race for the last room", () => {
  it("row lock: B waits, then fails the size check; one booking, counts match", () => {
    const s = runToEnd(createRace({ mode: "lock" }));
    const o = outcome(s);
    expect(o.bookings).toBe(1);
    expect(o.overbooked).toBe(false);
    expect(o.countsMatchBookings).toBe(true);
    expect(s.events.some((e) => e.tx === "B" && e.op === "wait")).toBe(true);
    expect(s.tx.B.http).toEqual({ status: 500, body: "Room is not available anymore!" });
    expect(s.rows.map((r) => r.reservedCount)).toEqual([1, 1, 1]);
  });

  it("row lock never overbooks, in every interleaving, with 1 or 2 rooms left", () => {
    for (const left of [1, 2]) {
      const finals = allFinalStates(createRace({ mode: "lock", roomsLeftTonight: left }));
      expect(finals.length).toBeGreaterThan(10);
      for (const f of finals) {
        const o = outcome(f);
        expect(o.overbooked).toBe(false);
        expect(o.countsMatchBookings).toBe(true);
        expect(o.bookings).toBe(left === 1 ? 1 : 2);
      }
    }
  });

  it("naive read-then-write overbooks in the shown interleaving (lost update)", () => {
    const s = runToEnd(createRace({ mode: "naive" }));
    const o = outcome(s);
    expect(o.bookings).toBe(2);
    expect(o.overbooked).toBe(true);
    expect(s.rows[0].reservedCount).toBe(1); // A's +1 lost
    expect(o.countsMatchBookings).toBe(false);
    expect(s.events.some((e) => e.title.includes("lost update"))).toBe(true);
  });

  it("naive mode does not always overbook: a serial schedule is safe", () => {
    const finals = allFinalStates(createRace({ mode: "naive" }));
    const results = finals.map((f) => outcome(f).overbooked);
    expect(results).toContain(true);
    expect(results).toContain(false);
  });

  it("guarded UPDATE without the lock: B's update misses tonight, the count is ignored, two bookings", () => {
    const s = runToEnd(createRace({ mode: "guarded" }));
    const o = outcome(s);
    expect(o.bookings).toBe(2);
    expect(o.overbooked).toBe(true);
    expect(o.partialBookings).toEqual([102]);
    expect(s.rows.map((r) => r.reservedCount)).toEqual([1, 2, 2]);
  });

  it("is deterministic", () => {
    for (const mode of ["lock", "naive", "guarded"] as RaceMode[]) {
      expect(runToEnd(createRace({ mode }))).toEqual(runToEnd(createRace({ mode })));
    }
  });
});

describe("reservation hold", () => {
  it("expiry is lazy: requests fail after 10 minutes, but the rooms stay reserved", () => {
    const race = runToEnd(createRace({ mode: "lock" }));
    let w = worldFromHolds(race.rows, [{ id: 101, guest: "Guest A" }]);
    w = tick(w, 10);
    w = addGuests(w, 101);
    expect(lastLog(w).status).toBe(200); // createdAt + 10 is not before now at exactly 10
    let w2 = worldFromHolds(race.rows, [{ id: 101, guest: "Guest A" }]);
    w2 = tick(w2, 11);
    w2 = addGuests(w2, 101);
    expect(lastLog(w2).summary).toBe("Booking has already expired");
    expect(booking(w2).bookingStatus).toBe("RESERVED");
    expect(w2.rows[0].reservedCount).toBe(1);
    w2 = initBooking(w2, "Guest C");
    expect(lastLog(w2).status).toBe(500);
    expect(lastLog(w2).summary).toBe("Room is not available anymore!");
  });
});

describe("booking state machine", () => {
  it("RESERVED → GUEST_ADDED → PAYMENT_PENDING → CONFIRMED → CANCELLED", () => {
    let w = startScenario();
    expect(booking(w).bookingStatus).toBe("RESERVED");
    w = addGuests(w, 101);
    expect(booking(w).bookingStatus).toBe("GUEST_ADDED");
    w = initiatePayments(w, 101);
    expect(booking(w).bookingStatus).toBe("PAYMENT_PENDING");
    w = pay(w, w.sessions[0].id);
    w = deliver(w, latestEvent(w)!.id);
    expect(booking(w).bookingStatus).toBe("CONFIRMED");
    expect(w.rows.map((r) => [r.reservedCount, r.bookedCount])).toEqual([[0, 1], [0, 1], [0, 1]]);
    w = cancelBooking(w, 101);
    expect(booking(w).bookingStatus).toBe("CANCELLED");
    expect(w.rows.map((r) => r.bookedCount)).toEqual([0, 0, 0]);
    expect(w.sessions[0].refunded).toBe(true);
    expect(w.bookings.some((b) => b.bookingStatus === "EXPIRE")).toBe(false);
  });

  it("addGuests requires RESERVED; payments skips the status check", () => {
    let w = startScenario();
    w = initiatePayments(w, 101); // straight from RESERVED, no guests
    expect(booking(w).bookingStatus).toBe("PAYMENT_PENDING");
    w = addGuests(w, 101);
    expect(lastLog(w).summary).toBe("Booking is not under reserved state, Cannot add guests");
  });

  it("only a CONFIRMED booking can be cancelled", () => {
    let w = startScenario();
    w = cancelBooking(w, 101);
    expect(lastLog(w).summary).toBe("Only confirmed booking can be cancelled");
  });

  it("cancel on a sold-out night does not release the room (guard is totalCount - bookedCount >= n)", () => {
    let w = scenarioPaid({ totalCount: 1 });
    w = deliver(w, latestEvent(w)!.id);
    expect(w.rows.map((r) => r.bookedCount)).toEqual([1, 1, 1]);
    w = cancelBooking(w, 101);
    expect(booking(w).bookingStatus).toBe("CANCELLED");
    expect(w.rows.map((r) => r.bookedCount)).toEqual([1, 1, 1]);
    expect(lastLog(w).flags).toContain("cancel-noop");
  });
});

describe("webhook: current code", () => {
  it("duplicate delivery re-runs confirm; with reservedCount at 0 it updates 0 rows (wasted, nothing broken)", () => {
    let w = scenarioPaid();
    const ev = latestEvent(w)!;
    w = deliver(w, ev.id);
    const after1 = structuredClone(w.rows);
    w = deliver(w, ev.id, "duplicate");
    expect(lastLog(w).status).toBe(204);
    expect(lastLog(w).flags).toContain("wasted");
    expect(w.rows).toEqual(after1);
    expect(booking(w).bookingStatus).toBe("CONFIRMED");
  });

  it("3 quick deliveries: 1 confirm + 2 no-ops, exact counts", () => {
    let w = scenarioPaid();
    w = deliverBurst(w, latestEvent(w)!.id);
    const hooks = w.log.filter((l) => l.request.startsWith("POST /api/v1/webhook/payment"));
    expect(hooks.map((h) => h.status)).toEqual([204, 204, 204]);
    expect(hooks.map((h) => h.flags.includes("confirmed"))).toEqual([true, false, false]);
    expect(hooks.filter((h) => h.flags.includes("wasted")).length).toBe(2);
    expect(w.rows.map((r) => [r.reservedCount, r.bookedCount])).toEqual([[0, 1], [0, 1], [0, 1]]);
  });

  it("a replay moves another guest's unpaid hold into bookedCount", () => {
    let w = scenarioPaid();
    const ev = latestEvent(w)!;
    w = deliver(w, ev.id);
    w = initBooking(w, "Guest B");
    expect(w.rows.map((r) => r.reservedCount)).toEqual([1, 1, 1]);
    w = deliver(w, ev.id, "duplicate");
    expect(lastLog(w).flags).toContain("stole-reservation");
    expect(w.rows.map((r) => [r.reservedCount, r.bookedCount])).toEqual([[0, 2], [0, 2], [0, 2]]);
    expect(booking(w, 102).bookingStatus).toBe("RESERVED");
  });

  it("a replay after cancel flips CANCELLED back to CONFIRMED", () => {
    let w = scenarioPaid();
    const ev = latestEvent(w)!;
    w = deliver(w, ev.id);
    w = cancelBooking(w, 101);
    w = deliver(w, ev.id, "duplicate");
    expect(booking(w).bookingStatus).toBe("CONFIRMED");
    expect(lastLog(w).flags).toContain("resurrected");
    expect(w.sessions[0].refunded).toBe(true);
  });

  it("dropped 2xx: Stripe retries the same event id and the handler runs again", () => {
    let w = scenarioPaid();
    w = deliver(w, latestEvent(w)!.id, "dropped");
    expect(w.retryQueue).toHaveLength(1);
    expect(booking(w).bookingStatus).toBe("CONFIRMED");
    w = runRetry(w);
    expect(lastLog(w).attempt).toBe(2);
    expect(lastLog(w).flags).toContain("wasted");
    expect(w.retryQueue).toHaveLength(0);
  });

  it("unhandled event types are ignored with 204", () => {
    let w = scenarioPaid();
    w = createUnhandledEvent(w);
    const before = structuredClone(w.rows);
    w = deliver(w, latestEvent(w, "payment_intent.succeeded")!.id);
    expect(lastLog(w).status).toBe(204);
    expect(lastLog(w).flags).toContain("ignored-type");
    expect(w.rows).toEqual(before);
    expect(booking(w).bookingStatus).toBe("PAYMENT_PENDING");
  });

  it("tampered body fails signature verification and returns 500", () => {
    let w = scenarioPaid();
    const before = structuredClone(w.rows);
    w = deliver(w, latestEvent(w)!.id, "forged");
    expect(lastLog(w).status).toBe(500);
    expect(lastLog(w).flags).toContain("bad-signature");
    expect(w.rows).toEqual(before);
    expect(w.retryQueue).toHaveLength(0);
  });

  it("guest opens checkout twice: paying the first session charges the card and the webhook 404s", () => {
    let w = scenarioCheckoutTwice();
    expect(w.customers).toHaveLength(2);
    expect(w.sessions).toHaveLength(2);
    expect(booking(w).paymentSessionId).toBe(w.sessions[1].id);
    expect(w.sessions[0].paymentStatus).toBe("paid");
    w = deliver(w, latestEvent(w)!.id);
    expect(lastLog(w).status).toBe(404);
    expect(lastLog(w).summary).toBe(`Booking not found with session id: {}${w.sessions[0].id}`);
    expect(booking(w).bookingStatus).toBe("PAYMENT_PENDING");
    expect(w.retryQueue).toHaveLength(1);
    w = runRetry(w);
    expect(lastLog(w).status).toBe(404);
  });
});

describe("webhook: with fix", () => {
  it("duplicates return 200 already processed and change nothing", () => {
    let w = setMode(scenarioPaid(), "fix");
    w = deliverBurst(w, latestEvent(w)!.id);
    const hooks = w.log.filter((l) => l.request.startsWith("POST /api/v1/webhook/payment"));
    expect(hooks.map((h) => h.status)).toEqual([200, 200, 200]);
    expect(hooks.map((h) => h.summary).slice(1)).toEqual(["already processed", "already processed"]);
    expect(w.processedEvents).toHaveLength(1);
    expect(w.rows.map((r) => [r.reservedCount, r.bookedCount])).toEqual([[0, 1], [0, 1], [0, 1]]);
  });

  it("does not steal another hold or resurrect a cancelled booking", () => {
    let w = setMode(scenarioPaid(), "fix");
    const ev = latestEvent(w)!;
    w = deliver(w, ev.id);
    w = initBooking(w, "Guest B");
    w = cancelBooking(w, 101);
    w = deliver(w, ev.id, "duplicate");
    expect(lastLog(w).summary).toBe("already processed");
    expect(booking(w).bookingStatus).toBe("CANCELLED");
    expect(w.rows.map((r) => r.reservedCount)).toEqual([1, 1, 1]);
  });

  it("tampered body returns 400; unhandled types are acknowledged and recorded", () => {
    let w = setMode(scenarioPaid(), "fix");
    w = deliver(w, latestEvent(w)!.id, "forged");
    expect(lastLog(w).status).toBe(400);
    w = createUnhandledEvent(w);
    w = deliver(w, latestEvent(w, "payment_intent.succeeded")!.id);
    expect(lastLog(w).status).toBe(200);
    expect(lastLog(w).flags).toContain("ignored-type");
  });

  it("the checkout-twice 404 is not fixed by dedupe, and the event id is not recorded", () => {
    let w = setMode(scenarioCheckoutTwice(), "fix");
    w = deliver(w, latestEvent(w)!.id);
    expect(lastLog(w).status).toBe(404);
    expect(w.processedEvents).toHaveLength(0);
  });
});

describe("determinism", () => {
  it("same actions give the same ids and state", () => {
    expect(scenarioCheckoutTwice()).toEqual(scenarioCheckoutTwice());
    expect(scenarioCheckoutTwice({ seed: 1 }).sessions[0].id).not.toEqual(scenarioCheckoutTwice({ seed: 2 }).sessions[0].id);
  });
});
