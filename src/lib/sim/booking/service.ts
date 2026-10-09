/**
 * The NeonStays booking flow as a pure state machine, one function per endpoint.
 *
 * Modelled on BookingServiceImpl, InventoryRepository, CheckoutServiceImpl, WebHookController and
 * GlobalExceptionHandler. Requests run one at a time here (the concurrent race lives in race.ts).
 * Every function takes a World and returns a new one; nothing reads the wall clock or Math.random.
 *
 * Two webhook modes:
 *  - "current": what the repository does. No event-id dedupe and no status precondition, so a
 *    redelivered checkout.session.completed re-runs the confirm path.
 *  - "fix": a proposed change, not shipped: a processed_stripe_events table with UNIQUE(event_id)
 *    written in the same transaction, a PAYMENT_PENDING precondition, and 400 on a bad signature.
 */

import { priceNight } from "../pricing";
import { add, DEC_ZERO, dec, format2, fromInt, mul, roundHalfUp, toPlain, truncToBigInt, type Decimal } from "./decimal";
import { availableOf, makeRows, type BookingStatus, type InventoryRow, type Tone } from "./types";

export type WebhookMode = "current" | "fix";

/** BookingServiceImpl.hasBookingExpired: createdAt.plusMinutes(10).isBefore(now). */
export const HOLD_MINUTES = 10;

export interface BookingRow {
  id: number;
  guest: string;
  userId: number;
  email: string;
  roomsCount: number;
  bookingStatus: BookingStatus;
  /** Simulated minutes. */
  createdAt: number;
  paymentSessionId: string | null;
  /** Booking.amount as stored (numeric(10,2)). */
  amount: string;
  guests: number;
}

export interface StripeSession {
  id: string;
  bookingId: number;
  customer: string;
  status: "open" | "complete";
  paymentStatus: "unpaid" | "paid";
  paymentIntent: string | null;
  /** unit_amount in paise (amount x 100). */
  amountTotal: number;
  refunded: boolean;
}

export interface StripeEvent {
  id: string;
  type: string;
  /** data.object id: a Checkout Session (cs_) or a PaymentIntent (pi_). */
  objectId: string;
  createdAt: number;
  /** Delivery attempts Stripe has made. */
  attempts: number;
  /** Stripe has seen a 2xx for this event. */
  acknowledged: boolean;
}

export type LogFlag =
  | "confirmed"
  | "wasted"
  | "stole-reservation"
  | "resurrected"
  | "not-found"
  | "ignored-type"
  | "bad-signature"
  | "deduped"
  | "precondition"
  | "response-lost"
  | "charged"
  | "overwrote-session"
  | "expired"
  | "unavailable"
  | "cancel-noop";

export interface LogEntry {
  seq: number;
  at: number;
  actor: string;
  /** "POST /api/v1/webhook/payment" etc. */
  request: string;
  status: number | null;
  statusText: string;
  tone: Tone;
  /** One-line outcome. */
  summary: string;
  /** Step-by-step effects, in code order. */
  lines: string[];
  sql: string[];
  flags: LogFlag[];
  eventId?: string;
  attempt?: number;
}

export interface World {
  mode: WebhookMode;
  clock: number;
  roomId: number;
  hotel: string;
  roomType: string;
  basePrice: string;
  rows: InventoryRow[];
  bookings: BookingRow[];
  customers: string[];
  sessions: StripeSession[];
  events: StripeEvent[];
  processedEvents: { eventId: string; at: number }[];
  retryQueue: { eventId: string; attempt: number }[];
  log: LogEntry[];
  seq: number;
  rng: number;
  nextBookingId: number;
}

export interface WorldOptions {
  mode?: WebhookMode;
  totalCount?: number;
  bookedCount?: number[] | number;
  dayOffsets?: number[];
  basePrice?: string;
  seed?: number;
}

/* ------------------------------------------------------------------ */
/* Deterministic ids                                                   */
/* ------------------------------------------------------------------ */

/** mulberry32, private to this module. */
function nextRandom(state: number): [number, number] {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  a = a >>> 0;
  return [value, a];
}

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function makeId(w: World, prefix: string, len: number): string {
  let s = prefix;
  for (let i = 0; i < len; i++) {
    const [v, next] = nextRandom(w.rng);
    w.rng = next;
    s += ALNUM[Math.floor(v * ALNUM.length)];
  }
  return s;
}

function clone(w: World): World {
  return structuredClone(w);
}

function push(w: World, e: Omit<LogEntry, "seq" | "at">): LogEntry {
  const entry: LogEntry = { ...e, seq: ++w.seq, at: w.clock };
  w.log.push(entry);
  return entry;
}

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

export function createWorld(opts: WorldOptions = {}): World {
  const dayOffsets = opts.dayOffsets ?? [3, 4, 5];
  return {
    mode: opts.mode ?? "current",
    clock: 0,
    roomId: 7,
    hotel: "Demo Hotel",
    roomType: "Deluxe",
    basePrice: opts.basePrice ?? "2000.00",
    rows: makeRows(dayOffsets, opts.totalCount ?? 2, opts.bookedCount ?? 0),
    bookings: [],
    customers: [],
    sessions: [],
    events: [],
    processedEvents: [],
    retryQueue: [],
    log: [],
    seq: 0,
    rng: (opts.seed ?? 20251201) >>> 0,
    nextBookingId: 101,
  };
}

export function setMode(world: World, mode: WebhookMode): World {
  const w = clone(world);
  w.mode = mode;
  return w;
}

export function tick(world: World, minutes: number): World {
  const w = clone(world);
  w.clock += minutes;
  return w;
}

export function hasBookingExpired(b: BookingRow, now: number): boolean {
  return b.createdAt + HOLD_MINUTES < now;
}

export function findBooking(w: World, id: number): BookingRow | undefined {
  return w.bookings.find((b) => b.id === id);
}

/** calculateTotalPrice over the locked rows, times roomsCount, rounded as numeric(10,2) stores it. */
export function priceRows(basePrice: string, rows: InventoryRow[], roomsCount: number): Decimal {
  let one: Decimal = DEC_ZERO;
  for (const r of rows) {
    one = add(one, priceNight({ dayOffset: r.dayOffset, basePrice: dec(basePrice), surgeFactor: dec("1.00"), bookedCount: r.bookedCount, totalCount: r.totalCount }).price);
  }
  return roundHalfUp(mul(one, fromInt(roomsCount)), 2);
}

/** A world whose bookings were created elsewhere (the race panel), all RESERVED at minute 0. */
export function worldFromHolds(rows: InventoryRow[], holders: { id: number; guest: string }[], opts: WorldOptions = {}): World {
  const w = createWorld(opts);
  const before = rows.map((r) => ({ ...r }));
  w.rows = rows.map((r) => ({ ...r }));
  for (const h of holders) {
    w.bookings.push({
      id: h.id,
      guest: h.guest,
      userId: 40 + w.bookings.length + 1,
      email: `${h.guest.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
      roomsCount: 1,
      bookingStatus: "RESERVED",
      createdAt: 0,
      paymentSessionId: null,
      amount: toPlain(priceRows(w.basePrice, before, 1)),
      guests: 0,
    });
    w.nextBookingId = Math.max(w.nextBookingId, h.id + 1);
  }
  return w;
}

const RANGE = "room_id = :roomId AND date BETWEEN :checkInDate AND :checkOutDate AND closed = false";

/* ------------------------------------------------------------------ */
/* POST /api/v1/bookings/init                                          */
/* ------------------------------------------------------------------ */

export function initBooking(world: World, guest: string, roomsCount = 1): World {
  const w = clone(world);
  const request = "POST /api/v1/bookings/init";
  const daysCount = w.rows.length; // ChronoUnit.DAYS.between(checkIn, checkOut) + 1
  const locked = w.rows.filter((r) => !r.closed && availableOf(r) >= roomsCount);
  const sql = [
    `SELECT i FROM Inventory i WHERE ${RANGE} AND (totalCount - bookedCount - reservedCount) >= ${roomsCount} -- PESSIMISTIC_WRITE`,
  ];
  if (locked.length !== daysCount) {
    push(w, {
      actor: guest,
      request,
      status: 500,
      statusText: "Internal Server Error",
      tone: "crit",
      summary: "Room is not available anymore!",
      lines: [
        `findAndLockAvailableInventory returned ${locked.length} of ${daysCount} rows.`,
        "inventoryList.size() != daysCount, so it throws IllegalStateException. The catch-all handler turns it into a 500.",
      ],
      sql,
      flags: ["unavailable"],
    });
    return w;
  }
  for (const r of w.rows) {
    if (!r.closed && availableOf(r) >= roomsCount) r.reservedCount += roomsCount;
  }
  sql.push(`UPDATE Inventory i SET reservedCount = reservedCount + ${roomsCount} WHERE ${RANGE} AND (totalCount - bookedCount - reservedCount) >= ${roomsCount}`);
  const amount = priceRows(w.basePrice, locked, roomsCount);
  const id = w.nextBookingId++;
  const userId = 40 + w.bookings.length + 1;
  w.bookings.push({
    id,
    guest,
    userId,
    email: `${guest.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
    roomsCount,
    bookingStatus: "RESERVED",
    createdAt: w.clock,
    paymentSessionId: null,
    amount: toPlain(amount),
    guests: 0,
  });
  sql.push(`INSERT INTO booking (... booking_status, amount) VALUES (... 'RESERVED', ${toPlain(amount)})`);
  push(w, {
    actor: guest,
    request,
    status: 200,
    statusText: "OK",
    tone: "ok",
    summary: `Booking ${id} is RESERVED. Rooms are held from minute ${w.clock}.`,
    lines: [
      `Locked ${daysCount} inventory rows, reservedCount + ${roomsCount} on each.`,
      `Amount ₹${format2(amount)} from the live pricing chain.`,
    ],
    sql,
    flags: [],
  });
  return w;
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/bookings/{id}/addGuests                                */
/* ------------------------------------------------------------------ */

export function addGuests(world: World, bookingId: number): World {
  const w = clone(world);
  const b = findBooking(w, bookingId);
  const request = `POST /api/v1/bookings/${bookingId}/addGuests`;
  if (!b) return w;
  if (hasBookingExpired(b, w.clock)) {
    push(w, {
      actor: b.guest,
      request,
      status: 500,
      statusText: "Internal Server Error",
      tone: "crit",
      summary: "Booking has already expired",
      lines: [
        `hasBookingExpired: createdAt (min ${b.createdAt}) + 10 min is before now (min ${w.clock}).`,
        "Only this request fails. The booking stays " + b.bookingStatus + " and its rooms stay in reservedCount.",
      ],
      sql: [],
      flags: ["expired"],
    });
    return w;
  }
  if (b.bookingStatus !== "RESERVED") {
    push(w, {
      actor: b.guest,
      request,
      status: 500,
      statusText: "Internal Server Error",
      tone: "crit",
      summary: "Booking is not under reserved state, Cannot add guests",
      lines: [`bookingStatus is ${b.bookingStatus}, not RESERVED.`],
      sql: [],
      flags: [],
    });
    return w;
  }
  b.bookingStatus = "GUEST_ADDED";
  b.guests = 2;
  push(w, {
    actor: b.guest,
    request,
    status: 200,
    statusText: "OK",
    tone: "ok",
    summary: `Booking ${b.id}: RESERVED → GUEST_ADDED.`,
    lines: ["Owner check, expiry check and status == RESERVED all pass."],
    sql: ["INSERT INTO guest ...", "INSERT INTO booking_guest ...", `UPDATE booking SET booking_status = 'GUEST_ADDED' WHERE id = ${b.id}`],
    flags: [],
  });
  return w;
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/bookings/{id}/payments                                 */
/* ------------------------------------------------------------------ */

export function initiatePayments(world: World, bookingId: number): World {
  const w = clone(world);
  const b = findBooking(w, bookingId);
  const request = `POST /api/v1/bookings/${bookingId}/payments`;
  if (!b) return w;
  if (hasBookingExpired(b, w.clock)) {
    push(w, {
      actor: b.guest,
      request,
      status: 500,
      statusText: "Internal Server Error",
      tone: "crit",
      summary: "Booking has already expired",
      lines: [`hasBookingExpired: createdAt (min ${b.createdAt}) + 10 min is before now (min ${w.clock}).`],
      sql: [],
      flags: ["expired"],
    });
    return w;
  }
  const customer = makeId(w, "cus_", 14);
  w.customers.push(customer);
  const sessionId = makeId(w, "cs_test_a1", 14);
  // CheckoutServiceImpl: booking.getAmount().multiply(BigDecimal.valueOf(100)).longValue()
  const amountTotal = Number(truncToBigInt(mul(dec(b.amount), fromInt(100))));
  w.sessions.push({ id: sessionId, bookingId: b.id, customer, status: "open", paymentStatus: "unpaid", paymentIntent: null, amountTotal, refunded: false });
  const previous = b.paymentSessionId;
  const prevStatus = b.bookingStatus;
  b.paymentSessionId = sessionId;
  b.bookingStatus = "PAYMENT_PENDING";
  const lines = [
    `Stripe Customer.create → ${customer} (a new Customer on every call).`,
    `Stripe Session.create: mode=payment, currency=inr, unit_amount=${amountTotal}, payment_intent_data.metadata {bookingId, userId, email, hotel, roomType} → ${sessionId}.`,
    previous
      ? `booking.paymentSessionId = ${sessionId}. It was ${previous}, which is overwritten. That session is still open on Stripe and can still be paid.`
      : `booking.paymentSessionId = ${sessionId}.`,
    prevStatus === "PAYMENT_PENDING" ? "bookingStatus stays PAYMENT_PENDING." : `bookingStatus ${prevStatus} → PAYMENT_PENDING (only expiry is checked, not the current status).`,
  ];
  push(w, {
    actor: b.guest,
    request,
    status: 200,
    statusText: "OK",
    tone: previous ? "warn" : "ok",
    summary: previous ? `Second Checkout Session for booking ${b.id}. The first one is no longer linked.` : `Checkout Session ${sessionId} created. Returns { sessionUrl }.`,
    lines,
    sql: [`UPDATE booking SET payment_session_id = '${sessionId}', booking_status = 'PAYMENT_PENDING' WHERE id = ${b.id}`],
    flags: previous ? ["overwrote-session"] : [],
  });
  return w;
}

/* ------------------------------------------------------------------ */
/* Stripe: the guest pays on the hosted Checkout page                  */
/* ------------------------------------------------------------------ */

export function pay(world: World, sessionId: string): World {
  const w = clone(world);
  const s = w.sessions.find((x) => x.id === sessionId);
  if (!s || s.status !== "open") return w;
  s.status = "complete";
  s.paymentStatus = "paid";
  s.paymentIntent = makeId(w, "pi_3", 14);
  const eventId = makeId(w, "evt_1", 14);
  w.events.push({ id: eventId, type: "checkout.session.completed", objectId: s.id, createdAt: w.clock, attempts: 0, acknowledged: false });
  const linked = w.bookings.some((b) => b.paymentSessionId === s.id);
  push(w, {
    actor: "Stripe",
    request: `Checkout page for ${s.id}`,
    status: null,
    statusText: "paid",
    tone: "neutral",
    summary: `Card charged ₹${format2(dec((s.amountTotal / 100).toFixed(2)))}. Stripe creates ${eventId} (checkout.session.completed).`,
    lines: [
      `PaymentIntent ${s.paymentIntent} succeeded.`,
      linked ? `This session id is the one stored on booking ${s.bookingId}.` : `No booking stores this session id any more: booking ${s.bookingId} points at a newer session.`,
    ],
    sql: [],
    flags: ["charged"],
    eventId,
  });
  return w;
}

/** A second event type for the same payment. Stripe sends it if the endpoint is subscribed to it. */
export function createUnhandledEvent(world: World, type = "payment_intent.succeeded"): World {
  const w = clone(world);
  const paid = [...w.sessions].reverse().find((s) => s.paymentIntent);
  const objectId = paid?.paymentIntent ?? makeId(w, "pi_3", 14);
  const eventId = makeId(w, "evt_1", 14);
  w.events.push({ id: eventId, type, objectId, createdAt: w.clock, attempts: 0, acknowledged: false });
  return w;
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/webhook/payment                                        */
/* ------------------------------------------------------------------ */

export type DeliveryKind = "first" | "duplicate" | "burst" | "retry" | "dropped" | "forged";

interface HandlerResult {
  status: number;
  statusText: string;
  tone: Tone;
  summary: string;
  lines: string[];
  sql: string[];
  flags: LogFlag[];
}

/** The confirm path shared by both modes: capturePayment lines 184-196. */
function confirmPath(w: World, b: BookingRow, lines: string[], sql: string[], flags: LogFlag[]): void {
  const prev = b.bookingStatus;
  b.bookingStatus = "CONFIRMED";
  if (prev === "CONFIRMED") {
    lines.push("booking.setBookingStatus(CONFIRMED): already CONFIRMED, so Hibernate's dirty check skips the UPDATE.");
  } else {
    sql.push(`UPDATE booking SET booking_status = 'CONFIRMED' WHERE id = ${b.id}`);
    lines.push(`bookingStatus ${prev} → CONFIRMED.`);
  }
  const n = b.roomsCount;
  const lockable = w.rows.filter((r) => !r.closed && r.reservedCount >= n);
  sql.push(`SELECT i FROM Inventory i WHERE ${RANGE} AND reservedCount >= ${n} -- PESSIMISTIC_WRITE, result unused`);
  for (const r of lockable) {
    r.reservedCount -= n;
    r.bookedCount += n;
  }
  sql.push(`UPDATE Inventory i SET reservedCount = reservedCount - ${n}, bookedCount = bookedCount + ${n} WHERE ${RANGE} AND reservedCount >= ${n}`);
  lines.push(`confirmBooking updated ${lockable.length} of ${w.rows.length} rows.`);

  if (prev === "PAYMENT_PENDING") {
    flags.push("confirmed");
    if (lockable.length < w.rows.length) lines.push(`Only ${lockable.length} rows had reservedCount ≥ ${n}. The update count is not checked.`);
  } else if (prev === "CANCELLED") {
    flags.push("resurrected");
    lines.push("A booking that was cancelled and refunded is CONFIRMED again.");
  }
  if ((prev === "CONFIRMED" || prev === "CANCELLED") && lockable.length > 0) {
    flags.push("stole-reservation");
    const others = w.bookings.filter((o) => o.id !== b.id && ["RESERVED", "GUEST_ADDED", "PAYMENT_PENDING"].includes(o.bookingStatus));
    lines.push(
      others.length
        ? `Those reserved rooms belong to unpaid booking ${others.map((o) => o.id).join(", ")}. They are now counted as booked.`
        : "Those reserved rooms belonged to another hold. They are now counted as booked.",
    );
  } else if (prev === "CONFIRMED" && lockable.length === 0) {
    flags.push("wasted");
    lines.push("No row had reservedCount ≥ " + n + ", so nothing changed. Wasted work, nothing broken.");
  }
}

function handleCurrent(w: World, ev: StripeEvent, forged: boolean): HandlerResult {
  const lines: string[] = [];
  const sql: string[] = [];
  const flags: LogFlag[] = [];
  if (forged) {
    return {
      status: 500,
      statusText: "Internal Server Error",
      tone: "crit",
      summary: "Signature check failed, and the API answers 500, not 400.",
      lines: [
        "Webhook.constructEvent throws SignatureVerificationException: the body no longer matches the Stripe-Signature HMAC.",
        "The controller wraps it in a RuntimeException. GlobalExceptionHandler's catch-all maps any Exception to 500.",
        "Nothing is written. The forged body never reaches capturePayment.",
      ],
      sql: [],
      flags: ["bad-signature"],
    };
  }
  lines.push("Webhook.constructEvent(payload, Stripe-Signature, stripe.webhook.secret): signature valid.");
  if (ev.type !== "checkout.session.completed") {
    lines.push(`capturePayment: "${ev.type}" is not "checkout.session.completed". No branch runs.`);
    return { status: 204, statusText: "No Content", tone: "neutral", summary: `Ignored ${ev.type}. Nothing changed.`, lines, sql, flags: ["ignored-type"] };
  }
  sql.push(`SELECT * FROM booking WHERE payment_session_id = '${ev.objectId}'`);
  const b = w.bookings.find((x) => x.paymentSessionId === ev.objectId);
  if (!b) {
    lines.push("findByPaymentSessionId found nothing, so it throws ResourceNotFoundException. The transaction rolls back.");
    lines.push("The card was charged, but no booking points at this session. Stripe will keep retrying and get 404 every time.");
    return {
      status: 404,
      statusText: "Not Found",
      tone: "crit",
      summary: `Booking not found with session id: {}${ev.objectId}`,
      lines,
      sql,
      flags: ["not-found"],
    };
  }
  confirmPath(w, b, lines, sql, flags);
  const bad = flags.includes("resurrected") || flags.includes("stole-reservation");
  return {
    status: 204,
    statusText: "No Content",
    tone: bad ? "crit" : flags.includes("wasted") ? "warn" : "ok",
    summary: flags.includes("confirmed")
      ? `Booking ${b.id} CONFIRMED.`
      : flags.includes("resurrected")
        ? `Booking ${b.id} went from CANCELLED back to CONFIRMED.`
        : flags.includes("stole-reservation")
          ? "Replay ran confirmBooking again and moved another guest's hold into bookedCount."
          : "Replay re-ran the confirm path. 0 rows changed.",
    lines,
    sql,
    flags,
  };
}

function handleFix(w: World, ev: StripeEvent, forged: boolean): HandlerResult {
  const lines: string[] = [];
  const sql: string[] = [];
  const flags: LogFlag[] = [];
  if (forged) {
    return {
      status: 400,
      statusText: "Bad Request",
      tone: "warn",
      summary: "Signature check failed. The fix answers 400.",
      lines: ["SignatureVerificationException is mapped to 400. Nothing is written."],
      sql: [],
      flags: ["bad-signature"],
    };
  }
  lines.push("Webhook.constructEvent: signature valid.");
  sql.push("BEGIN");
  sql.push(`INSERT INTO processed_stripe_events (event_id) VALUES ('${ev.id}') ON CONFLICT (event_id) DO NOTHING`);
  if (w.processedEvents.some((p) => p.eventId === ev.id)) {
    sql.push("-- 0 rows inserted", "COMMIT");
    lines.push(`${ev.id} is already in processed_stripe_events. Return 200 without touching the booking.`);
    return { status: 200, statusText: "OK", tone: "ok", summary: "already processed", lines, sql, flags: ["deduped"] };
  }
  const record = () => w.processedEvents.push({ eventId: ev.id, at: w.clock });
  if (ev.type !== "checkout.session.completed") {
    record();
    sql.push("COMMIT");
    lines.push(`"${ev.type}" is not handled. The id is recorded and the event is acknowledged.`);
    return { status: 200, statusText: "OK", tone: "neutral", summary: `Ignored ${ev.type}.`, lines, sql, flags: ["ignored-type"] };
  }
  sql.push(`SELECT * FROM booking WHERE payment_session_id = '${ev.objectId}' FOR UPDATE`);
  const b = w.bookings.find((x) => x.paymentSessionId === ev.objectId);
  if (!b) {
    sql.push("ROLLBACK");
    lines.push("No booking has this session id. The insert into processed_stripe_events rolls back too, so Stripe's retry gets the same answer.");
    lines.push("Event dedupe cannot fix this one. It needs initiatePayments to reuse or expire the open session.");
    return { status: 404, statusText: "Not Found", tone: "crit", summary: `Booking not found with session id: {}${ev.objectId}`, lines, sql, flags: ["not-found"] };
  }
  if (b.bookingStatus !== "PAYMENT_PENDING") {
    record();
    sql.push("COMMIT");
    lines.push(`Booking ${b.id} is ${b.bookingStatus}, not PAYMENT_PENDING. Nothing to confirm.`);
    return { status: 200, statusText: "OK", tone: "ok", summary: `Skipped: booking is ${b.bookingStatus}.`, lines, sql, flags: ["precondition"] };
  }
  record();
  confirmPath(w, b, lines, sql, flags);
  sql.push("COMMIT");
  return { status: 200, statusText: "OK", tone: "ok", summary: `Booking ${b.id} CONFIRMED.`, lines, sql, flags };
}

/** Deliver one event to POST /api/v1/webhook/payment. */
export function deliver(world: World, eventId: string, kind: DeliveryKind = "first"): World {
  const w = clone(world);
  const ev = w.events.find((e) => e.id === eventId);
  if (!ev) return w;
  const forged = kind === "forged";
  if (!forged) ev.attempts += 1;
  const res = w.mode === "fix" ? handleFix(w, ev, forged) : handleCurrent(w, ev, forged);
  const ok2xx = res.status >= 200 && res.status < 300;
  const lost = kind === "dropped";
  const lines = [...res.lines];
  const flags = [...res.flags];
  if (lost) {
    lines.push(`The handler committed, but the ${res.status} never reached Stripe (timeout). Stripe marks the attempt failed and schedules a retry with backoff.`);
    flags.push("response-lost");
  } else if (!forged && !ok2xx) {
    lines.push("Stripe treats any non-2xx as a failure and retries with exponential backoff (for up to three days in live mode).");
  }
  if (!forged) {
    w.retryQueue = w.retryQueue.filter((r) => r.eventId !== ev.id);
    if (ok2xx && !lost) ev.acknowledged = true;
    else w.retryQueue.push({ eventId: ev.id, attempt: ev.attempts + 1 });
  }
  const actor = forged ? "Someone (not Stripe)" : "Stripe";
  const label =
    kind === "forged" ? "forged body" : kind === "retry" ? `retry, attempt ${ev.attempts}` : kind === "duplicate" ? `duplicate, attempt ${ev.attempts}` : `attempt ${ev.attempts}`;
  push(w, {
    actor,
    request: `POST /api/v1/webhook/payment · ${ev.type} · ${label}`,
    status: res.status,
    statusText: res.statusText,
    tone: res.tone,
    summary: res.summary,
    lines,
    sql: res.sql,
    flags,
    eventId: ev.id,
    attempt: forged ? undefined : ev.attempts,
  });
  return w;
}

/**
 * Three deliveries of the same event in quick succession. In the database they serialise: in the
 * current code on the inventory row lock (findAndLockReservedInventory), with the fix on the
 * UNIQUE(event_id) index. The end state equals three sequential deliveries, so they run in order.
 */
export function deliverBurst(world: World, eventId: string, times = 3): World {
  let w = world;
  for (let i = 0; i < times; i++) {
    w = deliver(w, eventId, i === 0 ? "first" : "burst");
    if (i > 0) {
      const last = w.log[w.log.length - 1];
      last.lines.unshift(
        w.mode === "fix"
          ? `Arrived while delivery 1 was in flight. Its INSERT waited on the UNIQUE(event_id) index until delivery 1 committed.`
          : `Arrived while delivery 1 was in flight. It waited on the inventory row lock, then re-read the rows.`,
      );
    }
  }
  return w;
}

/** Stripe runs the next scheduled retry. */
export function runRetry(world: World): World {
  const next = world.retryQueue[0];
  if (!next) return world;
  return deliver(world, next.eventId, "retry");
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/bookings/{id}/cancel                                   */
/* ------------------------------------------------------------------ */

export function cancelBooking(world: World, bookingId: number): World {
  const w = clone(world);
  const b = findBooking(w, bookingId);
  const request = `POST /api/v1/bookings/${bookingId}/cancel`;
  if (!b) return w;
  if (b.bookingStatus !== "CONFIRMED") {
    push(w, {
      actor: b.guest,
      request,
      status: 500,
      statusText: "Internal Server Error",
      tone: "crit",
      summary: "Only confirmed booking can be cancelled",
      lines: [`bookingStatus is ${b.bookingStatus}. IllegalStateException → 500.`],
      sql: [],
      flags: [],
    });
    return w;
  }
  const n = b.roomsCount;
  const session = w.sessions.find((s) => s.id === b.paymentSessionId);
  if (!session || session.paymentStatus !== "paid" || session.refunded) {
    push(w, {
      actor: b.guest,
      request,
      status: 500,
      statusText: "Internal Server Error",
      tone: "crit",
      summary: "Refund failed, so the whole cancel rolls back.",
      lines: [`Refund.create on the PaymentIntent of ${b.paymentSessionId} throws StripeException. The transaction rolls back.`],
      sql: [],
      flags: [],
    });
    return w;
  }
  const updatable = w.rows.filter((r) => !r.closed && r.totalCount - r.bookedCount >= n);
  for (const r of updatable) r.bookedCount -= n;
  b.bookingStatus = "CANCELLED";
  session.refunded = true;
  const lines = [`bookingStatus CONFIRMED → CANCELLED.`, `cancelBooking updated ${updatable.length} of ${w.rows.length} rows.`];
  const flags: LogFlag[] = [];
  if (updatable.length < w.rows.length) {
    flags.push("cancel-noop");
    lines.push(
      `The WHERE clause is (totalCount - bookedCount) >= ${n}. On a sold-out night that is false, so bookedCount is not decremented and the room is not released.`,
    );
  }
  lines.push(`Refund.create on ${session.paymentIntent}: full refund.`);
  push(w, {
    actor: b.guest,
    request,
    status: 204,
    statusText: "No Content",
    tone: flags.length ? "warn" : "ok",
    summary: flags.length ? `Booking ${b.id} cancelled and refunded, but some nights keep the room booked.` : `Booking ${b.id} cancelled and refunded.`,
    lines,
    sql: [
      `UPDATE booking SET booking_status = 'CANCELLED' WHERE id = ${b.id}`,
      `UPDATE Inventory i SET bookedCount = bookedCount - ${n} WHERE ${RANGE} AND (totalCount - bookedCount) >= ${n}`,
    ],
    flags,
  });
  return w;
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

/** Guest A has just reserved (minute 0). The starting point of the webhook panel. */
export function startScenario(opts: WorldOptions = {}): World {
  return initBooking(createWorld(opts), "Guest A");
}

/** Guest A adds guests and opens checkout, then pays. The event is created but not yet delivered. */
export function scenarioPaid(opts: WorldOptions = {}): World {
  let w = startScenario(opts);
  w = addGuests(w, 101);
  w = initiatePayments(w, 101);
  const s = w.sessions[w.sessions.length - 1];
  return pay(w, s.id);
}

/**
 * "Guest opens checkout twice": two POST /payments for the same booking (two tabs, or back and retry),
 * then the guest pays in the FIRST tab. Verified in CheckoutServiceImpl.java:38-83 (new Customer and
 * Session on every call, paymentSessionId overwritten) and BookingServiceImpl.java:139-157 (no status
 * check, no reuse of an open session).
 */
export function scenarioCheckoutTwice(opts: WorldOptions = {}): World {
  let w = startScenario(opts);
  w = addGuests(w, 101);
  w = initiatePayments(w, 101);
  const first = w.sessions[w.sessions.length - 1].id;
  w = tick(w, 1);
  w = initiatePayments(w, 101);
  w = tick(w, 1);
  return pay(w, first);
}

/** The latest event, which the webhook controls act on by default. */
export function latestEvent(w: World, type?: string): StripeEvent | undefined {
  for (let i = w.events.length - 1; i >= 0; i--) {
    if (!type || w.events[i].type === type) return w.events[i];
  }
  return undefined;
}

/** Totals that should always hold if the books balance. */
export function ledger(w: World) {
  const open = w.bookings.filter((b) => ["RESERVED", "GUEST_ADDED", "PAYMENT_PENDING"].includes(b.bookingStatus));
  const confirmed = w.bookings.filter((b) => b.bookingStatus === "CONFIRMED");
  const charges = w.sessions.filter((s) => s.paymentStatus === "paid" && !s.refunded);
  return {
    holds: open.reduce((n, b) => n + b.roomsCount, 0),
    confirmedRooms: confirmed.reduce((n, b) => n + b.roomsCount, 0),
    unrefundedCharges: charges.length,
    reservedPerRow: w.rows.map((r) => r.reservedCount),
    bookedPerRow: w.rows.map((r) => r.bookedCount),
  };
}
